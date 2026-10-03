import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { withStateDatabaseColdAdmission } from "../infra/gateway-state-owner.js";
import {
  normalizeSqliteNonNegativeInteger,
  runWithSqliteBusyTimeout,
  setSqliteBusyTimeout,
  type SqliteLockFailureReporting,
} from "../infra/sqlite-busy-timeout.js";
import { assertSqliteIntegrity } from "../infra/sqlite-integrity.js";
import { createSqliteLifecycleAggregateError } from "../infra/sqlite-lifecycle-errors.js";
import { captureSqliteReaderOwner } from "../infra/sqlite-reader-lifecycle.js";
import { prepareSqliteReadOnlyLocation } from "../infra/sqlite-snapshot-source.js";
import {
  assertTransactionUsable,
  type SqliteTransactionOptions,
} from "../infra/sqlite-transaction.js";
import { readSqliteUserVersion } from "../infra/sqlite-user-version.js";
import { createSqliteWalReclamationResult } from "../infra/sqlite-wal-reclamation.js";
import {
  StateSchemaMutationConflictError,
  withStateDatabaseSchemaMaintenance,
} from "../infra/state-database-maintenance.js";
import {
  getBranchDatabaseMaintenanceScope,
  observeBranchDatabaseMaintenanceResource,
} from "./branch-state-db-async-lifecycle.js";
import {
  closeBranchStateDatabaseByPathAsync,
  branchStateDatabaseCache as stateDbCache,
  recordBranchStateDatabaseOpenFailure,
} from "./branch-state-db-cache.js";
import {
  BRANCH_DATABASE_SCHEMA_DOCS_URL,
  BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  BRANCH_STATE_SCHEMA_VERSION,
  type BranchStateDatabase,
  type BranchStateDatabaseOptions,
} from "./branch-state-db-contract.js";
import { openDoctorStateSchemaReadAdmission } from "./branch-state-db-doctor-schema.js";
import { assertExistingBranchStateRuntimeSchema } from "./branch-state-db-existing-schema.js";
import { needsBranchStateDatabaseSchemaRepair } from "./branch-state-db-fast-path.js";
import {
  assertBranchStateDatabaseForMaintenance,
  markCurrentStateSchemaVersion,
} from "./branch-state-db-maintenance.js";
import { openUnpublishedStateDatabase } from "./branch-state-db-open.js";
import { ensureBranchStatePermissions } from "./branch-state-db-permissions.js";
import { openBranchStateReadConnection } from "./branch-state-db-read-connection.js";
import { withExistingBranchStateDatabaseReadOnly } from "./branch-state-db-readonly.js";
import { repairStateSchema } from "./branch-state-db-repair.js";
import {
  assertBranchStateSchemaRepairAllowed,
  isExistingBranchStateSchema,
  recordExistingBranchStateSchemaDatabase,
} from "./branch-state-db-schema-policy.js";
import { ensureBranchStateRuntimeSchema as ensureSchema } from "./branch-state-db-schema-runtime.js";
import {
  assertSupportedStateSchemaVersion,
  readStateSchemaContentVersion,
} from "./branch-state-db-schema-version.js";
import {
  initializeNativeBranchStateConnection,
  withBranchStateStartupCheckpointConnection,
} from "./branch-state-db-startup-checkpoint.js";
import { runManagedStateTransaction } from "./branch-state-db-transaction.js";
import { resolveDatabasePath } from "./branch-state-db.paths.js";
import {
  assertBranchStateWriteAllowed,
  assertBranchStateWriteAllowedAtPath,
  isBranchStateWriteContentionError,
} from "./branch-state-ownership.js";
import {
  readStateSchemaPublicationBlocker,
  type StateSchemaPublicationBlocker,
} from "./branch-state-schema-publication.js";

export { registerBranchStateDatabaseLifecycleListener } from "./branch-state-db-cache.js";

export { BRANCH_DATABASE_SCHEMA_DOCS_URL, BRANCH_SQLITE_BUSY_TIMEOUT_MS };
export type {
  BranchStateDatabase,
  BranchStateDatabaseOptions,
  BranchStateDatabaseSchemaMigration,
} from "./branch-state-db-contract.js";
export { assertBranchStateDatabaseForMaintenance } from "./branch-state-db-maintenance.js";
export { ensureBranchStatePermissions } from "./branch-state-db-permissions.js";
export { detectBranchStateDatabaseSchemaMigrations } from "./branch-state-db-schema-discovery.js";

/** Reject a fresh shared-state open after known corruption until repair clears it. */
function assertBranchStateDatabaseFreshOpenAllowed(
  options: BranchStateDatabaseOptions = {},
): void {
  const env = options.env ?? process.env;
  stateDbCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(resolveDatabasePath(options), env);
}

const deferredStateDatabases = new WeakSet<DatabaseSync>();

function repairDoctorStateDatabase(
  options: BranchStateDatabaseOptions,
  scope: "doctor" | "indexes" | "readability",
): { changes: string[]; warnings: string[] } {
  const env = options.env ?? process.env;
  const pathname = resolveDatabasePath(options);
  assertBranchStateSchemaRepairAllowed(pathname);
  if (!existsSync(pathname)) {
    return { changes: [], warnings: [] };
  }
  if (scope === "readability") {
    // A writer close can checkpoint WAL and invalidate a generation-bound corruption refusal.
    assertBranchStateDatabaseFreshOpenAllowed(options);
  }
  return withStateDatabaseSchemaMaintenance({ databasePath: pathname }, () =>
    repairStateSchema(pathname, env, scope),
  );
}

export function repairBranchStateDatabaseSchema(options: BranchStateDatabaseOptions = {}): {
  changes: string[];
  warnings: string[];
} {
  return repairDoctorStateDatabase(options, "doctor");
}

/** Explicit Doctor maintenance before config readers encounter a quarantined index. */
export function repairBranchStateDatabaseIndexesForDoctor(
  options: BranchStateDatabaseOptions = {},
): { changes: string[]; warnings: string[] } {
  return repairDoctorStateDatabase(options, "indexes");
}

/** Repair known catalog damage and preserve orphan rows before Doctor backs up or loads state. */
export function repairBranchStateDatabaseReadabilityForDoctor(
  options: BranchStateDatabaseOptions = {},
): { changes: string[]; warnings: string[] } {
  return repairDoctorStateDatabase(options, "readability");
}

/** Prepare schema and retire resources only when the admitted operation actually repairs it. */
export async function prepareBranchStateDatabaseSchema(
  options: BranchStateDatabaseOptions = {},
  mode: "automatic" | "doctor-preparation" | "doctor" = "automatic",
): Promise<{
  changes: string[];
  warnings: string[];
}> {
  const env = options.env ?? process.env;
  const pathname = resolveDatabasePath(options);
  assertBranchStateSchemaRepairAllowed(pathname);
  if (!existsSync(pathname)) {
    return { changes: [], warnings: [] };
  }

  const scope = mode === "automatic" ? "automatic" : "doctor";
  await assertBranchStateWriteAllowedAtPath({
    databasePath: pathname,
    env,
    recoverOrphanedSidecars: false,
    ...(scope === "doctor"
      ? { openStateSchemaReadAdmission: openDoctorStateSchemaReadAdmission }
      : {}),
  });
  let repairStarted = false;
  try {
    let needsRepair = mode === "doctor";
    if (mode === "doctor-preparation") {
      try {
        assertBranchStateDatabaseFreshOpenAllowed(options);
      } catch {
        // The full repair must clear quarantine before dependent readers can proceed.
        needsRepair = true;
      }
    }
    return needsRepair || needsBranchStateDatabaseSchemaRepair(pathname, scope)
      ? withStateDatabaseSchemaMaintenance({ databasePath: pathname }, () => {
          repairStarted = true;
          return repairStateSchema(pathname, env, scope);
        })
      : { changes: [], warnings: [] };
  } finally {
    // Readiness checks borrow the live generation; only admitted repair retires it.
    if (repairStarted) {
      await closeBranchStateDatabaseByPathAsync(pathname);
    }
  }
}

/** Bootstrap fresh/native-only state canonically before startup checkpoint access. */
export function withBranchStateStartupMigrationCheckpointDatabase<T>(
  callback: (db: DatabaseSync) => T,
  options: BranchStateDatabaseOptions & { atomic?: boolean } = {},
): T {
  return withBranchStateStartupCheckpointConnection(callback, options, ensureSchema);
}

/** Complete native bootstrap without migrating mature shared state. */
export function initializeNativeBranchStateDatabase(
  options: BranchStateDatabaseOptions = {},
): void {
  initializeNativeBranchStateConnection(options, (db, pathname, env, initialization) =>
    ensureSchema(db, pathname, env, initialization, BRANCH_SQLITE_BUSY_TIMEOUT_MS, true),
  );
}

/** Open existing shared state without creating, migrating, chmodding, or configuring it. */
export async function openExistingBranchStateDatabaseReadOnly(
  options: BranchStateDatabaseOptions = {},
): Promise<BranchStateDatabase | undefined> {
  const pathname = resolveDatabasePath(options);
  isExistingBranchStateSchema(pathname);
  if (!existsSync(pathname)) {
    return undefined;
  }
  assertBranchStateDatabaseFreshOpenAllowed(options);
  const prepared = await prepareSqliteReadOnlyLocation(pathname);
  const connection = openBranchStateReadConnection(pathname, prepared);
  const { db } = connection.database;
  try {
    assertSupportedStateSchemaVersion(db, pathname);
    assertSqliteIntegrity(db, pathname);
    if (isExistingBranchStateSchema(pathname, db)) {
      assertExistingBranchStateRuntimeSchema(db, pathname);
    }
    if (readStateSchemaContentVersion(db) === BRANCH_STATE_SCHEMA_VERSION) {
      assertBranchStateDatabaseForMaintenance(db, { pathname });
    }
  } catch (error) {
    try {
      connection.close();
    } catch {
      // Preserve the verification failure that explains why the database was refused.
    }
    throw error;
  }
  return {
    db,
    path: pathname,
    walMaintenance: {
      checkpoint: () => false,
      reclaimFreePages: createSqliteWalReclamationResult,
      // Cleanup can fail transiently after the database closes. Keep the
      // close contract retryable until one call finishes both responsibilities.
      close: () => connection.close(),
    },
  };
}

/** Open or return a cached shared state database after schema and migration checks. */

function openBranchStateDatabaseWithBusyTimeout(
  options: BranchStateDatabaseOptions = {},
  busyTimeoutMs = BRANCH_SQLITE_BUSY_TIMEOUT_MS,
  lockFailureReporting: SqliteLockFailureReporting = "report",
  remainingColdAdmissionTimeout?: () => number,
): BranchStateDatabase {
  getBranchDatabaseMaintenanceScope()?.assertAdmission();
  const env = options.env ?? process.env;
  if (options.database) {
    assertStateDatabaseSchemaAdmission(options.database);
    assertBranchStateWriteAllowed({
      database: options.database.db,
      databasePath: options.database.path,
      env,
    });
    observeBranchDatabaseMaintenanceResource(options.database.db);
    stateDbCache.touchStateDatabase(options.database);
    return options.database;
  }
  const pathname = resolveDatabasePath(options);
  const existingSchema = isExistingBranchStateSchema(pathname);
  const cached = stateDbCache.getCachedBranchStateDatabase(pathname);
  if (cached?.db.isOpen) {
    // A refused cache borrow did not open or damage the database. Failure owners
    // publish their own retirement events; caller admission must not retire it.
    stateDbCache.assertBranchStateDatabaseOpenAllowed(pathname);
    assertStateDatabaseSchemaAdmission(cached);
    assertBranchStateWriteAllowed({
      database: cached.db,
      databasePath: pathname,
      env,
      schemaReady: true,
    });
    observeBranchDatabaseMaintenanceResource(cached.db);
    if (!existingSchema && deferredStateDatabases.has(cached.db)) {
      reconcileBranchStateSchemaPublication(options);
      if (readSqliteUserVersion(cached.db) === BRANCH_STATE_SCHEMA_VERSION) {
        deferredStateDatabases.delete(cached.db);
      }
    }
    return cached;
  }
  let unpublished: BranchStateDatabase | undefined;
  try {
    const open = (remaining: () => number) => {
      getBranchDatabaseMaintenanceScope()?.assertAdmission();
      stateDbCache.assertBranchStateDatabaseOpenAllowed(pathname);
      assertBranchStateDatabaseFreshOpenAllowed(options);
      if (cached) {
        // A closed handle can leave Kysely and WAL helpers cached.
        stateDbCache.closeStaleCachedBranchStateDatabase(cached);
      }
      return openUnpublishedStateDatabase({
        pathname,
        env,
        busyTimeoutMs: remaining(),
        lockFailureReporting,
        existingSchema,
        initializationAgentPaths: options.initializationAgentPaths,
        ensureSchema: (database, initialization) =>
          ensureSchema(database, pathname, env, initialization, remaining()),
        recordOpenFailure: recordBranchStateDatabaseOpenFailure,
      });
    };
    unpublished = remainingColdAdmissionTimeout
      ? open(remainingColdAdmissionTimeout)
      : withStateDatabaseColdAdmission({ databasePath: pathname, busyTimeoutMs }, open);
    setSqliteBusyTimeout(unpublished.db, busyTimeoutMs);
  } catch (error) {
    if (lockFailureReporting === "report" || !isBranchStateWriteContentionError(error)) {
      stateDbCache.recordBranchStateDatabaseLifecycleOpenError(pathname, error);
    }
    if (unpublished) {
      const errors = stateDbCache.closeUnpublishedBranchStateDatabaseHandle(unpublished);
      if (errors.length > 0) {
        throw createSqliteLifecycleAggregateError(
          [error, ...errors],
          `Fresh Branch Agent state database open failed releasing access and closing its unpublished handle for ${pathname}.`,
          error,
        );
      }
    }
    throw error;
  }
  if (existingSchema) {
    recordExistingBranchStateSchemaDatabase(unpublished.db, pathname);
  }
  const database = stateDbCache.publishBranchStateDatabase(unpublished, env);
  try {
    if (!existingSchema && readSqliteUserVersion(database.db) < BRANCH_STATE_SCHEMA_VERSION) {
      deferredStateDatabases.add(database.db);
      reconcileBranchStateSchemaPublication(options);
    }
    return database;
  } catch (error) {
    // Failed publication can retain this cached handle before the caller can
    // restore its temporary busy timeout. Ordinary later writes keep their policy.
    if (database.db.isOpen) {
      setSqliteBusyTimeout(database.db, BRANCH_SQLITE_BUSY_TIMEOUT_MS);
    }
    throw error;
  }
}

/** Open or return a cached shared state database after schema and migration checks. */
export function openBranchStateDatabase(
  options: BranchStateDatabaseOptions = {},
): BranchStateDatabase {
  return openBranchStateDatabaseWithBusyTimeout(options);
}

/** The Gateway watcher also publishes without requiring a new physical database open. */
export function reconcileBranchStateSchemaPublication(
  options: BranchStateDatabaseOptions = {},
): StateSchemaPublicationBlocker | undefined {
  if (isExistingBranchStateSchema(options.database?.path ?? resolveDatabasePath(options))) {
    return undefined;
  }
  const pending = withExistingBranchStateDatabaseReadOnly(({ db }) => {
    if (
      readSqliteUserVersion(db) >= BRANCH_STATE_SCHEMA_VERSION ||
      readStateSchemaContentVersion(db) < BRANCH_STATE_SCHEMA_VERSION
    ) {
      return undefined;
    }
    return { blocker: readStateSchemaPublicationBlocker(db) };
  }, options);
  if (!pending || pending.blocker) {
    return pending?.blocker;
  }
  const pathname = resolveDatabasePath(options);
  try {
    return withStateDatabaseSchemaMaintenance({ databasePath: pathname }, () =>
      runBranchStateWriteTransaction(
        ({ db }) => {
          // The advisory read may race a new update. Re-read every driver under the write lock.
          const blocker = readStateSchemaPublicationBlocker(db);
          if (blocker) {
            return blocker;
          }
          assertBranchStateDatabaseForMaintenance(db, { pathname });
          markCurrentStateSchemaVersion(db);
          return undefined;
        },
        options,
        { operationLabel: "state.schema.publish" },
      ),
    );
  } catch (error) {
    // Current content is ready for readers; a live Gateway owns optional publication.
    if (error instanceof StateSchemaMutationConflictError) {
      return undefined;
    }
    throw error;
  }
}

/** Run one operation through the shared owner without waiting synchronously on SQLite locks. */
export function runWithBranchStateBusyTimeout<T>(
  operation: (database: BranchStateDatabase) => T,
  options: BranchStateDatabaseOptions,
  busyTimeoutMs: number,
): T {
  getBranchDatabaseMaintenanceScope()?.assertAdmission();
  const normalizedTimeoutMs = normalizeSqliteNonNegativeInteger(busyTimeoutMs, "busyTimeoutMs");
  const existing = options.database ?? getBranchStateDatabaseIfOpen(options);
  if (existing) {
    assertStateDatabaseSchemaAdmission(existing);
    return runWithSqliteBusyTimeout(
      existing.db,
      normalizedTimeoutMs,
      () => {
        observeBranchDatabaseMaintenanceResource(existing.db);
        stateDbCache.touchStateDatabase(existing);
        return operation(existing);
      },
      { lockFailureReporting: "suppress" },
    );
  }
  const opened = openBranchStateDatabaseWithBusyTimeout(options, normalizedTimeoutMs, "suppress");
  try {
    return runWithSqliteBusyTimeout(opened.db, normalizedTimeoutMs, () => operation(opened), {
      lockFailureReporting: "suppress",
    });
  } finally {
    if (opened.db.isOpen) {
      setSqliteBusyTimeout(opened.db, BRANCH_SQLITE_BUSY_TIMEOUT_MS);
    }
  }
}

/** Run a synchronous immediate transaction against the shared state database. */
export function runBranchStateWriteTransaction<T>(
  operation: (database: BranchStateDatabase) => T,
  options: BranchStateDatabaseOptions = {},
  transactionOptions: Pick<
    SqliteTransactionOptions,
    "busyTimeoutMs" | "operationLabel" | "slowTransactionHoldMs"
  > = {},
): T {
  getBranchDatabaseMaintenanceScope()?.assertAdmission();
  const existing = options.database ?? getBranchStateDatabaseIfOpen(options);
  if (existing) {
    isExistingBranchStateSchema(existing.path, existing.db);
  }
  let database = existing;
  let callbackEntered = false;
  let committed: { database: BranchStateDatabase; value: T };
  const execute = (remaining?: () => number) => {
    const acquired = options.database
      ? openBranchStateDatabase(options)
      : (database ??
        openBranchStateDatabaseWithBusyTimeout(
          options,
          BRANCH_SQLITE_BUSY_TIMEOUT_MS,
          "report",
          remaining,
        ));
    database = acquired;
    const value = runManagedStateTransaction(
      acquired.db,
      () => {
        assertStateDatabaseSchemaAdmission(acquired);
        assertBranchStateWriteAllowed({
          database: acquired.db,
          databasePath: acquired.path,
          env: options.env ?? process.env,
          schemaReady: !options.database && acquired === getBranchStateDatabaseIfOpen(options),
        });
        observeBranchDatabaseMaintenanceResource(acquired.db);
        callbackEntered = true;
        return operation(acquired);
      },
      {
        databaseLabel: acquired.path,
        ...transactionOptions,
        ...(remaining ? { busyTimeoutMs: remaining() } : {}),
        operationLabel:
          transactionOptions.operationLabel ??
          captureSqliteReaderOwner()?.operation ??
          "state.write",
      },
    );
    return { database: acquired, value };
  };
  try {
    committed = existing
      ? execute()
      : withStateDatabaseColdAdmission(
          {
            databasePath: resolveDatabasePath(options),
            busyTimeoutMs: transactionOptions.busyTimeoutMs ?? BRANCH_SQLITE_BUSY_TIMEOUT_MS,
            canRetry() {
              if (
                callbackEntered ||
                (database && (!database.db.isOpen || database.db.isTransaction))
              ) {
                return false;
              }
              if (database) {
                assertTransactionUsable(database.db);
              }
              return true;
            },
          },
          execute,
        );
  } catch (error) {
    if (database) {
      stateDbCache.evictBranchStateDatabaseAfterCorruption(database, error);
    }
    throw error;
  }
  try {
    if (!isExistingBranchStateSchema(committed.database.path, committed.database.db)) {
      ensureBranchStatePermissions(committed.database.path, options.env ?? process.env);
    }
  } catch {
    // The write already committed; permission hardening is best-effort here so
    // callers never retry an operation that is durable in SQLite.
  }
  return committed.value;
}

/**
 * Return a shared state handle this process already holds open, if any.
 *
 * Read-only callers use this to avoid opening a connection per call; it never
 * creates, repairs, or registers a handle.
 */
function getBranchStateDatabaseIfOpen(
  options: BranchStateDatabaseOptions = {},
): BranchStateDatabase | undefined {
  const pathname = resolveDatabasePath(options);
  isExistingBranchStateSchema(pathname);
  const cached = stateDbCache.getCachedBranchStateDatabase(pathname);
  if (cached?.db.isOpen) {
    isExistingBranchStateSchema(cached.path, cached.db);
  }
  return cached?.db.isOpen ? cached : undefined;
}

function assertStateDatabaseSchemaAdmission(database: BranchStateDatabase): void {
  if (isExistingBranchStateSchema(database.path, database.db)) {
    const location = database.db.location();
    if (!location) {
      throw new Error(
        "Existing shared-state schema admission requires a filesystem-backed database.",
      );
    }
    if (!isExistingBranchStateSchema(location, database.db)) {
      throw new Error(
        "Existing shared-state schema admission requires its selected physical database.",
      );
    }
    assertExistingBranchStateRuntimeSchema(database.db, database.path);
  }
}

export {
  recordBranchStateDatabaseOpenFailure,
  clearBranchStateDatabaseOpenFailure,
  closeBranchStateDatabaseByPathAsync,
  closeBranchStateDatabase,
  closeBranchStateDatabaseAsync,
  isBranchStateDatabaseOpen,
  closeBranchStateDatabaseForTest,
  confirmBranchStateDatabaseIntegrity,
} from "./branch-state-db-cache.js";
