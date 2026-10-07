import { isPromiseLike } from "@branch/normalization-core/promise-like";
import { SqliteCoordinatorError } from "../infra/sqlite-lifecycle-errors.js";
import { runSqliteReadOperationSync } from "../infra/sqlite-schema-facts.js";
import { assertExistingDatabaseIdentity } from "../infra/sqlite-worker-identity.js";
import {
  getBranchDatabaseMaintenanceScope,
  observeBranchDatabaseMaintenanceResource,
  type BranchDatabaseMaintenanceScope,
} from "./branch-state-db-async-lifecycle.js";
import {
  captureBranchStateDatabaseReadAdmission,
  branchStateDatabaseCache,
  registerBranchStateDatabaseAsyncResource,
  requireBranchStateDatabaseIdentity,
} from "./branch-state-db-cache.js";
import type { BranchStateDatabase } from "./branch-state-db-contract.js";
import {
  assertStateReadSchema,
  openBranchStateReadOnlyLocation,
} from "./branch-state-db-read-connection.js";
import { isExistingBranchStateSchema } from "./branch-state-db-schema-policy.js";
import { isManagedStateTransaction } from "./branch-state-db-transaction.js";
import { allowsMaintenanceLiveAuthorityReads } from "./branch-state-maintenance-context.js";
import type { BranchStateReadOnlyDatabase } from "./branch-state-read.types.js";

export type ReusedBranchStateReadOnlyDatabase<T> = { reused: false } | { reused: true; value: T };

const maintenanceReaders = new WeakMap<
  BranchDatabaseMaintenanceScope,
  Map<string, { read: <T>(operation: (db: BranchStateReadOnlyDatabase) => T) => T }>
>();

/** Mutable maintenance owns this live reader until drainage; each guard queries current rows. */
export function withMaintenanceBranchStateDatabaseReadOnly<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  pathname: string,
): ReusedBranchStateReadOnlyDatabase<T> {
  const scope = getBranchDatabaseMaintenanceScope();
  if (!scope || !allowsMaintenanceLiveAuthorityReads(scope, pathname)) {
    return { reused: false };
  }
  scope.assertReadAdmission();
  let readers = maintenanceReaders.get(scope);
  if (!readers) {
    readers = new Map();
    maintenanceReaders.set(scope, readers);
  }
  let reader = readers.get(pathname);
  if (!reader) {
    const admission = captureBranchStateDatabaseReadAdmission(pathname);
    assertExistingDatabaseIdentity(pathname, admission.identity.key, admission.identity.birthtime);
    const connection = openBranchStateReadOnlyLocation(pathname, pathname);
    let closed = false;
    const close = () => {
      if (closed) {
        return;
      }
      if (!connection.close()) {
        throw new Error("Maintenance authority reader cleanup is incomplete");
      }
      closed = true;
      readers.delete(pathname);
      unregister();
    };
    const unregister = registerBranchStateDatabaseAsyncResource({
      async close(identity) {
        if (
          !identity ||
          identity.key === admission.identity.key ||
          identity.canonicalPath === admission.identity.canonicalPath
        ) {
          close();
        }
      },
    });
    scope.own(connection, "shared-handles", close);
    reader = {
      read(readOperation) {
        admission.assertCurrent();
        assertExistingDatabaseIdentity(
          pathname,
          admission.identity.key,
          admission.identity.birthtime,
        );
        const value = runSqliteReadOperationSync(connection.database.db, () => {
          assertStateReadSchema(connection.database.db, pathname);
          return readOperation(connection.database);
        });
        if (isPromiseLike(value)) {
          throw new SqliteCoordinatorError(
            "SQLite maintenance authority read must remain synchronous",
          );
        }
        return value;
      },
    };
    readers.set(pathname, reader);
  }
  return { reused: true, value: reader.read(operation) };
}

/** Current-authority guards can borrow their writer; discovery sees committed rows. */
export function withCachedBranchStateDatabaseReadOnly<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  pathname: string,
  currentAuthority: boolean,
): ReusedBranchStateReadOnlyDatabase<T> {
  const opened = branchStateDatabaseCache.getCachedBranchStateDatabase(pathname, {
    readOnly: true,
  });
  if (!opened?.db.isOpen) {
    return { reused: false };
  }
  const ownedTransaction = currentAuthority && isManagedStateTransaction(opened.db);
  if (opened.db.isTransaction && !ownedTransaction) {
    return { reused: false };
  }
  try {
    // Cache acquisition already checked supported-version admission. Managed
    // existing schemas retain their stricter runtime-shape policy.
    if (isExistingBranchStateSchema(pathname, opened.db)) {
      assertStateReadSchema(opened.db, pathname);
    }
    observeBranchDatabaseMaintenanceResource(opened.db);
    const value = operation(opened);
    if (ownedTransaction && isPromiseLike(value)) {
      throw new SqliteCoordinatorError("SQLite current-authority read must remain synchronous");
    }
    return { reused: true, value };
  } catch (error) {
    branchStateDatabaseCache.evictBranchStateDatabaseAfterCorruption(opened, error);
    throw error;
  }
}

/** A native read borrow can avoid copying only while its original physical path still matches. */
export function canReadWarmNativeSourceIndependently(
  database: BranchStateDatabase,
  pathname: string,
  admittedIdentity: string,
): boolean {
  const identity = requireBranchStateDatabaseIdentity(database);
  if (identity.key !== admittedIdentity) {
    return false;
  }
  try {
    assertExistingDatabaseIdentity(pathname, identity.key);
    return true;
  } catch {
    // An unavailable or replaced path keeps the original native snapshot source.
    return false;
  }
}
