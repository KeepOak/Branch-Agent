// Adapted from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf
// plugins/plugin-assistant/src/features/working-memory/taskClipboardService.ts.
// Task working memory: complete per-task results kept for later steps of the
// same task. This is not the user-facing todo list; it is runtime working memory.
import crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveStateDir } from "branch/plugin-sdk/memory-core-host-engine-foundation";

export type TaskClipboardSourceType =
  | "manual"
  | "command"
  | "file"
  | "attachment"
  | "image_attachment"
  | "channel"
  | "conversation_search"
  | "entity"
  | "entity_search"
  | "action_result";

export const TASK_CLIPBOARD_SOURCE_TYPES: readonly TaskClipboardSourceType[] = [
  "manual",
  "command",
  "file",
  "attachment",
  "image_attachment",
  "channel",
  "conversation_search",
  "entity",
  "entity_search",
  "action_result",
];

export interface TaskClipboardItem {
  id: string;
  title: string;
  content: string;
  sourceType: TaskClipboardSourceType;
  sourceId?: string;
  sourceLabel?: string;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskClipboardSnapshot {
  items: TaskClipboardItem[];
}

export interface AddTaskClipboardItemInput {
  title?: string;
  content: string;
  sourceType?: TaskClipboardSourceType;
  sourceId?: string;
  sourceLabel?: string;
  mimeType?: string;
}

export interface TaskClipboardConfig {
  basePath: string;
}

export function defaultTaskClipboardBasePath(): string {
  return path.join(resolveStateDir(), "memory-core", "task-clipboard");
}

const TASK_CLIPBOARD_FILE = "clipboard.json";
const CLIPBOARD_DIR = "clipboard";

type TaskClipboardStore = {
  version: 1;
  items: TaskClipboardItem[];
};

function createDefaultStore(): TaskClipboardStore {
  return { version: 1, items: [] };
}

function sanitizeTitle(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function defaultTitleForInput(input: AddTaskClipboardItemInput): string {
  if (input.title?.trim()) {
    return sanitizeTitle(input.title);
  }
  if (input.sourceType === "command") {
    return sanitizeTitle(input.sourceLabel ?? input.sourceId ?? "Command");
  }
  if (input.sourceType === "attachment" || input.sourceType === "image_attachment") {
    return sanitizeTitle(input.sourceLabel ?? input.sourceId ?? "Attachment");
  }
  if (input.sourceType === "file") {
    return sanitizeTitle(input.sourceLabel ?? input.sourceId ?? "File");
  }
  return "Clipboard Item";
}

function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function isClipboardItem(item: unknown): item is TaskClipboardItem {
  const record = item as Partial<TaskClipboardItem> | null;
  return Boolean(
    record &&
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.content === "string" &&
    typeof record.sourceType === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string",
  );
}

/** Serializes complete read-modify-write cycles for one clipboard file. */
const storeMutations = new Map<string, Promise<void>>();

function withStoreMutation<T>(storePath: string, mutate: () => Promise<T>): Promise<T> {
  const predecessor = storeMutations.get(storePath) ?? Promise.resolve();
  const operation = predecessor.then(mutate);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  storeMutations.set(storePath, tail);
  void tail.then(() => {
    if (storeMutations.get(storePath) === tail) {
      storeMutations.delete(storePath);
    }
  });
  return operation;
}

export class TaskClipboardService {
  private readonly config: TaskClipboardConfig;

  constructor(config?: Partial<TaskClipboardConfig>) {
    this.config = { basePath: config?.basePath ?? defaultTaskClipboardBasePath() };
  }

  private getStorePath(taskKey?: string): string {
    if (taskKey) {
      const safeId = taskKey.replace(/[^a-zA-Z0-9_-]/g, "_");
      return path.join(this.config.basePath, CLIPBOARD_DIR, `${safeId}.json`);
    }
    return path.join(this.config.basePath, TASK_CLIPBOARD_FILE);
  }

  private async readStore(taskKey?: string): Promise<TaskClipboardStore> {
    const storePath = this.getStorePath(taskKey);
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    try {
      const raw = await fs.readFile(storePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<TaskClipboardStore> | null;
      if (!parsed || !Array.isArray(parsed.items)) {
        return createDefaultStore();
      }
      return {
        version: 1,
        items: parsed.items
          .filter(isClipboardItem)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      };
    } catch (error) {
      // A missing store is the designed empty state. Corrupt or unreadable
      // stores are failures and must not look newly initialized.
      if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") {
        return createDefaultStore();
      }
      throw new Error(`Failed to read task clipboard store at ${storePath}`, { cause: error });
    }
  }

  private async writeStore(store: TaskClipboardStore, taskKey?: string): Promise<void> {
    const storePath = this.getStorePath(taskKey);
    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const tempPath = `${storePath}.tmp-${crypto.randomUUID()}`;
    await fs.writeFile(tempPath, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(tempPath, storePath);
  }

  async getSnapshot(taskKey?: string): Promise<TaskClipboardSnapshot> {
    const store = await this.readStore(taskKey);
    return { items: [...store.items] };
  }

  async listItems(taskKey?: string): Promise<TaskClipboardItem[]> {
    return (await this.getSnapshot(taskKey)).items;
  }

  async getItem(id: string, taskKey?: string): Promise<TaskClipboardItem | null> {
    const items = await this.listItems(taskKey);
    return items.find((item) => item.id === id) ?? null;
  }

  async addItem(
    input: AddTaskClipboardItemInput,
    taskKey?: string,
  ): Promise<{ item: TaskClipboardItem; replaced: boolean; snapshot: TaskClipboardSnapshot }> {
    return withStoreMutation(this.getStorePath(taskKey), () =>
      this.addItemUnlocked(input, taskKey),
    );
  }

  private async addItemUnlocked(
    input: AddTaskClipboardItemInput,
    taskKey?: string,
  ): Promise<{ item: TaskClipboardItem; replaced: boolean; snapshot: TaskClipboardSnapshot }> {
    const content = normalizeContent(input.content);
    if (!content) {
      throw new Error("Clipboard items require non-empty content.");
    }
    const store = await this.readStore(taskKey);
    const now = new Date().toISOString();
    const replacementIndex =
      input.sourceType && input.sourceId
        ? store.items.findIndex(
            (item) => item.sourceType === input.sourceType && item.sourceId === input.sourceId,
          )
        : -1;
    const existing = replacementIndex >= 0 ? store.items[replacementIndex] : null;
    const item: TaskClipboardItem = {
      id: existing?.id ?? `cb-${crypto.randomUUID().slice(0, 8)}`,
      title: defaultTitleForInput(input),
      content,
      sourceType: input.sourceType ?? "manual",
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (replacementIndex >= 0) {
      store.items[replacementIndex] = item;
    } else {
      store.items.unshift(item);
    }
    store.items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    await this.writeStore(store, taskKey);
    return { item, replaced: replacementIndex >= 0, snapshot: { items: [...store.items] } };
  }

  async removeItem(
    id: string,
    taskKey?: string,
  ): Promise<{ removed: boolean; snapshot: TaskClipboardSnapshot }> {
    return withStoreMutation(this.getStorePath(taskKey), () =>
      this.removeItemUnlocked(id, taskKey),
    );
  }

  private async removeItemUnlocked(
    id: string,
    taskKey?: string,
  ): Promise<{ removed: boolean; snapshot: TaskClipboardSnapshot }> {
    const store = await this.readStore(taskKey);
    const nextItems = store.items.filter((item) => item.id !== id);
    if (nextItems.length === store.items.length) {
      return { removed: false, snapshot: { items: [...store.items] } };
    }
    store.items = nextItems;
    await this.writeStore(store, taskKey);
    return { removed: true, snapshot: { items: [...store.items] } };
  }
}

export function createTaskClipboardService(
  config?: Partial<TaskClipboardConfig>,
): TaskClipboardService {
  return new TaskClipboardService(config);
}
