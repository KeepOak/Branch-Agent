import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  getBranchDatabaseMaintenanceScope,
  isBranchDatabaseMaintenanceResourceOwned,
  observeBranchDatabaseMaintenanceResource,
  type BranchDatabaseMaintenanceScope,
} from "./branch-state-db-async-lifecycle.js";
import type { BranchStateDatabase } from "./branch-state-db-contract.js";

type RetirementIntent = {
  ordinary: boolean;
  isCurrent(): boolean;
  retire(): void;
};

export type StateDatabaseBorrowers = {
  references: Set<object>;
  retiring: boolean;
  cleanupComplete: boolean;
  retirement?: RetirementIntent;
};

/** The canonical cache supplies identity and custody; this owner manages its native references. */
export function createStateDatabaseRetainer(
  state: {
    borrowers: WeakMap<DatabaseSync, StateDatabaseBorrowers>;
    cachedDatabases: Map<string, BranchStateDatabase>;
  },
  operations: {
    assertOpen(pathname: string, ownership?: "cached-read"): void;
    capture(pathname: string): { assertCurrent(): void };
    retire(database: BranchStateDatabase, retireAdmission: boolean): void;
    retainFailed(database: BranchStateDatabase): void;
    touch(database: BranchStateDatabase): void;
  },
) {
  const admit = (pathname: string, ownership?: "cached-read") => {
    const scope = getBranchDatabaseMaintenanceScope();
    scope?.assertAdmission();
    operations.assertOpen(pathname, ownership);
    return scope;
  };
  // Only the synchronous entry points below can reach this already-admitted step.
  const retain = (
    database: BranchStateDatabase,
    scope: BranchDatabaseMaintenanceScope | undefined,
    readOnly = false,
  ) => {
    operations.capture(database.path).assertCurrent();
    if (state.cachedDatabases.get(database.path) !== database || !database.db.isOpen) {
      throw new Error("Branch Agent state database borrow requires its current canonical handle");
    }
    const owner: StateDatabaseBorrowers = state.borrowers.get(database.db) ?? {
      references: new Set<object>(),
      retiring: false,
      cleanupComplete: false,
    };
    if (owner.retiring) {
      throw new Error("Branch Agent state database native owner is retiring");
    }
    if (!readOnly) {
      observeBranchDatabaseMaintenanceResource(database.db);
    }
    state.borrowers.set(database.db, owner);
    const isCurrent = () =>
      !scope || isBranchDatabaseMaintenanceResourceOwned(database.db, scope);
    const retirement: RetirementIntent | undefined = readOnly
      ? undefined
      : {
          ordinary: scope === undefined,
          isCurrent,
          retire: () => {
            if (!isCurrent()) {
              owner.retiring = false;
              return;
            }
            operations.retire(database, scope === undefined);
          },
        };
    const reference = retainStateDatabaseReference({
      owner,
      retirement,
      retainFailedClose: () => operations.retainFailed(database),
    });
    scope?.own(reference, "shared-references", () => reference.release());
    return reference;
  };
  const findReadDatabase = (pathname: string, ownership?: "cached-read") => {
    const scope = admit(pathname, ownership);
    const database = state.cachedDatabases.get(path.resolve(pathname));
    return { database: database?.db.isOpen ? database : undefined, scope };
  };
  const retainReadReference = (
    database: BranchStateDatabase,
    scope: BranchDatabaseMaintenanceScope | undefined,
  ) => {
    const reference = retain(database, scope, true);
    const assertCurrent = () => {
      if (state.cachedDatabases.get(database.path) !== database || !database.db.isOpen) {
        throw new Error("Shared-state read lost its original native owner");
      }
    };
    return {
      assertCurrent,
      observe() {
        assertCurrent();
        // Failed schema admission must not transfer a maintenance-owned handle.
        observeBranchDatabaseMaintenanceResource(database.db);
      },
      release() {
        reference.release();
        operations.touch(database);
      },
    };
  };
  return {
    retain: (database: BranchStateDatabase) => retain(database, admit(database.path)),
    retainForIndependentRead(this: void, pathname: string, ownership?: "cached-read") {
      const { database, scope } = findReadDatabase(pathname, ownership);
      return database ? retainReadReference(database, scope) : undefined;
    },
    borrowForRead(this: void, pathname: string, ownership?: "cached-read") {
      const { database, scope } = findReadDatabase(pathname, ownership);
      if (!database) {
        return undefined;
      }
      if (database.db.isTransaction) {
        throw new Error("Asynchronous shared-state reads cannot run inside a native transaction");
      }
      return { database, ...retainReadReference(database, scope) };
    },
  };
}

export function assertStateDatabaseBorrowersReleased(
  owner: StateDatabaseBorrowers | undefined,
  pathname: string,
): void {
  if (owner?.references.size) {
    throw new Error(`Branch Agent state database still has active native borrowers: ${pathname}`);
  }
}

/** Preserve the requesting owner's retirement when the last reference is only a read pin. */
function retainStateDatabaseReference(params: {
  owner: StateDatabaseBorrowers;
  retirement?: RetirementIntent;
  retainFailedClose(): void;
}): { release(): void } {
  const { owner } = params;
  const reference = {};
  owner.references.add(reference);
  let released = false;
  return {
    release() {
      if (released || owner.cleanupComplete) {
        released = true;
        return;
      }
      owner.references.delete(reference);
      if (owner.retirement && !owner.retirement.isCurrent()) {
        owner.retirement = undefined;
        owner.retiring = false;
      }
      if (params.retirement?.isCurrent() && !owner.retirement?.ordinary) {
        owner.retirement = params.retirement;
      }
      if (owner.references.size > 0 || !owner.retirement) {
        released = true;
        return;
      }
      owner.retiring = true;
      try {
        owner.retirement.retire();
      } catch (error) {
        // The released reference transfers failed cleanup to the canonical cache.
        params.retainFailedClose();
        throw error;
      }
      owner.retirement = undefined;
      released = true;
    },
  };
}
