import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import * as sqlite from "../infra/node-sqlite.js";
import * as integrityWorker from "../infra/sqlite-integrity-worker.js";
import {
  beginGatewayShutdownCleanup,
  markGatewayRestartDraining,
  resetGatewayWorkAdmission,
} from "../process/gateway-work-admission.js";
import { createDeferredCore } from "../shared/deferred.js";
import { closeCachedBranchAgentDatabase } from "./branch-agent-db-lifecycle.js";
import {
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
  resolveBranchAgentSqlitePath,
  runBranchAgentWriteTransaction,
  withBranchAgentDatabaseAdmission,
  withBranchAgentDatabaseAsync,
} from "./branch-agent-db.js";
import * as verifier from "./branch-database-verify.js";
import {
  clearBranchAgentIntegrityVerification,
  readBranchAgentIntegrityVerification,
} from "./branch-quarantine-store.js";
import { closeBranchStateDatabaseForTest } from "./branch-state-db.js";
import { createUnsafeIndexDrift } from "./sqlite-index-drift.test-support.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(async () => {
  vi.restoreAllMocks();
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
});

it("certifies idle handles after grace and borrowed handles only after their final release", async () => {
  vi.useFakeTimers();
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-cleanup-idle-") };
  const options = { agentId: "idle", env };
  const heldOptions = { agentId: "held", env };
  const idle = openBranchAgentDatabase(options);
  const held = openBranchAgentDatabase(heldOptions);
  const entered = createDeferredCore();
  const release = createDeferredCore();
  const borrowed = withBranchAgentDatabaseAsync(heldOptions, async (database) => {
    entered.resolve();
    await release.promise;
    expect(database.db.prepare("SELECT 1 AS value").get()).toEqual({ value: 1 });
  });
  try {
    await entered.promise;
    markGatewayRestartDraining();
    await vi.advanceTimersByTimeAsync(0);
    expect(idle.db.isOpen).toBe(true);
    beginGatewayShutdownCleanup();
    await vi.advanceTimersByTimeAsync(0);
    expect(idle.db.isOpen).toBe(false);
    expect(readBranchAgentIntegrityVerification(idle.path, env)?.clean_close).toBe(1);
    expect(held.db.isOpen).toBe(true);
    expect(readBranchAgentIntegrityVerification(held.path, env)?.clean_close).toBe(0);
    release.resolve();
    await borrowed;
    await vi.advanceTimersByTimeAsync(0);
    expect(held.db.isOpen).toBe(false);
    expect(readBranchAgentIntegrityVerification(held.path, env)?.clean_close).toBe(1);
    await withBranchAgentDatabaseAsync(options, async (reopened) => {
      await Promise.resolve();
      expect(reopened.db.isOpen).toBe(true);
      expect(readBranchAgentIntegrityVerification(idle.path, env)?.clean_close).toBe(0);
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(readBranchAgentIntegrityVerification(idle.path, env)?.clean_close).toBe(1);
  } finally {
    release.resolve();
    await borrowed;
    resetGatewayWorkAdmission();
    vi.useRealTimers();
  }
});

it("retains admission through pinned WAL eviction and certifies the final checkpointed close", async () => {
  const options = {
    agentId: "main",
    env: { BRANCH_STATE_DIR: tempDirs.make("branch-integrity-pinned-") },
  };
  const pathname = resolveBranchAgentSqlitePath(options);
  let checks = 0;
  const open = sqlite.openNodeSqliteDatabase;
  vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((...args) => {
    const database = open(...args);
    if (args[0] === pathname) {
      const prepare = database.prepare.bind(database);
      vi.spyOn(database, "prepare").mockImplementation((sql) => {
        if (/^PRAGMA integrity_check(?:\('sqlite_schema'\))?;?$/.test(sql)) {
          checks += 1;
        }
        return prepare(sql);
      });
    }
    return database;
  });
  const worker = vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker");
  const quickCheck = vi.spyOn(verifier, "requestBranchAgentDatabaseIntegrityCheck");
  const write = (updatedAt: number) =>
    runBranchAgentWriteTransaction(
      (database) =>
        writeSessionEntry(database, "agent:main:integrity", { sessionId: "retained", updatedAt }),
      options,
    );
  write(1);
  const reader = open(pathname, { readOnly: true });
  try {
    reader.exec("BEGIN");
    reader.prepare("SELECT updated_at FROM session_nodes").all();
    for (let iteration = 2; iteration <= 9; iteration += 1) {
      write(iteration);
      const database = openBranchAgentDatabase(options);
      closeCachedBranchAgentDatabase(database, { eviction: true });
      expect(database.walMaintenance.health?.state).toBe("blocked");
      expect(database.db.isOpen).toBe(false);
      await withBranchAgentDatabaseAsync(options, (reopened) => {
        expect(reopened.db.prepare("SELECT updated_at FROM session_nodes").get()).toEqual({
          updated_at: iteration,
        });
      });
    }
    expect(checks + worker.mock.calls.length).toBe(1);
    expect(quickCheck).not.toHaveBeenCalled();
  } finally {
    reader.close();
  }
  closeBranchAgentDatabasesForTest();
  expect(readBranchAgentIntegrityVerification(pathname, options.env)?.clean_close).toBe(1);
  openBranchAgentDatabase(options);
  expect(checks + worker.mock.calls.length).toBe(1);
  expect(quickCheck).toHaveBeenCalledOnce();
});

it.each(["sync", "async", "admitted"] as const)(
  "checks once across writes and physical %s reopens, including after lifecycle reset",
  async (mode) => {
    const options = {
      agentId: "integrity-cache",
      env: { BRANCH_STATE_DIR: tempDirs.make("branch-integrity-cache-") },
    };
    const pathname = resolveBranchAgentSqlitePath(options);
    const checks: string[] = [];
    const open = sqlite.openNodeSqliteDatabase;
    vi.spyOn(sqlite, "openNodeSqliteDatabase").mockImplementation((...args) => {
      const database = open(...args);
      if (args[0] === pathname) {
        const prepare = database.prepare.bind(database);
        vi.spyOn(database, "prepare").mockImplementation((sql) => {
          if (/^PRAGMA (integrity_check|foreign_key_check)(?:\('sqlite_schema'\))?;$/.test(sql)) {
            checks.push(sql);
          }
          return prepare(sql);
        });
      }
      return database;
    });
    const worker = vi.spyOn(integrityWorker, "assertSqliteIntegrityInWorker");
    const quickCheck = vi.spyOn(verifier, "requestBranchAgentDatabaseIntegrityCheck");
    const first = openBranchAgentDatabase(options);
    expect(checks).toEqual(["PRAGMA integrity_check;", "PRAGMA foreign_key_check;"]);
    first.db.exec("INSERT INTO auth_profile_state VALUES ('preserved', '{\"value\":42}', 1)");
    for (let iteration = 0; iteration < 2; iteration += 1) {
      closeBranchAgentDatabaseByPath(pathname);
      const read = (database: typeof first) =>
        database.db
          .prepare("SELECT state_json FROM auth_profile_state WHERE state_key = ?")
          .get("preserved");
      const row =
        mode === "sync"
          ? read(openBranchAgentDatabase(options))
          : mode === "async"
            ? await withBranchAgentDatabaseAsync(options, read)
            : await withBranchAgentDatabaseAdmission(
                options,
                (run) => Promise.resolve(run(() => {})),
                read,
              );
      expect(row).toEqual({ state_json: '{"value":42}' });
    }
    expect(checks).toEqual(["PRAGMA integrity_check;", "PRAGMA foreign_key_check;"]);
    expect(worker).not.toHaveBeenCalled();
    expect(quickCheck).not.toHaveBeenCalled();

    closeBranchAgentDatabasesForTest();
    openBranchAgentDatabase(options);
    expect(checks).toEqual(["PRAGMA integrity_check;", "PRAGMA foreign_key_check;"]);
  },
);

it("retains integrity verification until durable evidence is invalidated", () => {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-integrity-invalidation-") };
  const databasePath = openBranchAgentDatabase({ agentId: "worker-1", env }).path;
  expect(closeBranchAgentDatabaseByPath(databasePath)).toBe(true);
  closeBranchStateDatabaseForTest();
  createUnsafeIndexDrift(databasePath);

  expect(openBranchAgentDatabase({ agentId: "worker-1", env }).db.isOpen).toBe(true);
  closeBranchAgentDatabasesForTest();
  clearBranchAgentIntegrityVerification(databasePath, env);
  expect(() => openBranchAgentDatabase({ agentId: "worker-1", env })).toThrow(
    /integrity_check failed.*missing from index unsafe_index_records_value/iu,
  );
});

it.each([
  { damage: "duplicate page ownership", expected: /2nd reference to page/iu },
  { damage: "orphan allocated page", expected: /never used/iu },
])("refuses $damage before admitting a dirty database", async ({ damage, expected }) => {
  const options = {
    agentId: "integrity-pages",
    env: { BRANCH_STATE_DIR: tempDirs.make("branch-integrity-pages-") },
  };
  const pathname = openBranchAgentDatabase(options).path;
  closeBranchAgentDatabasesForTest();
  clearBranchAgentIntegrityVerification(pathname, options.env);
  const database = sqlite.openNodeSqliteDatabase(pathname);
  try {
    database.enableDefensive?.(false);
    database.exec(`
      CREATE TABLE page_owner_a (value INTEGER);
      CREATE TABLE page_owner_b (value INTEGER);
      INSERT INTO page_owner_a VALUES (1);
      INSERT INTO page_owner_b VALUES (2);
      PRAGMA writable_schema = ON;
    `);
    if (damage === "duplicate page ownership") {
      database.exec(`
        UPDATE sqlite_schema
        SET rootpage = (SELECT rootpage FROM sqlite_schema WHERE name = 'page_owner_a')
        WHERE name = 'page_owner_b';
      `);
    } else {
      database.exec("DELETE FROM sqlite_schema WHERE name = 'page_owner_b';");
    }
    const version = Number(database.prepare("PRAGMA schema_version").get()?.schema_version);
    database.exec(`PRAGMA writable_schema = OFF; PRAGMA schema_version = ${version + 1};`);

    // Every table can be sound while global page ownership is corrupt.
    const tables = database.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
    for (const table of [{ name: "sqlite_schema" }, ...tables]) {
      const name = String(table.name).replaceAll("'", "''");
      expect(database.prepare(`PRAGMA integrity_check('${name}')`).all()).toEqual([
        { integrity_check: "ok" },
      ]);
    }
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(String(database.prepare("PRAGMA integrity_check").get()?.integrity_check)).toMatch(
      expected,
    );
  } finally {
    database.close();
  }

  const admitted = vi.fn();
  await expect(
    withBranchAgentDatabaseAdmission(options, (run) => Promise.resolve(run(() => {})), admitted),
  ).rejects.toMatchObject({
    name: "SqliteIntegrityError",
    message: expect.stringMatching(expected),
  });
  expect(admitted).not.toHaveBeenCalled();
});

it("does not lend remembered integrity to another file at the same path", () => {
  const options = {
    agentId: "integrity-cache",
    env: { BRANCH_STATE_DIR: tempDirs.make("branch-integrity-replacement-") },
  };
  const database = openBranchAgentDatabase(options);
  closeBranchAgentDatabaseByPath(database.path);
  const replacement = `${database.path}.replacement`;
  fs.copyFileSync(database.path, replacement);
  createUnsafeIndexDrift(replacement);
  fs.renameSync(replacement, database.path);
  expect(() => openBranchAgentDatabase(options)).toThrow(
    /integrity_check failed.*missing from index unsafe_index_records_value/iu,
  );
});
