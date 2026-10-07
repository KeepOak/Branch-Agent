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
  asyncRetirement?: {
    start(): void;
    close(): Promise<void>;
  };
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
    ownRetirement(database: BranchStateDatabase, close: () => Promise<void>): () => void;
    touch(database: BranchStateDatabase): void;
  },
) {
  const admit = (pathname: string, ownership?: "cached-read") => {
    const scope = getBranchDatabaseMaintenanceScope();
    if (ownership === "cached-read") {
      scope?.assertReadAdmission();
    } else {
      scope?.assertAdmission();
    }
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
      stopBeforeRetirement: () => database.walMaintenance.stop(),
      retainFailedClose: () => operations.retainFailed(database),
      ownRetirement: (close) => operations.ownRetirement(database, close),
      onIdle: () => operations.touch(database),
    });
    scope?.own(reference, "shared-references", () => reference.releaseAsync());
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
      release: () => reference.release(),
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
  stopBeforeRetirement(): Promise<void>;
  retainFailedClose(): void;
  ownRetirement(close: () => Promise<void>): () => void;
  onIdle(): void;
}): { release(): void; releaseAsync(): Promise<void> } {
  const { owner } = params;
  const reference = {};
  owner.references.add(reference);
  let released = false;
  const release = () => {
    if (released || owner.cleanupComplete) {
      released = true;
      return;
    }
    released = true;
    owner.references.delete(reference);
    if (owner.retirement && !owner.retirement.isCurrent()) {
      owner.retirement = undefined;
      owner.asyncRetirement = undefined;
      owner.retiring = false;
    }
    if (params.retirement?.isCurrent() && !owner.retirement?.ordinary) {
      owner.retirement = params.retirement;
    }
    if (owner.references.size > 0) {
      return;
    }
    if (!owner.retirement) {
      params.onIdle();
      return;
    }
    owner.retiring = true;
    if (owner.asyncRetirement) {
      owner.asyncRetirement.start();
      return;
    }
    try {
      owner.retirement.retire();
    } catch (error) {
      // The released reference transfers failed cleanup to the canonical cache.
      released = false;
      params.retainFailedClose();
      throw error;
    }
    owner.retirement = undefined;
    params.onIdle();
  };
  return {
    release,
    async releaseAsync() {
      if (owner.cleanupComplete) {
        return;
      }
      const retirement =
        params.retirement?.isCurrent() && !owner.retirement?.ordinary
          ? params.retirement
          : owner.retirement;
      if (retirement?.isCurrent()) {
        owner.asyncRetirement ??= createAsyncStateDatabaseRetirement(params);
      }
      release();
      await owner.asyncRetirement?.close();
    },
  };
}

function createAsyncStateDatabaseRetirement(
  params: Pick<
    Parameters<typeof retainStateDatabaseReference>[0],
    "owner" | "stopBeforeRetirement" | "retainFailedClose" | "ownRetirement" | "onIdle"
  >,
): NonNullable<StateDatabaseBorrowers["asyncRetirement"]> {
  const { owner } = params;
  const retained = {};
  let pending: Promise<void> | undefined;
  let unregister: (() => void) | undefined;
  const finish = (retirement?: RetirementIntent) => {
    owner.references.delete(retained);
    if (retirement?.isCurrent()) {
      retirement.retire();
    } else {
      owner.retiring = false;
    }
    owner.retirement = undefined;
    owner.asyncRetirement = undefined;
    unregister?.();
    unregister = undefined;
    params.onIdle();
  };
  const run = (): Promise<void> => {
    if (pending) {
      return pending;
    }
    if (owner.cleanupComplete || owner.references.size > (owner.references.has(retained) ? 1 : 0)) {
      return Promise.resolve();
    }
    if (!owner.retirement?.isCurrent()) {
      finish();
      return Promise.resolve();
    }
    owner.retiring = true;
    // Keep physical custody across the join, including synchronous cache-close attempts.
    owner.references.add(retained);
    unregister ??= params.ownRetirement(close);
    pending = Promise.resolve()
      .then(async () => {
        await params.stopBeforeRetirement();
        finish(owner.retirement);
      })
      .catch((error: unknown) => {
        owner.references.add(retained);
        params.retainFailedClose();
        throw error;
      });
    // A synchronous final release hands failures to the registered lifecycle resource.
    void pending.catch(() => {});
    return pending;
  };
  function close(): Promise<void> {
    const attempt = run();
    return attempt.catch((error: unknown) => {
      if (pending === attempt) {
        pending = undefined;
      }
      throw error;
    });
  }
  return { start: () => void run(), close };
}
