import { isSqliteCorruptionError } from "../infra/sqlite-error-diagnostics.js";
import { throwSqliteLifecycleErrors } from "../infra/sqlite-lifecycle-errors.js";
import {
  admitSqliteSchema,
  getAdmittedSqliteSchemaFacts,
  runSqliteReadOperationSync,
} from "../infra/sqlite-schema-facts.js";
import { isSqliteSchemaVersionError } from "../infra/sqlite-user-version.js";
import type { CachedBranchStateDatabase } from "./branch-state-db-cache.types.js";
import type { BranchStateDatabase } from "./branch-state-db-contract.js";
import { markBranchStateDatabaseFailure } from "./branch-state-db-failure.js";
import { assertSupportedStateSchemaVersion } from "./branch-state-db-schema-version.js";

type CacheAdmissionOwner = {
  cachedDatabases: Map<string, CachedBranchStateDatabase>;
  evict(database: BranchStateDatabase): boolean;
  recordSchemaFailure(pathname: string, error: Error): void;
  invalidate(pathname: string): void;
  notifyTerminalFailure(pathname: string, error: Error): void;
};

/** Refresh cached-handle admission and settle failures against its exact native owner. */
export function createStateDatabaseCacheAdmission(owner: CacheAdmissionOwner) {
  return {
    initialize(database: BranchStateDatabase) {
      admitSqliteSchema(database.db);
      return runSqliteReadOperationSync(database.db, () => {
        assertSupportedStateSchemaVersion(database.db, database.path);
        return getAdmittedSqliteSchemaFacts(database.db);
      });
    },
    closeTerminalFailure(pathname: string, error: Error): void {
      markBranchStateDatabaseFailure(error, pathname);
      owner.invalidate(pathname);
      const cached = owner.cachedDatabases.get(pathname);
      const errors: unknown[] = [];
      try {
        if (cached) {
          owner.evict(cached);
        }
      } catch (cleanupError) {
        errors.push(cleanupError);
      }
      try {
        owner.notifyTerminalFailure(pathname, error);
      } catch (notificationError) {
        errors.push(notificationError);
      }
      throwSqliteLifecycleErrors(errors, "Terminal shared-state failure cleanup failed");
    },
    refresh(database: CachedBranchStateDatabase): boolean {
      try {
        runSqliteReadOperationSync(database.db, () => {
          const facts = getAdmittedSqliteSchemaFacts(database.db);
          if (!facts || facts !== database.schemaFacts) {
            assertSupportedStateSchemaVersion(database.db, database.path);
            database.schemaFacts = facts;
          }
        });
        return true;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        if (isSqliteCorruptionError(failure)) {
          owner.evict(database);
          return false;
        }
        if (isSqliteSchemaVersionError(failure)) {
          owner.recordSchemaFailure(database.path, failure);
        }
        throw failure;
      }
    },
  };
}
