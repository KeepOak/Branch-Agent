import type { DatabaseSync } from "node:sqlite";
import { registerLiveSqliteSnapshotOwner } from "../infra/sqlite-live-snapshot.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import type { BranchStateDatabase } from "./branch-state-db-contract.js";

function createBranchStateSnapshotOwnerRegistry() {
  const releases = new WeakMap<DatabaseSync, () => void>();
  return {
    register(
      database: BranchStateDatabase,
      getCurrent: () => BranchStateDatabase | undefined,
    ): void {
      releases.set(
        database.db,
        registerLiveSqliteSnapshotOwner({
          database: database.db,
          databasePath: database.path,
          owner: "branch-state",
          assertCurrent: () => {
            if (getCurrent() !== database || !database.db.isOpen) {
              throw new Error("Branch Agent state snapshot owner is no longer current");
            }
          },
        }),
      );
    },
    release(database: DatabaseSync): void {
      releases.get(database)?.();
      releases.delete(database);
    },
  };
}

export const branchStateSnapshotOwners = resolveGlobalSingleton(
  Symbol.for("branch.stateSnapshotOwners"),
  createBranchStateSnapshotOwnerRegistry,
);
