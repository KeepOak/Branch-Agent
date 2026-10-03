import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import * as sqlite from "../infra/node-sqlite.js";
import * as integrityWorker from "../infra/sqlite-integrity-worker.js";
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
  const quickCheck = vi.spyOn(verifier, "requestBranchAgentDatabaseQuickCheck");
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
    const quickCheck = vi.spyOn(verifier, "requestBranchAgentDatabaseQuickCheck");
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
