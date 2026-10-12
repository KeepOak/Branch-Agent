import { randomUUID } from "node:crypto";
import type { EmbeddedRunAttemptParamsV2 } from "branch/plugin-sdk/agent-harness-runtime";
import {
  acquireHostHeavyStep,
  bindHostHeavyStep,
  createHostHeavyStepEnvironment,
  resolveHeavyStepCommand,
  resolveHeavyStepMemoryNeed,
  type HostHeavyStepHandle,
} from "branch/plugin-sdk/native-hook-relay-runtime";
import { protectCodexAppServerLiveThread } from "./client-runtime.js";
import type { CodexAppServerClient } from "./client.js";
import {
  readCodexNotificationThreadId,
  readCodexNotificationTurnId,
} from "./notification-correlation.js";
import { isJsonObject } from "./protocol.js";
import { retainSharedCodexAppServerClientIfCurrent } from "./shared-client.js";

type RetainedSource = NonNullable<
  ReturnType<NonNullable<EmbeddedRunAttemptParamsV2["hostCapabilities"]["retainSourceAuthority"]>>
>;
type NativeTurn = { threadId: string; turnId: string };
type NativeCommand = NativeTurn & { itemId: string };
type ProcessCustody = { terminate: () => Promise<void> };
type CommandAdmission = NativeCommand & {
  owner: CodexNativeProcessAuthority;
  client: CodexNativeProcessClient;
  parentTurn: NativeTurn;
  accepting: boolean;
  background?: { processId: string | null; confirmed: boolean };
  processes: Set<ProcessCustody>;
  assertActive: () => void;
  releaseClient?: () => void;
  releaseThread: () => void;
  heavyStep?: HostHeavyStepHandle;
  heavyReleasing?: boolean;
};

const clients = new WeakMap<CodexAppServerClient, CodexNativeProcessClient>();

/** A physical client joins native call receipts to its concrete sandbox processes. */
export function getCodexNativeProcessClient(
  client: CodexAppServerClient,
): CodexNativeProcessClient {
  let owner = clients.get(client);
  if (!owner) {
    owner = new CodexNativeProcessClient(client);
    clients.set(client, owner);
  }
  return owner;
}

/** Read the native process owner's live inventory, never infer custody from a start event. */
export async function readCodexRetainedBackgroundCommands(params: {
  client: CodexAppServerClient;
  threadId: string;
  turnId: string;
  commands: ReadonlyMap<string, string | null>;
  authority?: CodexNativeProcessAuthority;
  assertCurrent: () => void;
  signal: AbortSignal;
  timeoutMs: number;
}): Promise<() => ReadonlyMap<string, string>> {
  params.assertCurrent();
  const retain = !params.authority?.requiresProcessAdmission
    ? params.authority?.prepareBackgroundCommands(params.client, params, params.commands)
    : undefined;
  const { data } = await params.client
    .request(
      "thread/backgroundTerminals/list",
      { threadId: params.threadId },
      { signal: params.signal, timeoutMs: params.timeoutMs },
    )
    .catch((error: unknown) => {
      retain?.(new Map(), false);
      throw error;
    });
  params.signal.throwIfAborted();
  params.assertCurrent();
  // Consumption follows a second notification drain. Recheck source custody then,
  // so revocation during that await cannot turn an orphan into retained work.
  return () => {
    params.signal.throwIfAborted();
    params.assertCurrent();
    const retained = new Map<string, string>();
    for (const { itemId, processId } of data) {
      if (
        params.commands.has(itemId) &&
        // Approval starts omit the process ID; the native inventory supplies it.
        (params.commands.get(itemId) === null || params.commands.get(itemId) === processId) &&
        (!params.authority?.requiresProcessAdmission ||
          params.authority.ownsCurrentCommand(params.client, {
            threadId: params.threadId,
            turnId: params.turnId,
            itemId,
          }))
      ) {
        retained.set(itemId, processId);
      }
    }
    return retain?.(retained) ?? retained;
  };
}

export class CodexNativeProcessClient {
  readonly id = randomUUID();
  readonly authPath = `/branch-${randomUUID()}`;
  private readonly threads = new Map<string, Map<string, CommandAdmission>>();
  private closed = false;

  constructor(private readonly client: CodexAppServerClient) {
    client.addNotificationHandler((notification) => {
      if (!isJsonObject(notification.params)) {
        return;
      }
      const threadId = readCodexNotificationThreadId(notification.params);
      const turnId = readCodexNotificationTurnId(notification.params);
      const commands = threadId ? this.threads.get(threadId) : undefined;
      if (!commands || !turnId) {
        return;
      }
      if (notification.method === "turn/completed") {
        for (const command of commands.values()) {
          if (command.turnId === turnId) {
            this.closeAdmission(command);
          }
        }
      } else if (notification.method === "item/completed") {
        const item = notification.params.item;
        const command =
          isJsonObject(item) && typeof item.id === "string" ? commands.get(item.id) : undefined;
        if (
          command?.turnId === turnId &&
          isJsonObject(item) &&
          item.type === "commandExecution" &&
          (!command.heavyStep ||
            typeof item.exitCode === "number" ||
            item.status === "completed" ||
            item.status === "failed" ||
            item.status === "declined") &&
          (!command.background?.processId ||
            typeof item.processId !== "string" ||
            item.processId === command.background.processId)
        ) {
          command.background = undefined;
          this.closeAdmission(command);
        }
      }
    });
    client.addCloseHandler(() => {
      this.closed = true;
      const owners = new Set<CodexNativeProcessAuthority>();
      for (const commands of this.threads.values()) {
        for (const command of commands.values()) {
          owners.add(command.owner);
        }
      }
      for (const owner of owners) {
        owner.cancelClient(this);
      }
    });
  }

  admit(
    owner: CodexNativeProcessAuthority,
    receipt: NativeCommand,
    parentTurn: NativeTurn,
    assertActive: () => void,
  ): CommandAdmission {
    if (this.closed) {
      throw new Error("Codex process source client is closed");
    }
    let commands = this.threads.get(receipt.threadId);
    const existing = commands?.get(receipt.itemId);
    if (existing) {
      if (existing.owner === owner && existing.turnId === receipt.turnId && existing.accepting) {
        return existing;
      }
      throw new Error("Codex reused an unsettled native command identity");
    }
    if (!commands) {
      commands = new Map();
      this.threads.set(receipt.threadId, commands);
    }
    const command: CommandAdmission = {
      ...receipt,
      owner,
      client: this,
      parentTurn,
      accepting: true,
      processes: new Set(),
      assertActive,
      releaseClient: retainSharedCodexAppServerClientIfCurrent(this.client),
      releaseThread: protectCodexAppServerLiveThread(this.client, receipt.threadId),
    };
    commands.set(receipt.itemId, command);
    owner.commands.add(command);
    return command;
  }

  claim(metadata: unknown, terminate: () => Promise<void>) {
    if (
      this.closed ||
      !isJsonObject(metadata) ||
      typeof metadata.threadId !== "string" ||
      typeof metadata.toolCallId !== "string"
    ) {
      throw new Error("Codex process start requires its admitted native command");
    }
    const command = this.threads.get(metadata.threadId)?.get(metadata.toolCallId);
    if (!command) {
      throw new Error("Codex process start has no admitted native command");
    }
    const assertAdmission = () => {
      command.owner.assertCurrent();
      command.assertActive();
      if (
        this.closed ||
        !command.accepting ||
        this.threads.get(command.threadId)?.get(command.itemId) !== command
      ) {
        throw new Error("Codex native command admission has ended");
      }
    };
    assertAdmission();
    const process = { terminate };
    command.processes.add(process);
    let settled = false;
    return {
      assertAdmission,
      assertCurrent: () => {
        command.owner.assertCurrent();
        if (this.closed || settled) {
          throw new Error("Codex native process authority has ended");
        }
      },
      settle: () => {
        if (settled) {
          return;
        }
        settled = true;
        command.processes.delete(process);
        this.forgetSettled(command);
      },
      fail: (error: unknown) => command.owner.reportSettlementFailure(error),
    };
  }

  closeAdmission(command: CommandAdmission): void {
    command.accepting = false;
    this.forgetSettled(command);
  }

  private forgetSettled(command: CommandAdmission): void {
    if (command.accepting || command.background || command.processes.size > 0) {
      return;
    }
    if (command.heavyStep) {
      if (!command.heavyReleasing) {
        command.heavyReleasing = true;
        void command.heavyStep.release().then(
          () => {
            command.heavyStep = undefined;
            this.forgetSettled(command);
          },
          (error: unknown) => command.owner.reportSettlementFailure(error),
        );
      }
      return;
    }
    const commands = this.threads.get(command.threadId);
    if (commands?.get(command.itemId) === command) {
      commands.delete(command.itemId);
      if (commands.size === 0) {
        this.threads.delete(command.threadId);
      }
    }
    command.owner.commands.delete(command);
    command.releaseThread();
    command.releaseClient?.();
    command.owner.releaseIfSettled();
  }
}

/** Original-source custody outlives foreground authority, never permitting new admission after release. */
export class CodexNativeProcessAuthority {
  readonly commands = new Set<CommandAdmission>();
  readonly heavyStepEnvironment = createHostHeavyStepEnvironment();
  private holds = 1;
  private cancelled = false;
  private released = false;
  private cancellation?: Promise<void>;
  private parentTurn?: NativeTurn & { client: CodexAppServerClient };
  private readonly source: RetainedSource | undefined;
  private readonly onAbort = () => {
    if (!this.cancelled) {
      void this.cancel().catch(this.onCleanupFailure);
    }
  };

  constructor(
    host: EmbeddedRunAttemptParamsV2["hostCapabilities"],
    private readonly onCleanupFailure: (error: unknown) => void,
    readonly requiresProcessAdmission = true,
  ) {
    this.source = host.retainSourceAuthority?.();
    this.source?.signal?.addEventListener("abort", this.onAbort, { once: true });
    if (this.source?.signal?.aborted) {
      this.onAbort();
    }
  }

  assertCurrent(): void {
    if (this.cancelled || this.released) {
      throw new Error("Codex native process source has ended");
    }
    try {
      this.source?.assertCurrent();
      if (this.cancelled || this.released) {
        throw new Error("Codex native process source has ended");
      }
    } catch (error) {
      this.onAbort();
      throw error;
    }
  }

  hasCurrentProcesses(client: CodexAppServerClient, threadId: string): boolean {
    this.assertCurrent();
    return [...this.commands].some(
      (command) =>
        command.client === clients.get(client) &&
        command.threadId === threadId &&
        (command.processes.size > 0 || command.background?.confirmed === true),
    );
  }

  ownsCurrentCommand(client: CodexAppServerClient, receipt: NativeCommand): boolean {
    this.assertCurrent();
    return [...this.commands].some(
      (command) =>
        command.client === clients.get(client) &&
        command.threadId === receipt.threadId &&
        command.turnId === receipt.turnId &&
        command.itemId === receipt.itemId &&
        command.processes.size > 0,
    );
  }

  bindTurn(client: CodexAppServerClient, threadId: string, turnId: string): void {
    this.parentTurn = { client, threadId, turnId };
  }

  admit(
    client: CodexAppServerClient,
    receipt: NativeCommand,
    assertAdmissionCurrent: () => void,
    childParentThreadId?: string,
  ): CommandAdmission {
    this.assertCurrent();
    if (this.holds === 0) {
      throw new Error("Codex native process admission is closed");
    }
    const parent = this.parentTurn;
    if (
      parent?.client !== client ||
      (childParentThreadId
        ? childParentThreadId !== parent.threadId
        : receipt.threadId !== parent.threadId || receipt.turnId !== parent.turnId)
    ) {
      throw new Error("Codex native command does not belong to its admitted turn");
    }
    assertAdmissionCurrent();
    return getCodexNativeProcessClient(client).admit(this, receipt, parent, assertAdmissionCurrent);
  }

  async admitHeavyStep(
    client: CodexAppServerClient,
    receipt: NativeCommand,
    assertAdmissionCurrent: () => void,
    commandText: string,
    signal: AbortSignal | undefined,
    onWait: (message: string) => void,
    childParentThreadId?: string,
  ): Promise<void> {
    this.assertCurrent();
    assertAdmissionCurrent();
    if (
      [...this.commands].some(
        (entry) =>
          entry.client === clients.get(client) &&
          entry.threadId === receipt.threadId &&
          entry.turnId === receipt.turnId &&
          entry.itemId === receipt.itemId,
      )
    ) {
      this.admit(client, receipt, assertAdmissionCurrent, childParentThreadId);
      return;
    }
    const kind = resolveHeavyStepCommand(commandText, resolveHeavyStepMemoryNeed);
    // Remote sandbox execution is admitted on its execution host, not this transport host.
    if (!kind || this.requiresProcessAdmission) {
      this.admit(client, receipt, assertAdmissionCurrent, childParentThreadId);
      return;
    }
    const signals = [signal, this.source?.signal].filter(
      (entry): entry is AbortSignal => entry !== undefined,
    );
    let handle: HostHeavyStepHandle | undefined = await acquireHostHeavyStep(kind, {
      signal: signals.length ? AbortSignal.any(signals) : undefined,
      onWait,
    });
    try {
      handle = bindHostHeavyStep(handle, this.heavyStepEnvironment);
      const command = this.admit(client, receipt, assertAdmissionCurrent, childParentThreadId);
      command.heavyStep = handle;
      if (!this.requiresProcessAdmission) {
        // Native turn completion alone is not evidence that a background terminal stopped.
        command.background = { processId: null, confirmed: true };
      }
      handle = undefined;
    } finally {
      await handle?.release();
    }
  }

  /** Native inventory confirms lifetime only; these receipts never admit sandbox execution. */
  prepareBackgroundCommands(
    client: CodexAppServerClient,
    turn: NativeTurn,
    pending: ReadonlyMap<string, string | null>,
  ): (retained: Map<string, string>, inventoryConfirmed?: boolean) => ReadonlyMap<string, string> {
    this.assertCurrent();
    const entries = new Map<string, CommandAdmission>();
    for (const [itemId, processId] of pending) {
      const command =
        [...this.commands].find(
          (entry) =>
            entry.client === clients.get(client) &&
            entry.threadId === turn.threadId &&
            entry.turnId === turn.turnId &&
            entry.itemId === itemId,
        ) ??
        this.admit(client, { threadId: turn.threadId, turnId: turn.turnId, itemId }, () =>
          this.assertCurrent(),
        );
      command.accepting = false;
      command.background = { processId, confirmed: Boolean(command.heavyStep) };
      entries.set(itemId, command);
    }
    return (retained, inventoryConfirmed = true) => {
      for (const [itemId, command] of entries) {
        const processId = retained.get(itemId);
        if (!this.commands.has(command)) {
          // Completion may arrive while the inventory RPC or projection drain is pending.
          retained.delete(itemId);
        } else if (processId) {
          command.background = { processId, confirmed: true };
        } else if (inventoryConfirmed || !command.heavyStep) {
          command.background = undefined;
          command.client.closeAdmission(command);
        }
      }
      return retained;
    };
  }

  retainAdmission(): () => void {
    this.assertCurrent();
    this.holds += 1;
    let held = true;
    return () => {
      if (held) {
        held = false;
        this.release();
      }
    };
  }

  release(): void {
    if (this.holds === 0) {
      return;
    }
    this.holds -= 1;
    if (this.holds === 0) {
      for (const command of this.commands) {
        if (!command.background?.confirmed) {
          command.background = undefined;
        }
        command.client.closeAdmission(command);
      }
    }
    this.releaseIfSettled();
  }

  releaseIfSettled(): void {
    if (this.released || this.holds > 0 || this.commands.size > 0) {
      return;
    }
    this.released = true;
    this.source?.signal?.removeEventListener("abort", this.onAbort);
    this.source?.release();
  }

  cancelTurn(client: CodexAppServerClient, threadId: string, turnId: string): Promise<void> {
    const owner = getCodexNativeProcessClient(client);
    return this.terminate(
      [...this.commands].filter(
        (command) =>
          command.client === owner &&
          command.parentTurn.threadId === threadId &&
          command.parentTurn.turnId === turnId,
      ),
    );
  }

  cancelClient(client: CodexNativeProcessClient): void {
    void this.terminate([...this.commands].filter((command) => command.client === client)).catch(
      this.onCleanupFailure,
    );
  }

  /** Called only after interruption and native terminal cleanup have both been confirmed. */
  settleTerminatedLocalTurn(client: CodexAppServerClient, threadId: string, turnId: string): void {
    const owner = getCodexNativeProcessClient(client);
    for (const command of this.commands) {
      if (
        !this.requiresProcessAdmission &&
        command.client === owner &&
        command.parentTurn.threadId === threadId &&
        command.parentTurn.turnId === turnId
      ) {
        command.background = undefined;
        command.client.closeAdmission(command);
      }
    }
  }

  reportSettlementFailure(error: unknown): void {
    this.onCleanupFailure(
      new AggregateError(
        [error],
        "Codex native process cleanup failed; background work remains unsettled",
      ),
    );
  }

  private cancel(): Promise<void> {
    this.cancelled = true;
    return (this.cancellation ??= this.terminate([...this.commands]));
  }

  private async terminate(commands: CommandAdmission[]): Promise<void> {
    const processes = commands.flatMap((command) => {
      if (command.heavyStep && !this.requiresProcessAdmission && command.processes.size === 0) {
        // Revocation closes admission, not physical custody. Native cleanup or an exact
        // terminal receipt must confirm the command stopped before freeing its host slot.
        command.accepting = false;
        return [];
      }
      command.background = undefined;
      command.client.closeAdmission(command);
      return [...command.processes];
    });
    // These closures own concrete children. Native numeric process IDs may already belong to a successor.
    const results = await Promise.allSettled(processes.map((process) => process.terminate()));
    const failures = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Codex native process cleanup failed; background work remains unsettled",
      );
    }
  }
}
