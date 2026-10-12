import { afterEach, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { reserveSqliteWorkerInputPreparation } from "../infra/sqlite-worker-store.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db-cache.js";
import {
  clearBranchStateDatabaseOpenFailure,
  recordBranchStateDatabaseOpenFailure,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import {
  createPluginBlobStoreForTests,
  resetPluginBlobStoreForTests,
} from "./plugin-blob-store.js";

const dirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    try {
      await closeBranchStateDatabaseAsync();
      resetPluginBlobStoreForTests();
    } finally {
      cleanup();
    }
  }),
);
const MIB = 1024 * 1024;
function fixture() {
  const env = { ...process.env, BRANCH_STATE_DIR: dirs.make("blob-input-preparation-") };
  const store = createPluginBlobStoreForTests(
    "blob-admission",
    {
      namespace: "prepared",
      maxEntries: 1,
      maxBytesPerEntry: 100 * MIB,
      maxBytesPerNamespace: 100 * MIB,
    },
    env,
  );
  return { env, store };
}

it.each(["register", "registerIfAbsent"] as const)(
  "%s bounds copied payloads before awaiting worker preparation",
  async (method) => {
    const { store } = fixture();
    const concurrentInputs = Array.from({ length: 3 }, () =>
      reserveSqliteWorkerInputPreparation(64 * MIB),
    );
    const bytes = new Uint8Array(16 * MIB).fill(7);
    const pending = Array.from({ length: 3 }, () =>
      store[method]("same-key", bytes, { version: 1 }),
    );
    const refused = store[method]("same-key", bytes, { version: 1 });
    void refused.catch(() => undefined);
    try {
      expect(() => {
        const extra = reserveSqliteWorkerInputPreparation(16 * MIB);
        extra.release();
      }).toThrow(expect.objectContaining({ code: "overloaded" }));
      bytes.fill(9);
      await expect(refused).rejects.toMatchObject({
        code: "PLUGIN_BLOB_OPEN_FAILED",
        cause: { code: "overloaded" },
      });
      await Promise.all(pending);
      const entry = await store.lookup("same-key");
      expect(entry?.bytes.byteLength).toBe(16 * MIB);
      expect(entry?.bytes[0]).toBe(7);
      expect(entry?.bytes.at(-1)).toBe(7);
      expect(entry?.metadata).toEqual({ version: 1 });
      const recovered = reserveSqliteWorkerInputPreparation(64 * MIB);
      recovered.release();
    } finally {
      for (const preparation of concurrentInputs) {
        preparation.release();
      }
      await Promise.allSettled([...pending, refused]);
    }
  },
);

it.each(["copy", "admission"] as const)(
  "releases captured capacity after %s fails",
  async (failure) => {
    const { env, store } = fixture();
    const concurrentInputs = Array.from({ length: 3 }, () =>
      reserveSqliteWorkerInputPreparation(64 * MIB),
    );
    const pathname = resolveBranchStateSqlitePath(env);
    const cause = new Error(`${failure} failed`);
    const bytes = new Uint8Array(16 * MIB);
    if (failure === "copy") {
      structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    } else {
      recordBranchStateDatabaseOpenFailure(pathname, cause);
    }
    try {
      await expect(store.register("failed", bytes, null)).rejects.toMatchObject({
        code: "PLUGIN_BLOB_OPEN_FAILED",
      });
      const recovered = reserveSqliteWorkerInputPreparation(64 * MIB);
      recovered.release();
    } finally {
      for (const preparation of concurrentInputs) {
        preparation.release();
      }
      clearBranchStateDatabaseOpenFailure(pathname);
    }
  },
);
