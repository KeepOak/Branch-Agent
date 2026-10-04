import { randomUUID } from "node:crypto";
import { truncateUtf16Safe } from "branch/plugin-sdk/text-utility-runtime";
import {
  A2A_LIST_TASKS_DEFAULT_PAGE_SIZE,
  isTerminalA2aTaskState,
  type A2aMessageRecord,
  type A2aPushNotificationConfig,
  type A2aTaskArtifact,
  type A2aTaskRecord,
} from "./protocol.js";

const A2A_TERMINAL_MAX_TASKS = 500;
const A2A_TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const A2A_ERROR_MAX_LENGTH = 512;
export const A2A_RESTART_INTERRUPTED_MESSAGE =
  "Gateway restarted before the task finished; send the message again";

type A2aTaskWaiter = {
  resolve: (task: A2aTaskRecord) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** A2A 1.0 StreamResponse payloads published to streaming subscribers. */
export type A2aStreamEvent =
  | { task: A2aTaskRecord }
  | { statusUpdate: { taskId: string; contextId: string; status: A2aTaskRecord["status"] } }
  | {
      artifactUpdate: {
        taskId: string;
        contextId: string;
        artifact: A2aTaskArtifact;
        append: boolean;
        lastChunk: boolean;
      };
    };

type A2aTaskSubscriber = {
  onEvent: (event: A2aStreamEvent) => void;
  onClose: () => void;
};

/** A task as written to durable storage: the protocol record plus its caller. */
export type A2aPersistedTask = {
  task: A2aTaskRecord;
  ownerPeer?: string;
  finishedAt?: number;
  pushConfigs?: A2aPushNotificationConfig[];
};

/** Durable backing for task records; see persistence.ts. */
export type A2aTaskPersistence = {
  save(entry: A2aPersistedTask): Promise<void>;
  delete(taskId: string, ownerPeer?: string): Promise<void>;
  loadAll(): Promise<A2aPersistedTask[]>;
};

type A2aTaskStoreOptions = {
  persistence?: A2aTaskPersistence;
  onPersistenceError?: (error: unknown) => void;
  /** Called after each status change of a task that has push configs. */
  onPushUpdate?: (task: A2aTaskRecord, configs: A2aPushNotificationConfig[]) => void;
};

export type A2aListTasksQuery = {
  contextId?: string;
  status?: string;
  pageSize?: number;
  pageToken?: string;
  statusTimestampAfter?: string;
  includeArtifacts?: boolean;
};

export type A2aListTasksResult = {
  tasks: A2aTaskRecord[];
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
};

function isTerminalTask(task: A2aTaskRecord): boolean {
  return isTerminalA2aTaskState(task.status.state);
}

function createStatusMessage(contextId: string, text: string): A2aMessageRecord {
  return {
    messageId: randomUUID(),
    contextId,
    role: "ROLE_AGENT",
    parts: [{ text: truncateUtf16Safe(text, A2A_ERROR_MAX_LENGTH) }],
  };
}

function encodePageToken(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodePageToken(token: string | undefined): number {
  if (!token) {
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    const offset = (parsed as { offset?: unknown }).offset;
    return typeof offset === "number" && Number.isInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

export class A2aTaskStore {
  readonly #tasks = new Map<string, A2aTaskRecord>();
  readonly #taskOwners = new Map<string, string>();
  readonly #pendingByContext = new Map<string, string[]>();
  readonly #terminalTasks = new Map<string, number>();
  readonly #waiters = new Map<string, Set<A2aTaskWaiter>>();
  readonly #abortControllers = new Map<string, AbortController>();
  readonly #subscribers = new Map<string, Set<A2aTaskSubscriber>>();
  readonly #streamArtifactIds = new Map<string, string>();
  readonly #pushConfigs = new Map<string, Map<string, A2aPushNotificationConfig>>();
  readonly #persistence: A2aTaskPersistence | undefined;
  readonly #onPersistenceError: (error: unknown) => void;
  readonly #onPushUpdate: A2aTaskStoreOptions["onPushUpdate"];
  #persistChain: Promise<void> = Promise.resolve();

  constructor(options: A2aTaskStoreOptions = {}) {
    this.#persistence = options.persistence;
    this.#onPersistenceError = options.onPersistenceError ?? (() => {});
    this.#onPushUpdate = options.onPushUpdate;
  }

  /**
   * Loads persisted tasks. A task that was still running when the gateway
   * stopped has no live run left to finish it, so it settles as failed.
   */
  async restore(): Promise<void> {
    if (!this.#persistence) {
      return;
    }
    const entries = await this.#persistence.loadAll();
    for (const entry of entries) {
      const task = entry.task;
      this.#tasks.set(task.id, task);
      if (entry.ownerPeer !== undefined) {
        this.#taskOwners.set(task.id, entry.ownerPeer);
      }
      if (entry.pushConfigs?.length) {
        this.#pushConfigs.set(
          task.id,
          new Map(entry.pushConfigs.map((config) => [config.id, config])),
        );
      }
      if (isTerminalTask(task)) {
        this.#terminalTasks.set(task.id, entry.finishedAt ?? Date.parse(task.status.timestamp));
        continue;
      }
      task.status = {
        state: "TASK_STATE_FAILED",
        timestamp: new Date().toISOString(),
        message: createStatusMessage(task.contextId, A2A_RESTART_INTERRUPTED_MESSAGE),
      };
      this.#terminalTasks.set(task.id, Date.now());
      this.#persist(task.id);
    }
    this.#sortTerminalTasks();
    this.#pruneTerminalTasks();
  }

  create(contextId: string, ownerPeer?: string): A2aTaskRecord {
    this.#pruneTerminalTasks();
    const task: A2aTaskRecord = {
      id: randomUUID(),
      contextId,
      status: { state: "TASK_STATE_SUBMITTED", timestamp: new Date().toISOString() },
      artifacts: [],
      history: [],
    };
    this.#tasks.set(task.id, task);
    this.#abortControllers.set(task.id, new AbortController());
    if (ownerPeer !== undefined) {
      this.#taskOwners.set(task.id, ownerPeer);
    }
    const conversationKey = this.#conversationKey(contextId, ownerPeer);
    const pending = this.#pendingByContext.get(conversationKey) ?? [];
    pending.push(task.id);
    this.#pendingByContext.set(conversationKey, pending);
    this.#persist(task.id);
    return task;
  }

  get(taskId: string, ownerPeer?: string): A2aTaskRecord | undefined {
    this.#pruneTerminalTasks();
    if (ownerPeer !== undefined && this.#taskOwners.get(taskId) !== ownerPeer) {
      return undefined;
    }
    return this.#tasks.get(taskId);
  }

  /** Abort signal handed to the agent run that serves this task. */
  abortSignal(taskId: string): AbortSignal | undefined {
    return this.#abortControllers.get(taskId)?.signal;
  }

  start(taskId: string): A2aTaskRecord | undefined {
    const task = this.#tasks.get(taskId);
    if (task?.status.state === "TASK_STATE_SUBMITTED") {
      task.status = { state: "TASK_STATE_WORKING", timestamp: new Date().toISOString() };
      this.#publishStatus(task);
      this.#persist(task.id);
    }
    return task;
  }

  list(ownerPeer: string | undefined, query: A2aListTasksQuery = {}): A2aListTasksResult {
    this.#pruneTerminalTasks();
    const after = query.statusTimestampAfter ? Date.parse(query.statusTimestampAfter) : undefined;
    const matching = [...this.#tasks.values()]
      .filter((task) => ownerPeer === undefined || this.#taskOwners.get(task.id) === ownerPeer)
      .filter((task) => query.contextId === undefined || task.contextId === query.contextId)
      .filter((task) => query.status === undefined || task.status.state === query.status)
      .filter((task) => after === undefined || Date.parse(task.status.timestamp) >= after)
      .toSorted(
        (left, right) =>
          right.status.timestamp.localeCompare(left.status.timestamp) ||
          left.id.localeCompare(right.id),
      );
    const pageSize = query.pageSize ?? A2A_LIST_TASKS_DEFAULT_PAGE_SIZE;
    const offset = decodePageToken(query.pageToken);
    const page = matching.slice(offset, offset + pageSize);
    const nextOffset = offset + page.length;
    return {
      tasks: page.map((task) => (query.includeArtifacts ? task : { ...task, artifacts: [] })),
      nextPageToken: nextOffset < matching.length ? encodePageToken(nextOffset) : "",
      pageSize,
      totalSize: matching.length,
    };
  }

  /** Streams a reply in progress: `append` adds a chunk, otherwise the text replaces it. */
  publishPartial(taskId: string, text: string, append: boolean): void {
    const task = this.#tasks.get(taskId);
    if (!task || isTerminalTask(task) || !text) {
      return;
    }
    let artifactId = this.#streamArtifactIds.get(taskId);
    if (!artifactId) {
      artifactId = randomUUID();
      this.#streamArtifactIds.set(taskId, artifactId);
    }
    this.#publish(task.id, {
      artifactUpdate: {
        taskId: task.id,
        contextId: task.contextId,
        artifact: { artifactId, parts: [{ text }] },
        append,
        lastChunk: false,
      },
    });
  }

  completeNext(
    contextId: string,
    text: string | undefined,
    ownerPeer?: string,
    originTaskId?: string,
  ): A2aTaskRecord | undefined {
    // A canceled run may still deliver its final reply; that reply belongs to
    // the canceled task and must not complete the next task in the conversation.
    if (originTaskId !== undefined) {
      const origin = this.#tasks.get(originTaskId);
      if (origin?.status.state === "TASK_STATE_CANCELED") {
        return undefined;
      }
    }
    const conversationKey = this.#conversationKey(contextId, ownerPeer);
    const queue = this.#pendingByContext.get(conversationKey);
    if (!queue?.length) {
      return undefined;
    }
    const nextTaskId = queue.shift();
    if (queue.length === 0) {
      this.#pendingByContext.delete(conversationKey);
    }
    if (!nextTaskId) {
      return undefined;
    }

    const task = this.#tasks.get(nextTaskId);
    if (!task || isTerminalTask(task)) {
      return undefined;
    }
    if (text?.trim()) {
      const artifact: A2aTaskArtifact = {
        artifactId: this.#streamArtifactIds.get(task.id) ?? randomUUID(),
        parts: [{ text }],
      };
      task.artifacts = [artifact];
      this.#publish(task.id, {
        artifactUpdate: {
          taskId: task.id,
          contextId: task.contextId,
          artifact,
          append: false,
          lastChunk: true,
        },
      });
    }
    task.status = {
      state: "TASK_STATE_COMPLETED",
      timestamp: new Date().toISOString(),
      ...(!text?.trim()
        ? { message: createStatusMessage(contextId, "Agent completed without reply text") }
        : {}),
    };
    return this.#finishTask(task);
  }

  fail(taskId: string, error: unknown): A2aTaskRecord | undefined {
    const reason = error instanceof Error ? error.message : String(error);
    return this.#finishWithMessage(taskId, "TASK_STATE_FAILED", reason);
  }

  reject(taskId: string, reason: string): A2aTaskRecord | undefined {
    return this.#finishWithMessage(taskId, "TASK_STATE_REJECTED", reason);
  }

  /** Cancels a caller's task and aborts the agent run serving it. */
  cancel(
    taskId: string,
    ownerPeer?: string,
  ): { task: A2aTaskRecord } | { error: "not-found" | "not-cancelable" } {
    const task = this.get(taskId, ownerPeer);
    if (!task) {
      return { error: "not-found" };
    }
    if (isTerminalTask(task)) {
      return { error: "not-cancelable" };
    }
    this.#removeFromQueue(task);
    task.status = { state: "TASK_STATE_CANCELED", timestamp: new Date().toISOString() };
    const controller = this.#abortControllers.get(task.id);
    this.#finishTask(task);
    controller?.abort(new Error("A2A task canceled by peer"));
    return { task };
  }

  /**
   * Subscribes to a live task's updates. Returns undefined for a terminal task;
   * the subscription closes after the task's final status update.
   */
  subscribe(
    taskId: string,
    onEvent: A2aTaskSubscriber["onEvent"],
    onClose: A2aTaskSubscriber["onClose"],
  ): (() => void) | undefined {
    const task = this.#tasks.get(taskId);
    if (!task || isTerminalTask(task)) {
      return undefined;
    }
    const subscriber: A2aTaskSubscriber = { onEvent, onClose };
    const subscribers = this.#subscribers.get(taskId) ?? new Set<A2aTaskSubscriber>();
    subscribers.add(subscriber);
    this.#subscribers.set(taskId, subscribers);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) {
        this.#subscribers.delete(taskId);
      }
    };
  }

  setPushConfig(
    taskId: string,
    ownerPeer: string | undefined,
    config: Omit<A2aPushNotificationConfig, "taskId" | "id"> & { id?: string },
  ): A2aPushNotificationConfig | undefined {
    const task = this.get(taskId, ownerPeer);
    if (!task) {
      return undefined;
    }
    const stored: A2aPushNotificationConfig = {
      id: config.id ?? randomUUID(),
      taskId,
      url: config.url,
      ...(config.token !== undefined ? { token: config.token } : {}),
      ...(config.authentication ? { authentication: config.authentication } : {}),
    };
    const configs = this.#pushConfigs.get(taskId) ?? new Map<string, A2aPushNotificationConfig>();
    configs.set(stored.id, stored);
    this.#pushConfigs.set(taskId, configs);
    this.#persist(taskId);
    return stored;
  }

  getPushConfig(
    taskId: string,
    ownerPeer: string | undefined,
    configId: string,
  ): A2aPushNotificationConfig | undefined {
    return this.get(taskId, ownerPeer) ? this.#pushConfigs.get(taskId)?.get(configId) : undefined;
  }

  listPushConfigs(
    taskId: string,
    ownerPeer: string | undefined,
  ): A2aPushNotificationConfig[] | undefined {
    return this.get(taskId, ownerPeer)
      ? [...(this.#pushConfigs.get(taskId)?.values() ?? [])]
      : undefined;
  }

  deletePushConfig(taskId: string, ownerPeer: string | undefined, configId: string): boolean {
    if (!this.get(taskId, ownerPeer)) {
      return false;
    }
    const deleted = this.#pushConfigs.get(taskId)?.delete(configId) ?? false;
    if (deleted) {
      this.#persist(taskId);
    }
    return deleted;
  }

  wait(taskId: string, timeoutMs: number): Promise<A2aTaskRecord | undefined> {
    const task = this.get(taskId);
    if (!task || isTerminalTask(task)) {
      return Promise.resolve(task);
    }
    return new Promise((resolve) => {
      const waiters = this.#waiters.get(taskId) ?? new Set<A2aTaskWaiter>();
      const waiter: A2aTaskWaiter = {
        resolve,
        timer: setTimeout(() => {
          waiters.delete(waiter);
          if (waiters.size === 0) {
            this.#waiters.delete(taskId);
          }
          resolve(task);
        }, timeoutMs),
      };
      waiters.add(waiter);
      this.#waiters.set(taskId, waiters);
    });
  }

  /** Resolves once every queued durable write has settled. */
  async flush(): Promise<void> {
    await this.#persistChain;
  }

  stop(): void {
    for (const [taskId, waiters] of this.#waiters) {
      const task = this.#tasks.get(taskId);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        if (task) {
          waiter.resolve(task);
        }
      }
    }
    for (const subscribers of this.#subscribers.values()) {
      for (const subscriber of subscribers) {
        subscriber.onClose();
      }
    }
    this.#subscribers.clear();
    this.#waiters.clear();
    this.#pendingByContext.clear();
    this.#terminalTasks.clear();
    this.#taskOwners.clear();
    this.#abortControllers.clear();
    this.#streamArtifactIds.clear();
    this.#pushConfigs.clear();
    this.#tasks.clear();
  }

  #finishWithMessage(
    taskId: string,
    state: "TASK_STATE_FAILED" | "TASK_STATE_REJECTED",
    reason: string,
  ): A2aTaskRecord | undefined {
    const task = this.#tasks.get(taskId);
    if (!task || isTerminalTask(task)) {
      return task;
    }
    this.#removeFromQueue(task);
    task.status = {
      state,
      timestamp: new Date().toISOString(),
      message: createStatusMessage(task.contextId, reason),
    };
    return this.#finishTask(task);
  }

  #removeFromQueue(task: A2aTaskRecord): void {
    const conversationKey = this.#conversationKey(task.contextId, this.#taskOwners.get(task.id));
    const queue = this.#pendingByContext.get(conversationKey);
    if (!queue) {
      return;
    }
    const position = queue.indexOf(task.id);
    if (position !== -1) {
      queue.splice(position, 1);
    }
    if (queue.length === 0) {
      this.#pendingByContext.delete(conversationKey);
    }
  }

  #finishTask(task: A2aTaskRecord): A2aTaskRecord {
    this.#terminalTasks.set(task.id, Date.now());
    this.#abortControllers.delete(task.id);
    this.#streamArtifactIds.delete(task.id);
    const waiters = this.#waiters.get(task.id);
    if (waiters) {
      this.#waiters.delete(task.id);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(task);
      }
    }
    this.#publishStatus(task);
    const subscribers = this.#subscribers.get(task.id);
    if (subscribers) {
      this.#subscribers.delete(task.id);
      for (const subscriber of subscribers) {
        subscriber.onClose();
      }
    }
    this.#persist(task.id);
    this.#pruneTerminalTasks();
    return task;
  }

  #publishStatus(task: A2aTaskRecord): void {
    this.#publish(task.id, {
      statusUpdate: { taskId: task.id, contextId: task.contextId, status: task.status },
    });
    const configs = this.#pushConfigs.get(task.id);
    if (configs?.size && this.#onPushUpdate) {
      this.#onPushUpdate(task, [...configs.values()]);
    }
  }

  #publish(taskId: string, event: A2aStreamEvent): void {
    for (const subscriber of this.#subscribers.get(taskId) ?? []) {
      subscriber.onEvent(event);
    }
  }

  #persist(taskId: string): void {
    const persistence = this.#persistence;
    const task = this.#tasks.get(taskId);
    if (!persistence || !task) {
      return;
    }
    const ownerPeer = this.#taskOwners.get(taskId);
    const finishedAt = this.#terminalTasks.get(taskId);
    const pushConfigs = [...(this.#pushConfigs.get(taskId)?.values() ?? [])];
    // Snapshot now so later in-memory changes cannot reorder durable state.
    const entry: A2aPersistedTask = structuredClone({
      task,
      ...(ownerPeer !== undefined ? { ownerPeer } : {}),
      ...(finishedAt !== undefined ? { finishedAt } : {}),
      ...(pushConfigs.length > 0 ? { pushConfigs } : {}),
    });
    this.#enqueuePersistence(() => persistence.save(entry));
  }

  #enqueuePersistence(write: () => Promise<void>): void {
    this.#persistChain = this.#persistChain.then(write).catch(this.#onPersistenceError);
  }

  #sortTerminalTasks(): void {
    const ordered = [...this.#terminalTasks.entries()].toSorted((left, right) => left[1] - right[1]);
    this.#terminalTasks.clear();
    for (const [taskId, finishedAt] of ordered) {
      this.#terminalTasks.set(taskId, finishedAt);
    }
  }

  #pruneTerminalTasks(): void {
    const expiresBefore = Date.now() - A2A_TERMINAL_RETENTION_MS;
    for (const [taskId, finishedAt] of this.#terminalTasks) {
      if (finishedAt > expiresBefore && this.#terminalTasks.size <= A2A_TERMINAL_MAX_TASKS) {
        break;
      }
      const ownerPeer = this.#taskOwners.get(taskId);
      this.#terminalTasks.delete(taskId);
      this.#taskOwners.delete(taskId);
      this.#pushConfigs.delete(taskId);
      this.#tasks.delete(taskId);
      const persistence = this.#persistence;
      if (persistence) {
        this.#enqueuePersistence(() => persistence.delete(taskId, ownerPeer));
      }
    }
  }

  #conversationKey(contextId: string, ownerPeer?: string): string {
    return ownerPeer === undefined ? contextId : `${ownerPeer}\0${contextId}`;
  }
}
