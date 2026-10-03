import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync-cache-state.js";
import { setSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import {
  assertSqliteIntegrity,
  SqliteRepairableForeignKeyError,
} from "../infra/sqlite-integrity.js";
import {
  assertSqliteSchemaContains,
  getCanonicalSqliteTableNames,
  readSqliteSchemaCookie,
} from "../infra/sqlite-schema-contract.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { withStateDatabaseSchemaMaintenance } from "../infra/state-database-maintenance.js";
import { branchStateDatabaseCache } from "./branch-state-db-cache.js";
import {
  BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  type BranchStateDatabaseOptions,
} from "./branch-state-db-contract.js";
import { assertExistingBranchStateRuntimeSchema } from "./branch-state-db-existing-schema.js";
import { openTrackedStateDatabase, closeTrackedStateDatabase } from "./branch-state-db-handle.js";
import { assertBranchStateDatabaseOwner } from "./branch-state-db-maintenance.js";
import {
  assertBranchStateSchemaRepairAllowed,
  isExistingBranchStateSchema,
} from "./branch-state-db-schema-policy.js";
import { assertSupportedStateSchemaVersion } from "./branch-state-db-schema-version.js";
import { recoverOrphanTaskDeliveryRows } from "./branch-state-db-task-delivery-recovery.js";
import { runManagedStateTransaction } from "./branch-state-db-transaction.js";
import { resolveDatabasePath } from "./branch-state-db.paths.js";
import { assertBranchStateWriteAllowed } from "./branch-state-ownership.js";

/** Validate only the stable storage subset used by an existing-schema owner.
 * This read neither repairs nor grants write authority; callers retain their
 * actual handle, generation, lease and publication checks. */
function assertExistingBranchStateSchema(
  db: DatabaseSync,
  pathname: string,
  schemaSql: string,
): number {
  const version = assertSupportedStateSchemaVersion(db, pathname);
  const metadata = assertBranchStateDatabaseOwner(db, { pathname });
  if (version < 1 || metadata?.schema_version !== version) {
    throw new Error("Existing-state schema metadata is inconsistent.");
  }
  assertSqliteIntegrity(db, pathname);
  assertSqliteSchemaContains(db, pathname, schemaSql);
  return version;
}

/** A synchronous write to an already-compatible, caller-owned schema subset.
 * No database bootstrap, schema repair, journal-mode setup, cached publication or WAL timer.
 * First-use owners may install their declared additive tables; existing objects
 * must already match. This never opens or migrates the full runtime schema.
 * The admitted native connection owns transaction serialization.
 */
export function runExistingBranchStateWriteTransaction<T>(
  operation: (database: { db: DatabaseSync; path: string; recoveryChanges: string[] }) => T,
  options: BranchStateDatabaseOptions,
  contract: {
    schemaSql: string;
    operationLabel: string;
    busyTimeoutMs?: number;
    initializeAdditiveSchema?: boolean;
    recoverTaskDeliveryOrphans?: true;
  },
): T {
  if (options.database || options.readOnly) {
    throw new Error("Existing-state writes require their own tracked writable connection.");
  }
  const env = options.env ?? process.env;
  const busyTimeoutMs = contract.busyTimeoutMs ?? BRANCH_SQLITE_BUSY_TIMEOUT_MS;
  const pathname = resolveDatabasePath({ path: options.path, env });
  const existingSchema = isExistingBranchStateSchema(pathname);
  if (contract.recoverTaskDeliveryOrphans) {
    assertBranchStateSchemaRepairAllowed(pathname);
  }
  const original = fs.lstatSync(pathname);
  if (!original.isFile()) {
    throw new Error("Existing-state write requires a regular database file.");
  }
  const assertSameFile = () => {
    const current = fs.lstatSync(pathname);
    if (!current.isFile() || current.dev !== original.dev || current.ino !== original.ino) {
      throw new Error("Existing-state database generation changed.");
    }
  };
  const write = () => {
    assertSameFile();
    branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(pathname, env);
    const db = openTrackedStateDatabase(pathname, {
      existingOnly: true,
      // Match Doctor: inbound dependents must fail validation, never cascade away.
      ...(contract.recoverTaskDeliveryOrphans ? { enableForeignKeyConstraints: false } : {}),
    });
    try {
      setSqliteBusyTimeout(db, busyTimeoutMs);
      return runManagedStateTransaction(
        db,
        () => {
          assertSameFile();
          assertBranchStateWriteAllowed({ database: db, databasePath: pathname, env });
          if (existingSchema) {
            assertExistingBranchStateRuntimeSchema(db, pathname);
          }
          const validate = () =>
            assertExistingBranchStateSchema(
              db,
              pathname,
              contract.initializeAdditiveSchema ? "" : contract.schemaSql,
            );
          let version: number;
          let recoveryChanges: string[] = [];
          try {
            version = validate();
          } catch (error) {
            if (
              !contract.recoverTaskDeliveryOrphans ||
              !(error instanceof SqliteRepairableForeignKeyError)
            ) {
              throw error;
            }
            recoveryChanges = recoverOrphanTaskDeliveryRows(db, pathname);
            version = validate();
          }
          if (contract.initializeAdditiveSchema) {
            // Validate present objects before first use: CREATE IF NOT EXISTS
            // must not hide drift or repair an incomplete existing table.
            assertSqliteSchemaContains(db, pathname, contract.schemaSql, {
              allowedMissingTables: getCanonicalSqliteTableNames(contract.schemaSql),
            });
            db.exec(contract.schemaSql); // sqlite-allow-raw -- Declared canonical feature-local additive DDL only.
            assertSqliteSchemaContains(db, pathname, contract.schemaSql);
          }
          const schemaVersion = readSqliteSchemaCookie(db);
          const result = operation({ db, path: pathname, recoveryChanges });
          assertSameFile();
          if (
            readSqliteUserVersion(db) !== version ||
            readSqliteSchemaCookie(db) !== schemaVersion
          ) {
            throw new Error("Existing-state transaction cannot migrate schema.");
          }
          if (contract.recoverTaskDeliveryOrphans) {
            assertSqliteIntegrity(db, pathname);
          }
          return result;
        },
        {
          busyTimeoutMs,
          databaseLabel: pathname,
          operationLabel: contract.operationLabel,
        },
      );
    } finally {
      clearNodeSqliteKyselyCacheForDatabase(db);
      closeTrackedStateDatabase(db);
    }
  };
  return contract.recoverTaskDeliveryOrphans
    ? withStateDatabaseSchemaMaintenance({ databasePath: pathname }, write)
    : write();
}
