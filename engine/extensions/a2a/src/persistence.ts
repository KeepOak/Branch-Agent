import { gunzipSync, gzipSync } from "node:zlib";
import type { PluginBlobStore, OpenBlobStoreOptions } from "branch/plugin-sdk/plugin-state-runtime";
import type { A2aPersistedTask, A2aTaskPersistence } from "./task-store.js";

// Ported from gemini-cli packages/a2a-server/src/persistence/gcs.ts. Upstream
// writes `tasks/<id>/metadata.tar.gz` (gzip JSON) to a GCS bucket; Branch keeps
// the same gzip-JSON object in its own plugin state database so tasks survive a
// gateway restart without a cloud bucket. Upstream's second object, the agent's
// workspace archive, has no A2A counterpart here: a Branch task runs in an
// agent session whose transcript and workspace the session store already keeps.

type ObjectType = "metadata";

type A2aTaskBlobMetadata = {
  taskId: string;
  ownerPeer?: string;
};

// Plugin blob limits are host-wide maxima; none is tighter than the in-memory
// task retention (500 finished tasks for 24 hours, plus live tasks).
export const A2A_TASK_BLOB_STORE_OPTIONS: OpenBlobStoreOptions = {
  namespace: "a2a.tasks",
  maxEntries: 50_000,
  maxBytesPerEntry: 16 * 1024 * 1024,
  maxBytesPerNamespace: 512 * 1024 * 1024,
  overflowPolicy: "evict-oldest",
};

// Validate the taskId to prevent path traversal attacks by ensuring it only contains safe characters.
export const isTaskIdValid = (taskId: string): boolean => {
  // Allow only alphanumeric characters, dashes, and underscores, and ensure it's not empty.
  const validTaskIdRegex = /^[a-zA-Z0-9_-]+$/;
  return validTaskIdRegex.test(taskId);
};

const isOwnerPeerValid = (ownerPeer: string): boolean => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(ownerPeer);

export function getObjectPath(taskId: string, type: ObjectType, ownerPeer?: string): string {
  if (!isTaskIdValid(taskId)) {
    throw new Error(`Invalid taskId: ${taskId}`);
  }
  if (ownerPeer !== undefined && !isOwnerPeerValid(ownerPeer)) {
    throw new Error(`Invalid task owner: ${ownerPeer}`);
  }
  // Records are keyed by caller so one peer's task id never addresses another's.
  return `tasks/${ownerPeer ?? "-"}/${taskId}/${type}.json.gz`;
}

export class A2aStateTaskPersistence implements A2aTaskPersistence {
  constructor(private readonly store: PluginBlobStore<A2aTaskBlobMetadata>) {}

  async save(entry: A2aPersistedTask): Promise<void> {
    const taskId = entry.task.id;
    const objectPath = getObjectPath(taskId, "metadata", entry.ownerPeer);
    const compressed = gzipSync(Buffer.from(JSON.stringify(entry)));
    await this.store.register(objectPath, compressed, {
      taskId,
      ...(entry.ownerPeer !== undefined ? { ownerPeer: entry.ownerPeer } : {}),
    });
  }

  async load(taskId: string, ownerPeer?: string): Promise<A2aPersistedTask | undefined> {
    const objectPath = getObjectPath(taskId, "metadata", ownerPeer);
    const stored = await this.store.lookup(objectPath);
    if (!stored) {
      return undefined;
    }
    return this.#decode(stored.bytes, taskId);
  }

  async delete(taskId: string, ownerPeer?: string): Promise<void> {
    await this.store.delete(getObjectPath(taskId, "metadata", ownerPeer));
  }

  async loadAll(onCorrupt?: (error: unknown) => void): Promise<A2aPersistedTask[]> {
    const loaded: A2aPersistedTask[] = [];
    for (const info of await this.store.entries()) {
      const { taskId, ownerPeer } = info.metadata;
      try {
        const entry = await this.load(taskId, ownerPeer);
        if (entry) {
          loaded.push(entry);
        }
      } catch (error) {
        // One unreadable record must not keep every other task from loading.
        onCorrupt?.(error);
      }
    }
    return loaded;
  }

  #decode(bytes: Uint8Array, taskId: string): A2aPersistedTask {
    const parsed: unknown = JSON.parse(gunzipSync(bytes).toString());
    const entry = parsed as Partial<A2aPersistedTask> | null;
    if (!entry?.task || entry.task.id !== taskId || !entry.task.status?.state) {
      throw new Error(`Loaded metadata for task ${taskId} is missing internal persisted state.`);
    }
    return entry as A2aPersistedTask;
  }
}
