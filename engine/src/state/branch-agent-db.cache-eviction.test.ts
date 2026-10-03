// Agent database cache tests cover idle process-local SQLite handle ownership.
import fs from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as nodeSqlite from "../infra/node-sqlite.js";
import { SQLITE_IDLE_HANDLE_TTL_MS } from "../infra/sqlite-handle-lifecycle.js";
import { createDeferredCore } from "../shared/deferred.js";
import { retainBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly.js";
import {
  borrowBranchAgentDatabase,
  clearBranchAgentDatabaseOpenFailure,
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabasesForTest,
  listBranchRegisteredAgentDatabases,
  openBranchAgentDatabase,
  recordBranchAgentDatabaseOpenFailure,
  runBranchAgentWriteTransaction,
  withBranchAgentDatabaseAsync,
} from "./branch-agent-db.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterAll);
let env: NodeJS.ProcessEnv;

beforeAll(() => {
  env = { BRANCH_STATE_DIR: fs.realpathSync(tempDirs.make("branch-agent-db-cache-")) };
});

beforeEach(() => {
  closeBranchAgentDatabasesForTest();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("branch agent database handle cache", () => {
  it("starts another complete idle window when an existing handle is used", () => {
    const options = { agentId: "activity", env };
    const database = openBranchAgentDatabase(options);
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS - 1);
    expect(openBranchAgentDatabase(options)).toBe(database);
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS - 1);
    expect(database.db.isOpen).toBe(true);
    vi.advanceTimersByTime(1);
    expect(database.db.isOpen).toBe(false);
  });

  it("does not count periodic WAL maintenance as database activity", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const database = openBranchAgentDatabase({ agentId: "idle-maintenance", env });
    await vi.advanceTimersByTimeAsync(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(database.db.isOpen).toBe(false);
  });

  it("retains concurrent admissions through the transaction's borrower handoff", async () => {
    const entered = createDeferredCore();
    const proceed = createDeferredCore();
    const transferred: ReturnType<typeof borrowBranchAgentDatabase>[] = [];
    let operations = 0;
    const admitted = ["adoption-first", "adoption-second"].map((agentId) => {
      const options = { agentId, env };
      return withBranchAgentDatabaseAsync(options, async (database) => {
        if (++operations === 2) {
          entered.resolve();
        }
        await proceed.promise;
        return runBranchAgentWriteTransaction((current) => {
          expect(current.db).toBe(database.db);
          transferred.push(borrowBranchAgentDatabase(options));
          return database;
        }, options);
      });
    });
    const finished = Promise.all(admitted);
    try {
      await Promise.race([entered.promise, finished]);
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
      proceed.resolve();
      const databases = await finished;
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
      expect(databases.every((database) => database.db.isOpen)).toBe(true);
      for (const borrowed of transferred) {
        borrowed.release();
      }
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS - 1);
      expect(databases.every((database) => database.db.isOpen)).toBe(true);
      vi.advanceTimersByTime(1);
      expect(databases.every((database) => !database.db.isOpen)).toBe(true);
    } finally {
      proceed.resolve();
      await Promise.allSettled(admitted);
      for (const borrowed of transferred) {
        borrowed.release();
      }
    }
  });

  it("starts the idle window after a cached operation rejects", async () => {
    const options = { agentId: "cached-operation", env };
    const target = openBranchAgentDatabase(options);
    const entered = createDeferredCore();
    const proceed = createDeferredCore();
    const result = withBranchAgentDatabaseAsync(options, async (database) => {
      entered.resolve();
      await proceed.promise;
      expect(database).toBe(target);
      expect(database.db.isOpen).toBe(true);
      throw new Error("synthetic operation failure");
    });
    const settled = expect(result).rejects.toThrow("synthetic operation failure");
    try {
      await entered.promise;
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS * 2);
      expect(target.db.isOpen).toBe(true);
      proceed.resolve();
      await settled;
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS - 1);
      expect(target.db.isOpen).toBe(true);
      vi.advanceTimersByTime(1);
      expect(target.db.isOpen).toBe(false);
    } finally {
      proceed.resolve();
      await Promise.allSettled([result]);
    }
  });

  it("does not invoke an admitted operation after explicit disposal revokes its handle", async () => {
    const target = openBranchAgentDatabase({ agentId: "revoked-operation", env });
    const operation = vi.fn();
    const result = withBranchAgentDatabaseAsync({ agentId: target.agentId, env }, operation);
    closeBranchAgentDatabaseByPath(target.path);
    await expect(result).rejects.toThrow(/closed|revoked/);
    expect(operation).not.toHaveBeenCalled();
  });

  it("releases an evicted lease in its acquisition store after its environment changes", () => {
    const mutableEnv = { ...env };
    const nextStateDir = tempDirs.make("agent-lease-eviction-");
    const database = openBranchAgentDatabase({ agentId: "lease-environment", env: mutableEnv });
    mutableEnv.BRANCH_STATE_DIR = nextStateDir;
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(database.db.isOpen).toBe(false);
    const { db } = openBranchStateDatabase({ env });
    expect(
      db.prepare("SELECT lease_id FROM agent_database_leases WHERE path = ?").all(database.path),
    ).toEqual([]);
    expect(fs.readdirSync(nextStateDir)).toEqual([]);
  });

  it("keeps an open transaction through expiry and evicts after it finishes", () => {
    const database = openBranchAgentDatabase({ agentId: "transaction", env });
    database.db.exec("BEGIN IMMEDIATE");
    try {
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
      expect(database.db.isOpen).toBe(true);
      expect(database.db.isTransaction).toBe(true);
    } finally {
      database.db.exec("ROLLBACK");
    }
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(database.db.isOpen).toBe(false);
  });

  it("pins a completion's exact database until its final claim is released", () => {
    const options = { agentId: "completion", env };
    const database = openBranchAgentDatabase(options);
    const retained = retainBranchAgentDatabaseReadOnly(options);
    if (!retained.found) {
      throw new Error("expected the cached database");
    }
    try {
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
      expect(retained.claim.isCurrent()).toBe(true);
      expect(database.db.isOpen).toBe(true);
      retained.claim.release();
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS - 1);
      expect(database.db.isOpen).toBe(true);
      vi.advanceTimersByTime(1);
      expect(database.db.isOpen).toBe(false);
      expect(retained.claim.isCurrent()).toBe(false);
    } finally {
      retained.claim.release();
    }
  });

  it("retries failed lease cleanup without retaining a closed handle forever", () => {
    const database = openBranchAgentDatabase({ agentId: "lease-retry", env });
    const { db: state } = openBranchStateDatabase({ env });
    state.exec(`CREATE TEMP TRIGGER fail_agent_lease_release BEFORE DELETE ON agent_database_leases
      BEGIN SELECT RAISE(ABORT, 'blocked lease release'); END`);
    try {
      expect(() => closeBranchAgentDatabaseByPath(database.path)).toThrow(
        "blocked lease release",
      );
      expect(database.db.isOpen).toBe(false);
      state.exec("DROP TRIGGER fail_agent_lease_release");
      vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
      const current = openBranchStateDatabase({ env });
      expect(
        current.db
          .prepare("SELECT lease_id FROM agent_database_leases WHERE agent_id = ?")
          .all(database.agentId),
      ).toEqual([]);
    } finally {
      if (state.isOpen) {
        state.exec("DROP TRIGGER IF EXISTS fail_agent_lease_release");
      }
      closeBranchAgentDatabaseByPath(database.path);
    }
  });

  it("reopens an evicted database, revalidates schema, and preserves durable rows and discovery", () => {
    const options = { agentId: "durability", env };
    const evicted = openBranchAgentDatabase(options);
    evicted.db
      .prepare(
        "INSERT INTO auth_profile_state (state_key, state_json, updated_at) VALUES (?, ?, ?)",
      )
      .run("cache-eviction", JSON.stringify({ preserved: true }), 42);
    const registration = listBranchRegisteredAgentDatabases({ env }).find(
      (entry) => entry.path === evicted.path,
    );
    expect(registration).toBeDefined();
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(evicted.db.isOpen).toBe(false);
    const cachedReopen = openBranchAgentDatabase(options);
    expect(cachedReopen).not.toBe(evicted);
    expect(
      listBranchRegisteredAgentDatabases({ env }).find((entry) => entry.path === evicted.path),
    ).toEqual(registration);
    vi.advanceTimersByTime(SQLITE_IDLE_HANDLE_TTL_MS);
    expect(cachedReopen.db.isOpen).toBe(false);
    const divergent = new (nodeSqlite.requireNodeSqlite().DatabaseSync)(evicted.path);
    try {
      divergent.exec("ALTER TABLE session_nodes DROP COLUMN project_id;");
    } finally {
      divergent.close();
    }
    const reopened = openBranchAgentDatabase(options);
    expect(reopened).not.toBe(cachedReopen);
    expect(
      reopened.db
        .prepare("PRAGMA table_info(session_nodes)")
        .all()
        .some((row) => row.name === "project_id"),
    ).toBe(true);
    expect(
      reopened.db
        .prepare("SELECT state_json, updated_at FROM auth_profile_state WHERE state_key = ?")
        .get("cache-eviction"),
    ).toEqual({ state_json: JSON.stringify({ preserved: true }), updated_at: 42 });
    expect(
      listBranchRegisteredAgentDatabases({ env }).find((entry) => entry.path === evicted.path),
    ).toMatchObject({
      agentId: options.agentId,
      path: evicted.path,
      schemaVersion: registration!.schemaVersion,
    });
  });

  it("revokes on quarantine and opens a new native handle after quarantine is cleared", () => {
    const options = { agentId: "quarantine", env };
    const database = openBranchAgentDatabase(options);
    const open = vi.spyOn(nodeSqlite, "openNodeSqliteDatabase");
    const error = new Error("synthetic quarantine");
    expect(recordBranchAgentDatabaseOpenFailure(database.path, error)).toBe(true);
    expect(database.db.isOpen).toBe(false);
    expect(() => openBranchAgentDatabase(options)).toThrow(error);
    clearBranchAgentDatabaseOpenFailure(database.path, { env });
    expect(openBranchAgentDatabase(options).db.isOpen).toBe(true);
    expect(open.mock.calls.filter(([pathname]) => pathname === database.path)).toHaveLength(1);
  });
});
