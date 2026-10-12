import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearBranchDatabaseQuarantine,
  recordBranchDatabaseQuarantine,
} from "../state/branch-quarantine-store.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseByPathAsync,
} from "../state/branch-state-db-cache.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "../state/branch-state-db-contract.js";
import {
  clearBranchStateDatabaseOpenFailure,
  isBranchStateDatabaseOpen,
  openBranchStateDatabase,
  recordBranchStateDatabaseOpenFailure,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import {
  createPluginBlobStoreForTests,
  resetPluginBlobStoreForTests,
} from "./plugin-blob-store.js";

afterEach(async () => {
  await closeBranchStateDatabaseAsync();
  resetPluginBlobStoreForTests();
});

function createStore(env: NodeJS.ProcessEnv) {
  return createPluginBlobStoreForTests<{ version: number }>(
    "diffs",
    { namespace: "readonly", maxEntries: 3, maxBytesPerEntry: 16, maxBytesPerNamespace: 32 },
    env,
  );
}

describe("plugin blob read-only access", () => {
  it("returns empty reads without creating an absent database", async () => {
    await withBranchTestState({ label: "blob-read-absent", applyEnv: false }, async (state) => {
      const store = createStore(state.env);
      const databasePath = resolveBranchStateSqlitePath(state.env);

      await expect(store.lookup("missing")).resolves.toBeUndefined();
      await expect(store.entries()).resolves.toEqual([]);
      expect(existsSync(path.dirname(databasePath))).toBe(false);
      expect(isBranchStateDatabaseOpen(databasePath)).toBe(false);
    });
  });

  it("reads committed blobs after close without reopening a writable owner", async () => {
    await withBranchTestState({ label: "blob-read-reopen", applyEnv: false }, async (state) => {
      const store = createStore(state.env);
      await store.register("saved", new Uint8Array([1, 2]), { version: 1 });
      const databasePath = resolveBranchStateSqlitePath(state.env);
      await closeBranchStateDatabaseByPathAsync(databasePath);

      const entry = await store.lookup("saved");
      expect(entry).toMatchObject({ metadata: { version: 1 }, bytes: new Uint8Array([1, 2]) });
      entry!.bytes[0] = 9;
      await expect(store.lookup("saved")).resolves.toMatchObject({ bytes: new Uint8Array([1, 2]) });
      await expect(store.entries()).resolves.toMatchObject([{ key: "saved", sizeBytes: 2 }]);
      expect(isBranchStateDatabaseOpen(databasePath)).toBe(false);
    });
  });

  it("keeps an active writer's uncommitted changes out of blob reads", async () => {
    await withBranchTestState(
      { label: "blob-read-transaction", applyEnv: false },
      async (state) => {
        const store = createStore(state.env);
        await store.register("saved", new Uint8Array([1]), { version: 1 });
        const { db } = openBranchStateDatabase({ env: state.env });
        db.exec("BEGIN IMMEDIATE; DELETE FROM plugin_blob_entries;");
        try {
          await expect(store.lookup("saved")).resolves.toMatchObject({ metadata: { version: 1 } });
          await expect(store.entries()).resolves.toMatchObject([{ key: "saved" }]);
        } finally {
          db.exec("ROLLBACK");
        }
        await expect(store.lookup("saved")).resolves.toMatchObject({ metadata: { version: 1 } });
      },
    );
  });

  it("leaves a checkpoint-only database unchanged when its blob table is absent", async () => {
    await withBranchTestState(
      { label: "blob-read-bootstrap", applyEnv: false },
      async (state) => {
        const databasePath = resolveBranchStateSqlitePath(state.env);
        mkdirSync(path.dirname(databasePath), { recursive: true });
        const db = new DatabaseSync(databasePath);
        db.exec(`
        CREATE TABLE schema_meta (
          meta_key TEXT NOT NULL PRIMARY KEY, role TEXT NOT NULL, schema_version INTEGER NOT NULL,
          agent_id TEXT, app_version TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE state_leases (
          scope TEXT NOT NULL, lease_key TEXT NOT NULL, owner TEXT NOT NULL, expires_at INTEGER,
          heartbeat_at INTEGER, payload_json TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
          PRIMARY KEY (scope, lease_key)
        );
      `);
        db.close();
        const before = readFileSync(databasePath);
        const store = createStore(state.env);

        await expect(store.lookup("missing")).resolves.toBeUndefined();
        await expect(store.entries()).resolves.toEqual([]);
        expect(readFileSync(databasePath)).toEqual(before);
        expect(isBranchStateDatabaseOpen(databasePath)).toBe(false);
      },
    );
  });

  it("reports a missing initialized blob table as a read error without repairing it", async () => {
    await withBranchTestState({ label: "blob-read-damaged", applyEnv: false }, async (state) => {
      const store = createStore(state.env);
      await store.register("saved", new Uint8Array([1]), { version: 1 });
      const databasePath = resolveBranchStateSqlitePath(state.env);
      openBranchStateDatabase({ env: state.env }).db.exec("DROP TABLE plugin_blob_entries");
      await closeBranchStateDatabaseByPathAsync(databasePath);
      const before = readFileSync(databasePath);

      for (const operation of ["lookup", "entries"] as const) {
        await expect(
          operation === "lookup" ? store.lookup("saved") : store.entries(),
        ).rejects.toMatchObject({
          code: "PLUGIN_BLOB_READ_FAILED",
          operation,
          path: databasePath,
        });
      }
      expect(readFileSync(databasePath)).toEqual(before);
      expect(isBranchStateDatabaseOpen(databasePath)).toBe(false);
    });
  });

  it.each(["warm", "cold"])(
    "rejects a newer schema through %s acquisition",
    async (temperature) => {
      await withBranchTestState({ label: "blob-read-newer", applyEnv: false }, async (state) => {
        const store = createStore(state.env);
        await store.register("saved", new Uint8Array([1]), { version: 1 });
        const { db, path: databasePath } = openBranchStateDatabase({ env: state.env });
        db.exec(`PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION + 1};`);
        if (temperature === "cold") {
          await closeBranchStateDatabaseByPathAsync(databasePath);
        }
        for (const operation of ["lookup", "entries"] as const) {
          await expect(
            operation === "lookup" ? store.lookup("saved") : store.entries(),
          ).rejects.toMatchObject({
            code: "PLUGIN_BLOB_OPEN_FAILED",
            operation,
            path: databasePath,
          });
        }
      });
    },
  );

  it("preserves process-local and persisted quarantine failures on cold reads", async () => {
    await withBranchTestState(
      { label: "blob-read-quarantine", applyEnv: false },
      async (state) => {
        const store = createStore(state.env);
        await store.register("saved", new Uint8Array([1]), { version: 1 });
        const databasePath = resolveBranchStateSqlitePath(state.env);
        await closeBranchStateDatabaseByPathAsync(databasePath);
        recordBranchStateDatabaseOpenFailure(databasePath, new Error("latched failure"));
        try {
          await expect(store.lookup("saved")).rejects.toMatchObject({
            code: "PLUGIN_BLOB_OPEN_FAILED",
          });
          await expect(store.entries()).rejects.toMatchObject({ code: "PLUGIN_BLOB_OPEN_FAILED" });
        } finally {
          clearBranchStateDatabaseOpenFailure(databasePath);
        }
        expect(
          recordBranchDatabaseQuarantine({
            env: state.env,
            kind: "state",
            path: databasePath,
            reason: "persisted failure",
          }),
        ).toBe(true);
        try {
          await expect(store.lookup("saved")).rejects.toMatchObject({
            code: "PLUGIN_BLOB_OPEN_FAILED",
          });
          await expect(store.entries()).rejects.toMatchObject({ code: "PLUGIN_BLOB_OPEN_FAILED" });
        } finally {
          clearBranchStateDatabaseOpenFailure(databasePath);
          expect(clearBranchDatabaseQuarantine(databasePath, { env: state.env })).toBe(true);
        }
      },
    );
  });
});
