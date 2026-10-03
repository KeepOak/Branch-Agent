import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearBranchDatabaseQuarantine,
  recordBranchDatabaseQuarantine,
} from "../state/branch-quarantine-store.js";
import { closeBranchStateDatabaseByPath } from "../state/branch-state-db-cache.js";
import { BRANCH_STATE_SCHEMA_VERSION } from "../state/branch-state-db-contract.js";
import {
  clearBranchStateDatabaseOpenFailure,
  openBranchStateDatabase,
  recordBranchStateDatabaseOpenFailure,
  withBranchStateStartupMigrationCheckpointDatabase,
} from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { claimBranchStateOwnership } from "../state/branch-state-ownership-operations.js";
import {
  createBranchTestState,
  type BranchTestState,
  withBranchTestState,
} from "../test-utils/branch-test-state.js";
import { withPluginStateDatabaseReadOnly } from "./plugin-state-store.database.js";
import {
  createPluginStateKeyedStore,
  createPluginStateSyncKeyedStore,
  resetPluginStateStoreForTests,
  pluginStateEntriesInKeyRange,
} from "./plugin-state-store.js";
import { closePluginStateDatabase } from "./plugin-state-store.sqlite.js";
import { PluginStateStoreError } from "./plugin-state-store.types.js";

let testState: BranchTestState;
beforeAll(async () => {
  testState = await createBranchTestState({ label: "plugin-state-errors" });
});
beforeEach(() => testState.applyEnv());
afterEach(() => resetPluginStateStoreForTests());
afterAll(() => testState.cleanup());

function openStore(namespace: string) {
  return createPluginStateKeyedStore("discord", { namespace, maxEntries: 10 });
}
async function rejects(read: () => unknown, expected: object) {
  await expect(async () => read()).rejects.toMatchObject(expected);
}

describe("plugin state open errors", () => {
  it.each(["decode", "sqlite-step"] as const)(
    "preserves %s failures and releases the listing cursor",
    async (failure) => {
      await withBranchTestState({ label: "plugin-state-entry-cursor" }, async () => {
        const store = createPluginStateSyncKeyedStore("discord", {
          namespace: "cursor",
          maxEntries: 10,
        });
        store.register("a", 1);
        store.register("b", 2);
        const { db, path } = openBranchStateDatabase();
        db.prepare("UPDATE plugin_state_entries SET value_json = ? WHERE entry_key = ?").run(
          "invalid first JSON",
          "a",
        );
        if (failure === "sqlite-step") {
          // The second native step must take precedence over the first row's decode failure.
          db.exec(`ALTER TABLE plugin_state_entries RENAME TO plugin_state_source;
          CREATE VIEW plugin_state_entries AS SELECT plugin_id, namespace, entry_key,
          CASE WHEN entry_key = 'b' THEN json_extract('invalid SQL JSON', '$') ELSE value_json END AS value_json,
          created_at, expires_at FROM plugin_state_source;`);
        }
        for (const connection of ["warm", "readonly"]) {
          if (connection === "readonly") {
            closePluginStateDatabase();
          }
          expect(() => store.entries()).toThrowError(
            expect.objectContaining({
              code: failure === "decode" ? "PLUGIN_STATE_CORRUPT" : "PLUGIN_STATE_READ_FAILED",
              operation: "entries",
              path,
              cause:
                failure === "decode"
                  ? expect.any(SyntaxError)
                  : expect.objectContaining({
                      code: "ERR_SQLITE_ERROR",
                      message: "malformed JSON",
                    }),
            }),
          );
          const writer = new DatabaseSync(path);
          try {
            writer.exec("PRAGMA busy_timeout = 0");
            const table = failure === "decode" ? "plugin_state_entries" : "plugin_state_source";
            writer.exec(`UPDATE ${table} SET created_at = created_at + 1`);
            expect(writer.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()).toEqual({
              busy: 0,
              log: 0,
              checkpointed: 0,
            });
          } finally {
            writer.close();
          }
        }
      });
    },
  );

  it("reports the explicit path for corrupt reads and rolls back decoding mutations", async () => {
    await withBranchTestState(
      { label: "plugin-state-corrupt-env", applyEnv: false },
      async (state) => {
        const options = { namespace: "corrupt", maxEntries: 10, env: state.env };
        const sync = createPluginStateSyncKeyedStore("discord", options);
        const store = createPluginStateKeyedStore("discord", options);
        sync.register("key", "custom");
        const database = openBranchStateDatabase({ env: state.env });
        expect(database.path).not.toBe(resolveBranchStateSqlitePath());
        database.db.prepare("UPDATE plugin_state_entries SET value_json = ?").run("invalid JSON");
        const expected = {
          code: "PLUGIN_STATE_CORRUPT",
          path: database.path,
          message: "Plugin state entry contains corrupt JSON.",
          cause: expect.any(SyntaxError),
        };
        for (const connection of ["warm", "readonly"]) {
          if (connection === "readonly") {
            closePluginStateDatabase();
          }
          for (const current of [sync, store]) {
            await rejects(() => current.lookup("key"), expected);
            await rejects(() => current.entries(), expected);
            expect(await current.lookupMany(["key"])).toEqual([
              { ok: false, error: expect.objectContaining({ ...expected, operation: "lookup" }) },
            ]);
            expect(await current.count()).toBe(1);
          }
          await rejects(
            () =>
              pluginStateEntriesInKeyRange({
                pluginId: "discord",
                ...options,
                keyStartInclusive: "key",
                keyEndExclusive: "kez",
                limit: 1,
              }),
            expected,
          );
        }
        let callbackCalled = false;
        for (const current of [sync, store]) {
          await rejects(() => current.consume("key"), { ...expected, operation: "consume" });
          await rejects(
            () =>
              current.update("key", () => {
                callbackCalled = true;
                return "changed";
              }),
            { ...expected, operation: "lookup" },
          );
          await rejects(
            () =>
              current.deleteIf("key", () => {
                callbackCalled = true;
                return true;
              }),
            { ...expected, operation: "delete" },
          );
        }
        expect(callbackCalled).toBe(false);
        expect(
          openBranchStateDatabase({ env: state.env })
            .db.prepare("SELECT value_json FROM plugin_state_entries")
            .all(),
        ).toEqual([{ value_json: "invalid JSON" }]);
      },
    );
  });

  it("keeps warm ownership denials distinct from acquisition failures for the same path", async () => {
    openBranchStateDatabase();
    await withBranchTestState({ label: "plugin-state-ownership-errors" }, async () => {
      const store = openStore("ownership");
      const sync = createPluginStateSyncKeyedStore("discord", {
        namespace: "ownership",
        maxEntries: 10,
      });
      await store.register("k", 1);
      claimBranchStateOwnership("fixture-supervisor", {
        env: { ...process.env, BRANCH_SUPERVISOR_MODE: "external" },
      });
      for (const code of ["PLUGIN_STATE_WRITE_FAILED", "PLUGIN_STATE_OPEN_FAILED"]) {
        await rejects(() => sync.register("k", 2), { code, operation: "register" });
        await rejects(() => store.register("k", 2), { code, operation: "register" });
        await expect(store.lookup("k")).resolves.toBe(1);
        if (code === "PLUGIN_STATE_WRITE_FAILED") {
          expect(closeBranchStateDatabaseByPath(resolveBranchStateSqlitePath())).toBe(true);
        }
      }
    });
  });

  it("fails closed for process-local and persisted database quarantine", async () => {
    const store = openStore("quarantine");
    await store.register("k", true);
    const path = resolveBranchStateSqlitePath();
    closePluginStateDatabase();
    const expected = {
      code: "PLUGIN_STATE_OPEN_FAILED",
      path,
      message: "Failed to open the plugin state database.",
    };
    recordBranchStateDatabaseOpenFailure(path, new Error("latched failure"));
    await rejects(() => store.lookup("k"), expected);
    await rejects(() => store.count(), { ...expected, operation: "count" });
    clearBranchStateDatabaseOpenFailure(path);
    expect(
      recordBranchDatabaseQuarantine({
        env: testState.env,
        kind: "state",
        path,
        reason: "persisted failure",
      }),
    ).toBe(true);
    try {
      for (const read of [
        () => store.lookup("k"),
        () => store.lookupMany(["k"]),
        () => store.register("k", true),
      ]) {
        await rejects(read, {
          ...expected,
          message: `${expected.message}\nDatabase integrity verification failed. Restore or repair the state database, then run branch doctor --fix.`,
        });
      }
    } finally {
      clearBranchStateDatabaseOpenFailure(path);
      expect(clearBranchDatabaseQuarantine(path, { env: testState.env })).toBe(true);
    }
  });

  it("fails closed for a newer shared-state schema", async () => {
    const store = openStore("newer-schema");
    await store.register("k", true);
    const path = resolveBranchStateSqlitePath();
    openBranchStateDatabase().db.exec(
      `PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION + 1}`,
    );
    closePluginStateDatabase();
    try {
      for (const read of [
        () => store.lookup("k"),
        () => store.lookupMany(["k"]),
        () => store.register("k", true),
      ]) {
        await rejects(read, {
          code: "PLUGIN_STATE_OPEN_FAILED",
          path,
          message:
            "Failed to open the plugin state database.\nThe state database uses a newer schema. Run a Branch Agent build that supports it.",
        });
      }
    } finally {
      clearBranchStateDatabaseOpenFailure(path);
      const db = new DatabaseSync(path);
      try {
        db.exec(`PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION}`);
      } finally {
        db.close();
      }
    }
  });

  it("rejects a missing plugin-state table in an initialized database", async () => {
    await withBranchTestState(
      { label: "plugin-state-damaged", applyEnv: false },
      async (state) => {
        const path = resolveBranchStateSqlitePath(state.env);
        withBranchStateStartupMigrationCheckpointDatabase(() => undefined, { env: state.env });
        const db = new DatabaseSync(path);
        try {
          db.exec("DROP TABLE plugin_state_entries");
        } finally {
          db.close();
        }
        const store = createPluginStateKeyedStore("discord", {
          namespace: "damaged",
          maxEntries: 10,
          env: state.env,
        });
        for (const operation of ["lookup", "entries", "count"] as const) {
          const failure = operation === "lookup" ? store.lookup("k") : store[operation]();
          await expect(failure).rejects.toBeInstanceOf(PluginStateStoreError);
          await expect(failure).rejects.toMatchObject({
            code: "PLUGIN_STATE_READ_FAILED",
            operation,
            path,
          });
        }
      },
    );
  });

  it("cold-opens without migrating a placement-owned first-use column", async () => {
    await withBranchTestState(
      { label: "plugin-state-placement", applyEnv: false },
      async (state) => {
        const options = { namespace: "moves", maxEntries: 10, env: state.env };
        await createPluginStateKeyedStore("discord", options).register("first", "discord");
        resetPluginStateStoreForTests();
        const path = resolveBranchStateSqlitePath(state.env);
        const previous = new DatabaseSync(path);
        let version: unknown;
        let metadata: unknown;
        try {
          version = previous.prepare("PRAGMA user_version").get();
          metadata = previous.prepare("SELECT * FROM schema_meta WHERE meta_key = 'primary'").get();
          expect(version).toEqual({ user_version: BRANCH_STATE_SCHEMA_VERSION });
          previous.exec(
            "ALTER TABLE worker_session_placement_moves DROP COLUMN target_machine_class",
          );
        } finally {
          previous.close();
        }
        await createPluginStateKeyedStore("telegram", options).register("second", "telegram");
        resetPluginStateStoreForTests();
        const reopened = new DatabaseSync(path);
        try {
          expect(
            reopened
              .prepare(
                "SELECT plugin_id, namespace, entry_key, value_json FROM plugin_state_entries ORDER BY plugin_id",
              )
              .all(),
          ).toEqual([
            {
              plugin_id: "discord",
              namespace: "moves",
              entry_key: "first",
              value_json: '"discord"',
            },
            {
              plugin_id: "telegram",
              namespace: "moves",
              entry_key: "second",
              value_json: '"telegram"',
            },
          ]);
          expect(
            reopened
              .prepare("PRAGMA table_info(worker_session_placement_moves)")
              .all()
              .map((row) => row.name),
          ).not.toContain("target_machine_class");
          expect(reopened.prepare("PRAGMA user_version").get()).toEqual(version);
          expect(
            reopened.prepare("SELECT * FROM schema_meta WHERE meta_key = 'primary'").get(),
          ).toEqual(metadata);
        } finally {
          reopened.close();
        }
      },
    );
  });

  it("reports the explicit readonly path when acquisition fails before the operation", async () => {
    await withBranchTestState({ label: "plugin-state-explicit-read-path" }, async (state) => {
      const explicitPath = join(state.stateDir, "explicit.sqlite");
      const database = new DatabaseSync(explicitPath);
      database.exec(`PRAGMA user_version = ${BRANCH_STATE_SCHEMA_VERSION + 1}`);
      database.close();
      const read = vi.fn(() => undefined);
      expect(explicitPath).not.toBe(resolveBranchStateSqlitePath(state.env));
      expect(() =>
        withPluginStateDatabaseReadOnly("lookup", read, {
          path: relative(process.cwd(), explicitPath),
          env: state.env,
        }),
      ).toThrow(
        expect.objectContaining({
          code: "PLUGIN_STATE_OPEN_FAILED",
          operation: "lookup",
          path: explicitPath,
        }),
      );
      expect(read).not.toHaveBeenCalled();
    });
  });
});
