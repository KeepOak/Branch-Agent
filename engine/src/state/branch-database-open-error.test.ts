import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as transactions from "../infra/sqlite-transaction.js";
import {
  closeBranchAgentDatabasesForTest,
  getBranchAgentDatabaseIfOpen,
  openBranchAgentDatabase,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
  repairBranchStateDatabaseSchema,
} from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

const roots = createTempDirTracker();
const observed = new Set<DatabaseSync>();
const runTransaction = transactions.runSqliteImmediateTransactionSync;

afterEach(() => {
  vi.restoreAllMocks();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  for (const db of observed) {
    if (db.isOpen) {
      db.close();
    }
  }
  observed.clear();
  roots.cleanup();
});

it.each(["state", "agent"] as const)(
  "preserves the primary failure through %s schema restoration and physical-open cleanup",
  (kind) => {
    const env = { BRANCH_STATE_DIR: roots.make("database-open-primary-error-") };
    const options = { agentId: "primary-error", env };
    const pathname =
      kind === "state"
        ? resolveBranchStateSqlitePath(env)
        : resolveBranchAgentSqlitePath(options);
    const primary = new Error("synthetic schema transaction lost its transaction");
    let intercepted = 0;
    const transaction = vi
      .spyOn(transactions, "runSqliteImmediateTransactionSync")
      .mockImplementation((db, operation, transactionOptions) => {
        if (db.location() !== pathname) {
          return runTransaction(db, operation, transactionOptions);
        }
        intercepted += 1;
        observed.add(db);
        return runTransaction(
          db,
          () => {
            expect(db.isTransaction).toBe(true);
            db.exec("ROLLBACK");
            throw primary;
          },
          transactionOptions,
        );
      });
    const open = () =>
      kind === "state" ? openBranchStateDatabase({ env }) : openBranchAgentDatabase(options);
    try {
      let failure: unknown;
      try {
        open();
      } catch (error) {
        failure = error;
      }
      expect(intercepted).toBe(1);
      expect(observed.size).toBe(1);
      const [failedDb] = observed;
      assert(failedDb);
      expect(failedDb.isOpen).toBe(false);
      expect(failure).toBe(primary);
      if (kind === "agent") {
        expect(getBranchAgentDatabaseIfOpen(options)).toBeUndefined();
      }
      transaction.mockRestore();
      const fresh = open();
      expect(fresh.db === failedDb).toBe(false);
      expect(fresh.db.isOpen).toBe(true);
    } finally {
      transaction.mockRestore();
    }
  },
);

it("returns doctor repair warnings when rollback cleanup already closed the state database", () => {
  const env = { BRANCH_STATE_DIR: roots.make("state-repair-rollback-cleanup-") };
  const pathname = resolveBranchStateSqlitePath(env);
  openBranchStateDatabase({ env });
  closeBranchStateDatabaseForTest();
  const primary = new Error("synthetic repair transaction lost its transaction");
  let intercepted = 0;
  const transaction = vi
    .spyOn(transactions, "runSqliteImmediateTransactionSync")
    .mockImplementation((db, operation, transactionOptions) => {
      if (db.location() !== pathname) {
        return runTransaction(db, operation, transactionOptions);
      }
      intercepted += 1;
      observed.add(db);
      return runTransaction(
        db,
        () => {
          expect(db.isTransaction).toBe(true);
          db.exec("ROLLBACK");
          throw primary;
        },
        transactionOptions,
      );
    });
  try {
    const result = repairBranchStateDatabaseSchema({ env });
    expect(intercepted).toBe(1);
    expect(result.changes).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed migrating shared state database schema");
    expect(result.warnings[0]).toContain("synthetic repair transaction lost its transaction");
    const [failedDb] = observed;
    assert(failedDb);
    expect(failedDb.isOpen).toBe(false);
  } finally {
    transaction.mockRestore();
  }
});
