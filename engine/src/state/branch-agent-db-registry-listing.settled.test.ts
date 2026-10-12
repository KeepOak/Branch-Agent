import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { runSqliteDeferredTransactionSync } from "../infra/sqlite-transaction.js";
import { prepareBranchAgentDatabaseRegistrySnapshotRead } from "./branch-agent-db-registry-listing.js";
import { readRegisteredAgentDatabaseRows } from "./branch-agent-db-registry.read.js";
import { readBranchStateReadOnlyLocation } from "./branch-state-db-read-connection.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  vi.restoreAllMocks();
  closeBranchStateDatabaseForTest();
});

function createRegistry(malformed: boolean) {
  const stateDir = tempDirs.make("branch-registry-settled-");
  const options = {
    path: path.join(stateDir, "state", "branch.sqlite"),
    env: { BRANCH_STATE_DIR: stateDir, BRANCH_TEST_FAST: "1" },
  };
  const database = openBranchStateDatabase(options);
  if (malformed) {
    database.db.exec("DROP TABLE agent_databases; CREATE VIEW agent_databases AS SELECT 1");
  }
  closeBranchStateDatabaseForTest();
  return options;
}

it("returns registry unavailability only after the fixed native read and worker settle", async () => {
  const options = createRegistry(true);
  const snapshot = await prepareBranchAgentDatabaseRegistrySnapshotRead(options).read();
  expect(snapshot.result).toEqual({ status: "unavailable" });
  expect(snapshot.assertCurrent).not.toThrow();
});

it.each([false, true])(
  "retains the failed native reader when malformed registry is %s",
  (malformed) => {
    const options = createRegistry(malformed);
    const failure = new Error("synthetic native reader close failed");
    let retained: DatabaseSync | undefined;
    let restoreClose: (() => void) | undefined;
    let caught: unknown;
    try {
      readBranchStateReadOnlyLocation(
        ({ db }) => {
          retained = db;
          const closeSpy = vi.spyOn(db, "close").mockImplementation(() => {
            throw failure;
          });
          restoreClose = () => closeSpy.mockRestore();
          return readRegisteredAgentDatabaseRows(db, options.path, false);
        },
        options.path,
        options.path,
      );
    } catch (error) {
      caught = error;
    }
    expect(retained?.isOpen).toBe(true);
    if (malformed) {
      expect(caught).toBeInstanceOf(AggregateError);
      expect(caught).toMatchObject({ errors: [expect.any(Error), failure] });
    } else {
      expect(caught).toBe(failure);
    }
    restoreClose?.();
    closeBranchStateDatabaseForTest();
    expect(retained?.isOpen).toBe(false);
  },
);

it("never certifies a query failure after the transaction owner could not roll it back", () => {
  const options = createRegistry(false);
  const queryFailure = new Error("query failed");
  // The transaction owner records this terminal failure even if native close later succeeds.
  const result = () =>
    readBranchStateReadOnlyLocation(
      ({ db }) => {
        const exec = db.exec.bind(db);
        vi.spyOn(db, "exec").mockImplementation((sql) => {
          if (sql === "ROLLBACK") {
            throw new Error("rollback failed");
          }
          return exec(sql);
        });
        return runSqliteDeferredTransactionSync(db, () => {
          throw queryFailure;
        });
      },
      options.path,
      options.path,
    );
  expect(result).toThrow(queryFailure);
});
