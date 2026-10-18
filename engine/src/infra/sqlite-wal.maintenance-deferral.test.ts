// #967: incremental vacuum never contends with agent admission for the state database's write lock.
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { requireNodeSqlite } from "./node-sqlite.js";
import {
  deferSqliteMaintenance,
  isSqliteMaintenanceDeferred,
} from "./sqlite-maintenance-deferral.js";
import { registerSqliteWalWorkerMaintenance } from "./sqlite-wal-write-admission.js";
import { configureSqlitePreSchemaPragmas, configureSqliteWalMaintenance } from "./sqlite-wal.js";

const dirs = useAutoCleanupTempDirTracker(afterEach);
const releases: Array<() => void> = [];

afterEach(() => {
  for (const release of releases.splice(0)) {
    release();
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function defer(maxMs?: number) {
  const release = deferSqliteMaintenance("test admission", maxMs);
  releases.push(release);
  return release;
}

function openWithFreePages(prefix: string) {
  const pathname = path.join(dirs.make(prefix), "branch.sqlite");
  const { DatabaseSync } = requireNodeSqlite();
  const writer = new DatabaseSync(pathname);
  configureSqlitePreSchemaPragmas(writer);
  const maintenance = configureSqliteWalMaintenance(writer, {
    checkpointIntervalMs: 0,
    databasePath: pathname,
  });
  writer.exec(`CREATE TABLE payload (data BLOB);
    INSERT INTO payload VALUES (zeroblob(1048576));
    DELETE FROM payload;`);
  return { pathname, writer, maintenance, DatabaseSync };
}

describe("SQLite maintenance during agent admission", () => {
  it("does not try the write lock for a vacuum while admission holds a fake lock", () => {
    const { pathname, writer, maintenance, DatabaseSync } = openWithFreePages(
      "branch-wal-deferral-lock-",
    );
    // The fake lock: another connection (admission's writer) holds the write lock.
    const admission = new DatabaseSync(pathname);
    try {
      admission.exec("BEGIN IMMEDIATE");
      const statements: string[] = [];
      const exec = writer.exec.bind(writer);
      vi.spyOn(writer, "exec").mockImplementation((sql: string) => {
        statements.push(sql);
        return exec(sql);
      });
      const release = defer();
      expect(isSqliteMaintenanceDeferred()).toBe(true);
      const result = maintenance.reclaimFreePages({ maxPages: 5, checkpointMode: "PASSIVE" });
      // Without the deferral a zero-busy-timeout BEGIN IMMEDIATE fails against the held lock and
      // logs "SQLite transaction lock wait failed ... operation=incremental-vacuum".
      expect(statements.filter((sql) => /BEGIN|incremental_vacuum/i.test(sql))).toEqual([]);
      expect(result.vacuumPasses).toBe(0);
      expect(result.remainingFreePages).toBe(result.freePagesBefore);
      admission.exec("COMMIT");
      release();
      expect(isSqliteMaintenanceDeferred()).toBe(false);
      const resumed = maintenance.reclaimFreePages({ maxPages: 5 });
      expect(resumed.vacuumPasses).toBe(1);
      expect(resumed.freePagesBefore! - resumed.remainingFreePages!).toBeGreaterThan(0);
    } finally {
      if (admission.isTransaction) {
        admission.exec("ROLLBACK");
      }
      admission.close();
      maintenance.close();
      writer.close();
    }
  });

  it("holds the periodic vacuum budget until admission ends, then spends it on the next tick", async () => {
    vi.useFakeTimers();
    const pathname = path.join(dirs.make("branch-wal-deferral-periodic-"), "branch.sqlite");
    const { DatabaseSync } = requireNodeSqlite();
    const db = new DatabaseSync(pathname);
    const maintenance = configureSqliteWalMaintenance(db, {
      checkpointIntervalMs: 60_000,
      databasePath: pathname,
    });
    const requests: number[] = [];
    registerSqliteWalWorkerMaintenance(db, async (request) => {
      requests.push(request.maxPages);
      return undefined;
    });
    try {
      const release = defer();
      await vi.advanceTimersByTimeAsync(60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      // Two periodic passes fell due during admission: neither asked for vacuum pages.
      expect(requests).toEqual([]);
      release();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(requests).toEqual([512]);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(requests).toEqual([512]);
    } finally {
      await maintenance.stop();
      maintenance.close();
      db.close();
    }
  });

  it("lapses a deferral that outlives its ceiling, so a stuck agent cannot stop maintenance", async () => {
    vi.useFakeTimers();
    defer(1_000);
    expect(isSqliteMaintenanceDeferred()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(isSqliteMaintenanceDeferred()).toBe(false);
  });
});
