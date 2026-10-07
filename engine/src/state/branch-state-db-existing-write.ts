import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { clearNodeSqliteKyselyCacheForDatabase } from "../infra/kysely-sync-cache-state.js";
import { setSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import {
  assertSqliteIntegrity,
  SqliteRepairableForeignKeyError,
} from "../infra/sqlite-integrity.js";
import { assertNoActiveSqliteReaders } from "../infra/sqlite-reader-lifecycle.js";
import {
  assertSqliteSchemaContains,
  getCanonicalSqliteTableNames,
  readSqliteSchemaCookie,
  type SqliteSchemaCompatibility,
} from "../infra/sqlite-schema-contract.js";
import {
  admitSqliteSchema,
  getAdmittedSqliteSchemaFacts,
  readSqliteCacheDataVersion,
} from "../infra/sqlite-schema-facts.js";
import { assertTransactionUsable } from "../infra/sqlite-transaction.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { withStateDatabaseSchemaMaintenance } from "../infra/state-database-maintenance.js";
import { branchStateDatabaseCache } from "./branch-state-db-cache.js";
import {
  BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  type BranchStateDatabaseOptions,
} from "./branch-state-db-contract.js";
import {
  assertExistingBranchStateRuntimeMetadata,
  assertExistingBranchStateRuntimeSchema,
} from "./branch-state-db-existing-schema.js";
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

type ExistingWriteOptions = BranchStateDatabaseOptions & { busyTimeoutMs?: number };
type ExistingWriteContract = {
  schemaSql: string;
  schemaCompatibility?: SqliteSchemaCompatibility;
  operationLabel: string;
  busyTimeoutMs?: number;
};
type OneShotWriteContract = ExistingWriteContract & {
  initializeAdditiveSchema?: boolean;
  recoverTaskDeliveryOrphans?: true;
};
type ExistingWriteOperation<T> = (database: {
  db: DatabaseSync;
  path: string;
  recoveryChanges: string[];
}) => T;

export type ExistingBranchStateWriter = {
  run<T>(operation: ExistingWriteOperation<T>, options: ExistingWriteOptions): T;
  assertSettled(): void;
  close(): void;
};

function assertExistingBranchStateSchemaMetadata(
  db: DatabaseSync,
  pathname: string,
  version: number,
): void {
  const metadata = assertBranchStateDatabaseOwner(db, { pathname });
  if (version < 1 || metadata?.schema_version !== version) {
    throw new Error("Existing-state schema metadata is inconsistent.");
  }
}

/** Validate only the stable storage subset used by an existing-schema owner.
 * This read neither repairs nor grants write authority; callers retain their
 * actual handle, generation, lease and publication checks. */
function assertExistingBranchStateSchema(
  db: DatabaseSync,
  pathname: string,
  schemaSql: string,
  compatibility?: SqliteSchemaCompatibility,
): number {
  const version = assertSupportedStateSchemaVersion(db, pathname);
  assertExistingBranchStateSchemaMetadata(db, pathname, version);
  assertSqliteIntegrity(db, pathname);
  assertSqliteSchemaContains(db, pathname, schemaSql, compatibility);
  return version;
}

/** A synchronous write to an already-compatible, caller-owned schema subset.
 * No database bootstrap, schema repair, journal-mode setup, cached publication or WAL timer.
 * First-use owners may install their declared additive tables; existing objects
 * must already match. This never opens or migrates the full runtime schema.
 * The admitted native connection owns transaction serialization.
 */
export function runExistingBranchStateWriteTransaction<T>(
  operation: ExistingWriteOperation<T>,
  options: BranchStateDatabaseOptions,
  contract: OneShotWriteContract,
): T {
  const prepared = prepareExistingBranchStateWriter(options, contract);
  const write = () => {
    const writer = createExistingBranchStateWriter(prepared, contract);
    try {
      return writer.run(operation, options);
    } finally {
      writer.close();
    }
  };
  return contract.recoverTaskDeliveryOrphans
    ? withStateDatabaseSchemaMaintenance({ databasePath: prepared.pathname }, write)
    : write();
}

/** Retain the admitted subset connection without bootstrapping the runtime schema. */
export function openExistingBranchStateWriter(
  options: BranchStateDatabaseOptions,
  contract: ExistingWriteContract,
): ExistingBranchStateWriter {
  return createExistingBranchStateWriter(
    prepareExistingBranchStateWriter(options, contract),
    contract,
  );
}

function prepareExistingBranchStateWriter(
  options: BranchStateDatabaseOptions,
  contract: OneShotWriteContract,
) {
  if (options.database || options.readOnly) {
    throw new Error("Existing-state writes require their own tracked writable connection.");
  }
  const env = options.env ?? process.env;
  const pathname = resolveDatabasePath({ path: options.path, env });
  isExistingBranchStateSchema(pathname);
  if (contract.recoverTaskDeliveryOrphans) {
    assertBranchStateSchemaRepairAllowed(pathname);
  }
  const original = fs.lstatSync(pathname);
  if (!original.isFile()) {
    throw new Error("Existing-state write requires a regular database file.");
  }
  return { env, pathname, original };
}

function createExistingBranchStateWriter(
  { env, pathname, original }: ReturnType<typeof prepareExistingBranchStateWriter>,
  contract: OneShotWriteContract,
): ExistingBranchStateWriter {
  const assertSameFile = () => {
    const current = fs.lstatSync(pathname);
    if (!current.isFile() || current.dev !== original.dev || current.ino !== original.ino) {
      throw new Error("Existing-state database generation changed.");
    }
  };
  assertSameFile();
  branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(pathname, env);
  const db = openTrackedStateDatabase(pathname, {
    existingOnly: true,
    // Match Doctor: inbound dependents must fail validation, never cascade away.
    ...(contract.recoverTaskDeliveryOrphans ? { enableForeignKeyConstraints: false } : {}),
  });
  let closed = false;
  let admitted: { version: number; cookie: number; existingSchema: boolean } | undefined;
  return {
    run(operation, currentOptions) {
      if (closed || !db.isOpen) {
        throw new Error("Existing-state writer is closed.");
      }
      if (currentOptions.database || currentOptions.readOnly) {
        throw new Error("Existing-state writes require their own tracked writable connection.");
      }
      const currentEnv = currentOptions.env ?? process.env;
      if (resolveDatabasePath({ path: currentOptions.path, env: currentEnv }) !== pathname) {
        throw new Error("Existing-state writer cannot change its database path.");
      }
      assertSameFile();
      const existingSchema = isExistingBranchStateSchema(pathname);
      if (admitted && existingSchema !== admitted.existingSchema) {
        throw new Error("Existing-state writer schema admission changed.");
      }
      // Facts rebuilt outside BEGIN survive ordinary transaction commits.
      if (admitted) {
        readSqliteCacheDataVersion(db);
        getAdmittedSqliteSchemaFacts(db);
      }
      const busyTimeoutMs =
        currentOptions.busyTimeoutMs ?? contract.busyTimeoutMs ?? BRANCH_SQLITE_BUSY_TIMEOUT_MS;
      setSqliteBusyTimeout(db, busyTimeoutMs);
      let pendingAdmission: typeof admitted;
      const result = runManagedStateTransaction(
        db,
        () => {
          assertSameFile();
          assertBranchStateWriteAllowed({
            database: db,
            databasePath: pathname,
            env: currentEnv,
          });
          let needsAdmission = !admitted;
          if (admitted) {
            readSqliteCacheDataVersion(db);
            const facts = getAdmittedSqliteSchemaFacts(db);
            if (!facts) {
              throw new Error("Existing-state writer schema facts are unavailable.");
            }
            needsAdmission =
              facts.userVersion !== admitted.version || facts.schemaVersion !== admitted.cookie;
          }
          if (needsAdmission && existingSchema) {
            assertExistingBranchStateRuntimeSchema(db, pathname);
          }
          const validate = () =>
            assertExistingBranchStateSchema(
              db,
              pathname,
              !admitted && contract.initializeAdditiveSchema ? "" : contract.schemaSql,
              contract.schemaCompatibility,
            );
          let version: number;
          let recoveryChanges: string[] = [];
          if (admitted && !needsAdmission) {
            if (existingSchema) {
              version = assertExistingBranchStateRuntimeMetadata(db, pathname);
            } else {
              version = assertSupportedStateSchemaVersion(db, pathname);
              assertExistingBranchStateSchemaMetadata(db, pathname, version);
            }
          } else {
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
          }
          if (!admitted && contract.initializeAdditiveSchema) {
            // Validate present objects before first use: CREATE IF NOT EXISTS
            // must not hide drift or repair an incomplete existing table.
            assertSqliteSchemaContains(db, pathname, contract.schemaSql, {
              ...contract.schemaCompatibility,
              allowedMissingTables: getCanonicalSqliteTableNames(contract.schemaSql),
            });
            db.exec(contract.schemaSql); // sqlite-allow-raw -- Declared canonical feature-local additive DDL only.
            assertSqliteSchemaContains(
              db,
              pathname,
              contract.schemaSql,
              contract.schemaCompatibility,
            );
          }
          const schemaVersion = readSqliteSchemaCookie(db);
          if (typeof schemaVersion !== "number") {
            throw new Error("Existing-state schema version is unavailable.");
          }
          if (needsAdmission) {
            admitSqliteSchema(db);
            pendingAdmission = { version, cookie: schemaVersion, existingSchema };
          }
          const value = operation({ db, path: pathname, recoveryChanges });
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
          return value;
        },
        {
          busyTimeoutMs,
          databaseLabel: pathname,
          operationLabel: contract.operationLabel,
        },
      );
      if (pendingAdmission) {
        admitted = pendingAdmission;
      }
      return result;
    },
    assertSettled() {
      assertSameFile();
      assertTransactionUsable(db);
      if (db.isOpen && db.isTransaction) {
        throw new Error("Existing-state writer retained an unsettled transaction");
      }
      if (db.isOpen) {
        assertNoActiveSqliteReaders(db, "Existing-state writer");
      }
    },
    close() {
      closed = true;
      clearNodeSqliteKyselyCacheForDatabase(db);
      closeTrackedStateDatabase(db);
    },
  };
}
