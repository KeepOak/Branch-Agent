import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { acquireGatewayStateOwner } from "../infra/gateway-state-owner.js";
import * as kyselyCache from "../infra/kysely-sync-cache-state.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { createBranchDatabaseMaintenanceScope } from "./branch-state-db-async-lifecycle.js";
import {
  branchStateDatabaseCache as cache,
  readBranchStateWalHealth,
  retainBranchStateDatabase,
} from "./branch-state-db-cache.js";
import { openBranchStateDatabase } from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    vi.restoreAllMocks();
    cache.closeBranchStateDatabaseForTest();
    vi.unstubAllEnvs();
    cleanup();
  });
});

describe("shared-state disposal ownership", () => {
  it("disposes a revoked owner's exact handle without changing a successor SQLite family", async () => {
    const root = tempDirs.make("branch-state-revoked-disposal-");
    const databasePath = path.join(root, "state", "branch.sqlite");
    const retiredPath = path.join(root, "retired.sqlite");
    const physical = acquireGatewayStateOwner({ databasePath });
    let live = true;
    const scope = createBranchDatabaseMaintenanceScope({
      schemaMaintenance: true,
      assertDatabaseAccess: physical.assertDatabaseAccess,
      assertOwnerCurrent() {
        physical.assertCurrent();
        if (!live) {
          throw new Error("Fixture maintenance authority retired");
        }
      },
    });
    const suffixes = ["", "-wal", "-shm"] as const;
    const snapshot = () =>
      suffixes.map((suffix) => {
        const pathname = databasePath + suffix;
        const bytes = fs.readFileSync(pathname);
        const { dev, ino, mode, size, mtimeNs, ctimeNs } = fs.statSync(pathname, {
          bigint: true,
        });
        return { bytes, dev, ino, mode, size, mtimeNs, ctimeNs };
      });
    let replacement: ReturnType<typeof openNodeSqliteDatabase> | undefined;
    try {
      const owner = scope.run(() => {
        const database = openBranchStateDatabase({ path: databasePath });
        retainBranchStateDatabase(database);
        database.db.exec("CREATE TABLE original(value TEXT); INSERT INTO original VALUES ('kept')");
        return database;
      });
      live = false;
      if (process.platform === "win32") {
        const before = snapshot();
        let renameError: unknown;
        try {
          fs.renameSync(databasePath, retiredPath);
        } catch (error) {
          renameError = error;
        }
        expect(renameError).toMatchObject({
          code: expect.stringMatching(/^(?:EACCES|EBUSY|EPERM)$/u),
        });
        expect(snapshot()).toEqual(before);
        await expect(scope.close()).resolves.toBeUndefined();
        expect(owner.db.isOpen).toBe(false);
      }
      for (const suffix of suffixes) {
        if (fs.existsSync(databasePath + suffix)) {
          fs.renameSync(databasePath + suffix, retiredPath + suffix);
        }
      }
      replacement = openNodeSqliteDatabase(databasePath);
      replacement.exec(
        "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE successor(value TEXT); INSERT INTO successor VALUES ('preserved')",
      );
      const before = snapshot();
      await expect(scope.close()).resolves.toBeUndefined();
      expect(owner.db.isOpen).toBe(false);
      physical.assertCurrent();
      expect(snapshot()).toEqual(before);
      expect(replacement.prepare("SELECT value FROM successor").all()).toEqual([
        { value: "preserved" },
      ]);
    } finally {
      live = true;
      try {
        await scope.close();
      } finally {
        replacement?.close();
        physical.release();
      }
    }
  });

  it.each(["canonical", "borrow"] as const)(
    "retries released-borrow cleanup through the %s owner without closing its replacement",
    (retry) => {
      const root = tempDirs.make("branch-state-borrow-cleanup-");
      const owner = openBranchStateDatabase({ path: path.join(root, "state.sqlite") });
      const borrow = retainBranchStateDatabase(owner);
      const failure = new Error("maintenance cleanup callback failed");
      const closeMaintenance = owner.walMaintenance.close;
      vi.spyOn(owner.walMaintenance, "close").mockImplementationOnce((options) => {
        closeMaintenance(options);
        throw failure;
      });

      try {
        expect(() => borrow.release()).toThrow(failure);
        expect(owner.db.isOpen).toBe(false);
        if (retry === "canonical") {
          expect(cache.closeBranchStateDatabaseByPath(owner.path)).toBe(true);
        } else {
          expect(() => borrow.release()).not.toThrow();
        }
        const replacement = openBranchStateDatabase({ path: owner.path });
        borrow.release();
        expect(replacement.db.isOpen).toBe(true);
      } finally {
        borrow.release();
      }
    },
  );

  it("reads only recorded WAL health and forgets it when the database retires", () => {
    vi.stubEnv("BRANCH_STATE_DIR", tempDirs.make("branch-state-wal-health-"));
    expect(readBranchStateWalHealth()).toBeUndefined();
    const owner = openBranchStateDatabase();
    expect(readBranchStateWalHealth()).toBeUndefined();
    expect(owner.walMaintenance.checkpoint()).toBe(true);
    const prepare = vi.spyOn(owner.db, "prepare");
    const recorded = readBranchStateWalHealth();
    expect(recorded).toMatchObject({ state: "complete", warning: false });
    expect(prepare).not.toHaveBeenCalled();
    if (recorded) {
      recorded.warning = true;
    }
    expect(readBranchStateWalHealth()?.warning).toBe(false);
    cache.closeBranchStateDatabaseByPath(owner.path);
    expect(readBranchStateWalHealth()).toBeUndefined();
  });
  it.each(["path", "all", "corruption"] as const)(
    "retains a failed native close for disposal without a cache hit after %s retirement",
    (scope) => {
      const root = tempDirs.make("branch-state-disposal-");
      const owner = openBranchStateDatabase({ path: path.join(root, "failed.sqlite") });
      const healthy = openBranchStateDatabase({ path: path.join(root, "healthy.sqlite") });
      owner.db.exec("CREATE TABLE retained(value TEXT); INSERT INTO retained VALUES ('original')");
      const failure = new Error("native close refused");
      const close = vi.spyOn(owner.db, "close").mockImplementation(() => {
        throw failure;
      });
      if (scope === "corruption") {
        expect(cache.evictCachedBranchStateDatabase(owner)).toBe(true);
      } else {
        expect(() =>
          scope === "path"
            ? cache.closeBranchStateDatabaseByPath(owner.path)
            : cache.closeBranchStateDatabase(),
        ).toThrow(failure);
      }
      expect(owner.db.isOpen).toBe(true);
      expect(cache.getBranchStateDatabaseIfOpenAtPath(owner.path)).toBeUndefined();
      expect(kyselyCache.kyselyByDatabase.has(owner.db)).toBe(false);
      expect(healthy.db.isOpen).toBe(scope !== "all");
      close.mockRestore();
      expect(cache.closeBranchStateDatabaseByPath(owner.path)).toBe(true);
      expect(owner.db.isOpen).toBe(false);
      const reopened = openBranchStateDatabase({ path: owner.path });
      expect(reopened.db.prepare("SELECT value FROM retained").all()).toEqual([
        { value: "original" },
      ]);
    },
  );

  it("attempts native close and other owners after maintenance and Kysely cleanup failures", () => {
    const root = tempDirs.make("branch-state-cleanup-failures-");
    const owner = openBranchStateDatabase({ path: path.join(root, "failed.sqlite") });
    const healthy = openBranchStateDatabase({ path: path.join(root, "healthy.sqlite") });
    const maintenanceFailure = new Error("maintenance failed");
    const cacheFailure = new Error("Kysely disposal failed");
    const closeMaintenance = owner.walMaintenance.close;
    vi.spyOn(owner.walMaintenance, "close").mockImplementation((options) => {
      closeMaintenance(options);
      throw maintenanceFailure;
    });
    vi.spyOn(kyselyCache, "clearNodeSqliteKyselyCacheForDatabase").mockImplementationOnce(() => {
      throw cacheFailure;
    });
    let caught: unknown;
    try {
      cache.closeBranchStateDatabase();
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      cause: maintenanceFailure,
      errors: [maintenanceFailure, cacheFailure],
    });
    expect(owner.db.isOpen).toBe(false);
    expect(healthy.db.isOpen).toBe(false);
    expect(cache.getBranchStateDatabaseIfOpenAtPath(owner.path)).toBeUndefined();
  });
});
