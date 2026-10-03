import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isMainThread } from "node:worker_threads";
import { resolveStateDir } from "../config/paths.js";
import { isGatewayExternallySupervised } from "../infra/gateway-supervision.js";
import { enableNodeSqliteKyselyStatementCache } from "../infra/kysely-sync.js";
import {
  openNodeSqliteDatabase,
  supportsNodeSqliteExtensionLoading,
} from "../infra/node-sqlite.js";
import type { SqliteFileGeneration } from "../infra/sqlite-file-generation.js";
import { quarantineOrphanedSqliteSidecars } from "../infra/sqlite-files.js";
import {
  confirmSqliteFileIntegrity,
  isTerminalSqliteIntegrityError,
  type SqliteIntegrityDiagnostics,
  type SqliteIntegrityOperation,
  type SqliteIntegrityConfirmation,
} from "../infra/sqlite-integrity.js";
import { withSqlitePostCommitPublications } from "../infra/sqlite-post-commit.js";
import { admitSqliteSchema } from "../infra/sqlite-schema-facts.js";
import {
  runSqliteImmediateTransactionSync,
  type SqliteTransactionOptions,
} from "../infra/sqlite-transaction.js";
import { isSqliteSchemaVersionError } from "../infra/sqlite-user-version.js";
import { prepareSqliteDatabaseDirectory } from "../infra/sqlite-wal-filesystem.js";
import { createSqliteWalReclamationResult } from "../infra/sqlite-wal-reclamation.js";
import {
  configureSqliteConnectionPragmas,
  configureSqlitePreSchemaPragmas,
  registerSqliteCacheExitClose,
  type SqliteWalMaintenance,
} from "../infra/sqlite-wal.js";
import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { assertAgentDatabaseAdmitted } from "./agent-database-admission.js";
import {
  assertAgentDeletionCleanupAliases,
  assertAgentDeletionDatabaseCleanupAccess,
  getAgentDeletionDatabaseCleanup,
  registerAgentDeletionDatabaseCleanup,
} from "./agent-deletion-cleanup.js";
import { readAgentDeletionJournal } from "./agent-deletion-journal.js";
import { createBranchAgentDatabaseAdmissionOwner } from "./branch-agent-db-admission.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
  BranchAgentDatabaseRegistrationObserver,
} from "./branch-agent-db-contract.js";
import {
  registerBranchAgentDatabaseIdentity,
  readBranchAgentDatabaseIdentity,
} from "./branch-agent-db-identity.js";
import {
  hasAgentDatabaseMaintenanceAuthority,
  assertBranchAgentDatabaseLease,
  claimBranchAgentDatabaseLease,
  recordBranchAgentDatabaseIntegrityVerified,
  releaseBranchAgentDatabaseLease,
  type BranchAgentIntegrityVerificationReceiver,
  type prepareBranchAgentDatabaseWorkerLease,
} from "./branch-agent-db-lease.js";
import {
  agentDatabaseLifecycle as cache,
  assertAgentDatabaseTerminalOpenAllowed,
  startAgentDatabaseOpenTiming,
  resolveAgentDatabaseIntegrityGateReason,
  closeCachedBranchAgentDatabase,
  closeMaintenanceAgentDatabase,
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabaseByPathAsync,
  closeBranchAgentDatabases,
  refreshAgentDatabaseIdleTimer,
  retainAgentDatabase,
  retainIncognitoSharedState,
  retainFailedAgentDatabaseClose,
  revokePendingAgentDatabaseOpen,
  type PendingAgentDatabaseOpen,
} from "./branch-agent-db-lifecycle.js";
import { ensureBranchAgentDatabasePermissions } from "./branch-agent-db-permissions.js";
import { closeIdleBranchAgentDatabaseReadOnly } from "./branch-agent-db-readonly-scope.js";
import {
  registerBranchAgentDatabase,
  unregisterBranchAgentDatabase,
} from "./branch-agent-db-registry.js";
import {
  matchesAgentDatabaseReadCandidatePath,
  type BranchAgentDatabaseReadCandidateResource,
} from "./branch-agent-db-resources.js";
import {
  assertCanonicalAgentPersistenceVersion,
  assertExistingAgentSchemaOwner,
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./branch-agent-db-schema-helpers.js";
import {
  agentDatabaseIntegrityBeforeMutationSteps,
  ensureBranchAgentSchema,
} from "./branch-agent-db-schema.js";
import {
  clearBranchAgentDatabaseValidationCache,
  adoptBranchAgentDatabaseValidation,
  getBranchAgentDatabaseValidation,
  invalidateBranchAgentDatabaseValidation,
  setBranchAgentDatabaseValidation,
} from "./branch-agent-db-validation-cache.js";
import {
  assertIncognitoAgentDatabasePathAvailable,
  isIncognitoBranchAgentSqlitePath,
  isSameBranchAgentDatabasePath,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.paths.js";
import { registerBranchAgentWalMaintenance } from "./branch-agent-db.wal.js";
import { requestBranchAgentDatabaseQuickCheck } from "./branch-database-verify.js";
import {
  clearBranchDatabaseQuarantine,
  readBranchDatabaseQuarantineFailure,
  type BranchAgentIntegrityVerification,
} from "./branch-quarantine-store.js";
import {
  getBranchDatabaseMaintenanceScope,
  observeBranchDatabaseMaintenanceResource,
} from "./branch-state-db-async-lifecycle.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db-contract.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "./branch-state-db.js";

export {
  BRANCH_AGENT_SCHEMA_VERSION,
  type BranchAgentDatabase,
  type BranchAgentDatabaseOptions,
} from "./branch-agent-db-contract.js";
export {
  assertBranchAgentDatabaseForMaintenance,
  migrateBranchAgentDatabaseForMaintenance,
} from "./branch-agent-db-maintenance.js";
export { deferBranchAgentPostCommitPublication } from "./branch-agent-db-lifecycle.js";
export { ensureBranchAgentDatabasePermissions } from "./branch-agent-db-permissions.js";
export {
  listBranchRegisteredAgentDatabases,
  readBranchAgentDatabaseRegistryToken,
} from "./branch-agent-db-registry.js";
export { ensureBranchAgentDatabaseSchema } from "./branch-agent-db-schema.js";
export {
  isIncognitoBranchAgentSqlitePath,
  resolveIncognitoBranchAgentSqlitePath,
  resolveBranchAgentSqlitePath,
} from "./branch-agent-db.paths.js";

/** Reconfirm an advisory worker failure on the live owner connection. */
export async function confirmBranchAgentDatabaseIntegrity(
  pathname: string,
): Promise<SqliteIntegrityConfirmation> {
  const resolvedPath = path.resolve(pathname);
  await closeBranchAgentDatabaseByPathAsync(resolvedPath);
  // Closing breaks process ownership of the pathname. A replacement must
  // revalidate and claim its schema before the path can become trusted again.
  invalidateBranchAgentDatabaseValidation(resolvedPath);
  return confirmSqliteFileIntegrity(resolvedPath, resolvedPath);
}

/** Latch background verification damage so later opens fail without rescanning. */
export function recordBranchAgentDatabaseOpenFailure(
  pathname: string,
  error: Error,
  generation?: SqliteFileGeneration,
): boolean {
  const recorded = cache.terminal.record(pathname, error, generation);
  if (recorded) {
    // Quarantine revokes this process's trust because doctor may replace the file.
    invalidateBranchAgentDatabaseValidation(pathname);
  }
  return recorded;
}

/**
 * Clear a terminal open failure after doctor rewrites the database file.
 * Returns false when the persisted quarantine row survived; callers must
 * surface that, or the next open re-quarantines the repaired file.
 */
export function clearBranchAgentDatabaseOpenFailure(
  pathname: string,
  options: BranchStateDatabaseOptions = {},
): boolean {
  const resolvedPath = path.resolve(pathname);
  const cleared = clearBranchDatabaseQuarantine(resolvedPath, { env: options.env });
  cache.terminal.clear(resolvedPath);
  return cleared;
}

export type { BranchAgentDatabaseWriteAdmission } from "./branch-agent-db-admission.js";
export const {
  openBranchAgentDatabase,
  withBranchAgentDatabaseAsync,
  withBranchAgentDatabaseAdmission,
} = createBranchAgentDatabaseAdmissionOwner(openBranchAgentDatabaseSteps);

function* openBranchAgentDatabaseSteps(
  options: BranchAgentDatabaseOptions,
  pending?: PendingAgentDatabaseOpen,
  preparedLease?: ReturnType<typeof prepareBranchAgentDatabaseWorkerLease>,
  registrationObserver?: BranchAgentDatabaseRegistrationObserver,
): SqliteIntegrityOperation<BranchAgentDatabase> {
  const agentId = normalizeAgentId(options.agentId);
  assertAgentDatabaseAdmitted(agentId, { env: options.env });
  const databaseOptions = { ...options, agentId };
  const pathname = resolveBranchAgentSqlitePath(databaseOptions);
  getAgentDeletionDatabaseCleanup(databaseOptions)?.assertCurrent();
  const incognito = isIncognitoBranchAgentSqlitePath(pathname, databaseOptions);
  // A live successful cache entry is authoritative; failed entries remain only for disposal.
  const opened = getBranchAgentDatabaseIfOpen(databaseOptions);
  if (opened) {
    if (preparedLease) {
      throw new Error("A prepared Worker lease cannot adopt an existing agent database handle");
    }
    return opened;
  }
  if (!pending) {
    revokePendingAgentDatabaseOpen(pathname);
  }
  const cached = cache.databases.get(pathname);
  const allowExtension = !process.permission && supportsNodeSqliteExtensionLoading();
  if (incognito) {
    // The sentinel has no reachable durable owner, so doctor cannot safely migrate a collision.
    // Refuse operator-created state instead of silently shadowing it with volatile writes.
    assertIncognitoAgentDatabasePathAvailable(pathname);
    if (cached) {
      closeCachedBranchAgentDatabase(cached);
      cache.databases.delete(pathname);
      cache.failures.delete(pathname);
    }
    // After the collision probe, this sentinel is only a cache key: SQLite opens :memory:,
    // and no directory, lease, registry row, WAL sidecar, or file write may be created.
    const db = openNodeSqliteDatabase(":memory:", { allowExtension });
    db.enableLoadExtension(false);
    configureSqlitePreSchemaPragmas(db, {
      busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
    });
    const walMaintenance = configureSqliteConnectionPragmas(db, {
      busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
      databaseLabel: `branch-agent-incognito:${agentId}`,
      foreignKeys: true,
      synchronous: "NORMAL",
    });
    ensureBranchAgentSchema(db, agentId, pathname);
    admitSqliteSchema(db);
    registerBranchAgentDatabaseIdentity(db);
    const database = { agentId, db, path: pathname, walMaintenance };
    cache.incognito.add(database);
    cache.unregisterExitClose ??= registerSqliteCacheExitClose(closeBranchAgentDatabases);
    cache.databases.set(pathname, database);
    cache.generation += 1;
    retainIncognitoSharedState(db, options.env);
    getBranchDatabaseMaintenanceScope()?.own(database.db, "agent-handles", () =>
      closeMaintenanceAgentDatabase(database),
    );
    return database;
  }
  quarantineOrphanedSqliteSidecars(pathname);
  // Latched paths are quarantined; every fresh open fails fast here until
  // doctor repairs the file and clears the latch plus the persisted row.
  assertAgentDatabaseTerminalOpenAllowed(pathname);
  const persistedFailure = readBranchDatabaseQuarantineFailure("agent", pathname, {
    env: databaseOptions.env,
  });
  if (persistedFailure) {
    recordBranchAgentDatabaseOpenFailure(pathname, persistedFailure);
    throw persistedFailure;
  }
  if (cached) {
    // A closed handle can leave Kysely and WAL helpers cached; clear both before reopening.
    closeCachedBranchAgentDatabase(cached);
    cache.databases.delete(pathname);
    cache.failures.delete(pathname);
  }
  // Lease release must retain its original state owner after ambient env changes.
  const leaseEnvironment = {
    ...(options.env ?? process.env),
    BRANCH_STATE_DIR: resolveStateDir(options.env ?? process.env),
    ...(isGatewayExternallySupervised(options.env ?? process.env)
      ? { BRANCH_SUPERVISOR_MODE: "external" }
      : {}),
  };
  if (
    preparedLease &&
    (preparedLease.receipt.agentId !== agentId || preparedLease.receipt.path !== pathname)
  ) {
    throw new Error("Prepared agent database lease belongs to another store");
  }
  let verification: BranchAgentIntegrityVerification | undefined;
  let reuseIntegrity = false;
  let integrityRevoked = false;
  const validation = pending?.validation ?? preparedLease?.validation;
  const captureVerification: BranchAgentIntegrityVerificationReceiver = (
    record,
    runtimeIntegrityAllowed,
    invalidated,
  ) => {
    verification = record;
    reuseIntegrity = runtimeIntegrityAllowed;
    integrityRevoked = invalidated;
    if (invalidated && validation) {
      // Stale-peer cleanup precedes adoption of proof already transferred by the host.
      Atomics.store(new Int32Array(validation.valid), 0, 0);
    }
  };
  const releaseOptions = { env: leaseEnvironment, initializationAgentPaths: [pathname] };
  const leaseId = preparedLease
    ? preparedLease.claim(captureVerification)
    : claimBranchAgentDatabaseLease(
        { agentId, path: pathname, env: leaseEnvironment },
        undefined,
        captureVerification,
      );
  if (pending) {
    pending.assertHeld = () =>
      assertBranchAgentDatabaseLease(leaseId, {
        agentId,
        path: pathname,
        env: leaseEnvironment,
      });
  }
  const diagnostics: SqliteIntegrityDiagnostics = {};
  const finishPhase = startAgentDatabaseOpenTiming(
    agentId,
    pathname,
    pending ? "async" : "sync",
    diagnostics,
  );
  let openedDb: DatabaseSync | undefined;
  let openedDatabase: BranchAgentDatabase | undefined;
  let openedWalMaintenance: SqliteWalMaintenance | undefined;
  try {
    ensureBranchAgentDatabasePermissions(pathname, databaseOptions);
    prepareSqliteDatabaseDirectory(pathname);
    closeIdleBranchAgentDatabaseReadOnly(pathname);
    // Ordinary agent state also works with SQLite builds that omit extensions.
    // Trusted borrowers may enable them only when both the runtime and permissions allow it.
    const db = openNodeSqliteDatabase(pathname, { allowExtension });
    db.enableLoadExtension(false);
    enableNodeSqliteKyselyStatementCache(db);
    openedDb = db;
    if (preparedLease) {
      // Worker TEMP policy precedes schema/session caches and any exposed connection.
      db.exec("PRAGMA temp_store = FILE");
    }
    registerBranchAgentDatabaseIdentity(db);
    finishPhase("open");
    // Eviction churn must avoid migration/convergence and registry busy waits.
    // Version and owner can change while evicted, so their read-only gates run on every open.
    const validationDatabase = { db, path: pathname, agentId };
    if (validation) {
      adoptBranchAgentDatabaseValidation(validationDatabase, validation);
    }
    let isValidatedReopen = Boolean(getBranchAgentDatabaseValidation(validationDatabase));
    let walMaintenance: SqliteWalMaintenance;
    try {
      db.exec(`PRAGMA busy_timeout = ${BRANCH_SQLITE_BUSY_TIMEOUT_MS};`);
      assertSupportedAgentSchemaVersion(db, pathname);
      const existingSchema = readExistingAgentSchemaMeta(db);
      assertExistingAgentSchemaOwner(existingSchema, agentId, pathname);
      // Runtime proof survives last-lease close; cold opens require clean-close proof.
      // Runtime proof carries owner revocation; every open still checks schema convergence.
      diagnostics.integrityGateReason = resolveAgentDatabaseIntegrityGateReason(
        validationDatabase,
        { verification, validation, integrityRevoked, reuseIntegrity },
      );
      const requiresCurrentVersionConvergence = yield* agentDatabaseIntegrityBeforeMutationSteps(
        db,
        agentId,
        pathname,
        diagnostics,
        verification,
        isValidatedReopen && reuseIntegrity,
        true,
      );
      if (!diagnostics.integrityGateOutcome || diagnostics.integrityGateOutcome === "cached") {
        delete diagnostics.integrityGateReason;
      }
      if (isValidatedReopen && (!existingSchema || requiresCurrentVersionConvergence)) {
        // New files and same-version divergence cannot inherit an earlier validation.
        // The existing full path initializes or converges them before exposure.
        invalidateBranchAgentDatabaseValidation(pathname);
        isValidatedReopen = false;
      }
      assertCanonicalAgentPersistenceVersion(db, pathname);
      finishPhase("validation");
      configureSqlitePreSchemaPragmas(db, {
        busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
      });
      walMaintenance = configureSqliteConnectionPragmas(db, {
        busyTimeoutMs: BRANCH_SQLITE_BUSY_TIMEOUT_MS,
        databaseLabel: `branch-agent:${agentId}`,
        databasePath: pathname,
        foreignKeys: true,
        synchronous: "NORMAL",
      });
      openedWalMaintenance = walMaintenance;
      finishPhase("configuration");
      if (!isValidatedReopen) {
        ensureBranchAgentSchema(db, agentId, pathname);
      }
      finishPhase("schema");
    } catch (err) {
      if (diagnostics.integrityGateOutcome === "failed") {
        finishPhase("validation");
      }
      openedWalMaintenance?.close();
      if (db.isOpen) {
        db.close();
      }
      const current = cache.databases.get(pathname);
      if (!current || current.db === db) {
        invalidateBranchAgentDatabaseValidation(pathname);
      }
      if (
        err instanceof Error &&
        (isSqliteSchemaVersionError(err) || isTerminalSqliteIntegrityError(err))
      ) {
        recordBranchAgentDatabaseOpenFailure(pathname, err);
      }
      throw err;
    }
    ensureBranchAgentDatabasePermissions(pathname, databaseOptions);
    admitSqliteSchema(db);
    const database = { agentId, db, path: pathname, walMaintenance };
    openedDatabase = database;
    if (hasAgentDatabaseMaintenanceAuthority()) {
      throw new Error(
        "Agent database maintenance is in progress; retry after branch doctor --fix completes.",
      );
    }
    const cleanup = registerAgentDeletionDatabaseCleanup(database, databaseOptions);
    if (cleanup) {
      const release = retainAgentDatabase(db);
      cleanup.registerClose(async () => {
        // The scope owns this connection, not a later cache entry at the same pathname.
        if (cache.databases.get(database.path) === database) {
          await closeBranchAgentDatabaseByPathAsync(database.path, database.agentId);
        } else if (database.db.isOpen) {
          throw new Error("Agent deletion cleanup lost its database close owner.");
        }
        release();
      });
    }
    if (!isValidatedReopen) {
      registerBranchAgentDatabase(
        { agentId, path: pathname, env: options.env },
        registrationObserver,
      );
      setBranchAgentDatabaseValidation(database);
    }
    cache.terminal.clear(pathname);
    // Safety net for processes that end without an orderly close: agent DBs have
    // no shutdown owner like the ACP/gateway state DB closes. Closing unregisters.
    cache.unregisterExitClose ??= registerSqliteCacheExitClose(closeBranchAgentDatabases);
    finishPhase("registration");
    cache.leases.set(pathname, { leaseId, env: leaseEnvironment });
    cache.databases.set(pathname, database);
    const identity = readBranchAgentDatabaseIdentity(database).identity;
    if (diagnostics.integrityGateOutcome === "cached" && !(isValidatedReopen && reuseIntegrity)) {
      if (preparedLease) {
        requestSqliteWorkerOperationAdmission({
          stage: "prepare",
          facts: {
            kind: "agent-integrity-cached",
            lease: preparedLease.receipt,
          },
        });
      } else {
        requestBranchAgentDatabaseQuickCheck({ path: pathname, env: leaseEnvironment });
      }
    } else if (diagnostics.integrityGateOutcome !== "cached" && typeof identity === "string") {
      recordBranchAgentDatabaseIntegrityVerified(
        leaseId,
        { agentId, path: pathname, env: leaseEnvironment },
        identity,
      );
    }
    refreshAgentDatabaseIdleTimer(database);
    if (isMainThread) {
      registerBranchAgentWalMaintenance(database, leaseEnvironment);
    }
    getBranchDatabaseMaintenanceScope()?.own(database.db, "agent-handles", () =>
      closeMaintenanceAgentDatabase(database),
    );
    return database;
  } catch (error) {
    let closeError: unknown;
    if (openedDatabase) {
      try {
        closeCachedBranchAgentDatabase(openedDatabase);
      } catch (caught) {
        closeError = caught;
      }
    }
    if (openedDb?.isOpen) {
      if (
        pending &&
        cache.databases.has(pathname) &&
        cache.databases.get(pathname)?.db !== openedDb
      ) {
        // A synchronous opener may supersede pending work. Retain failed cleanup
        // with its original native owner; never overwrite the replacement cache/lease.
        const retainedDb = openedDb;
        retainFailedAgentDatabaseClose(agentId, pathname, () => {
          openedWalMaintenance?.close();
          if (retainedDb.isOpen) {
            retainedDb.close();
          }
          releaseBranchAgentDatabaseLease(leaseId, releaseOptions);
        });
        throw error;
      }
      invalidateBranchAgentDatabaseValidation(pathname);
      const retainedDatabase =
        openedDatabase ??
        ({
          agentId,
          db: openedDb,
          path: pathname,
          walMaintenance: openedWalMaintenance ?? {
            checkpoint: () => false,
            reclaimFreePages: createSqliteWalReclamationResult,
            close: () => false,
          },
        } satisfies BranchAgentDatabase);
      // Failed opens remain disposal-owned but cannot become successful cache hits.
      cache.databases.set(pathname, retainedDatabase);
      refreshAgentDatabaseIdleTimer(retainedDatabase);
      cache.leases.set(pathname, { leaseId, env: leaseEnvironment });
      cache.failures.set(pathname, closeError ?? error);
      getBranchDatabaseMaintenanceScope()?.own(retainedDatabase.db, "agent-handles", () =>
        closeMaintenanceAgentDatabase(retainedDatabase),
      );
      cache.unregisterExitClose ??= registerSqliteCacheExitClose(closeBranchAgentDatabases);
    } else {
      try {
        releaseBranchAgentDatabaseLease(leaseId, releaseOptions);
      } catch (releaseError) {
        retainFailedAgentDatabaseClose(agentId, pathname, () =>
          releaseBranchAgentDatabaseLease(leaseId, releaseOptions),
        );
        throw releaseError;
      }
    }
    throw closeError ?? error;
  }
}

export function runBranchAgentWriteTransaction<T>(
  operation: (database: BranchAgentDatabase) => T,
  options: BranchAgentDatabaseOptions,
  transactionOptions: Pick<
    SqliteTransactionOptions,
    "busyTimeoutMs" | "operationLabel" | "slowTransactionHoldMs"
  > = {},
): T {
  const database = openBranchAgentDatabase(options);
  const enteredNestedTransaction = database.db.isTransaction;
  return withSqlitePostCommitPublications(database.db, () =>
    runSqliteImmediateTransactionSync(
      database.db,
      () => {
        assertAgentDeletionDatabaseCleanupAccess(database, options);
        const operationResult = operation(database);
        if (!enteredNestedTransaction && !cache.incognito.has(database)) {
          // Permission failure must roll back with the write. Repairing after
          // COMMIT could make callers retry a transaction already durable in SQLite.
          ensureBranchAgentDatabasePermissions(database.path, options);
        }
        return operationResult;
      },
      {
        busyTimeoutMs: transactionOptions.busyTimeoutMs ?? BRANCH_SQLITE_BUSY_TIMEOUT_MS,
        databaseLabel: database.path,
        ...transactionOptions,
        operationLabel: transactionOptions.operationLabel ?? "agent.write",
        withCommit: getAgentDeletionDatabaseCleanup(options)?.withCommit,
      },
    ),
  );
}

/** Retain the exact verified connection across awaits; explicit disposal still revokes it. */
export function borrowBranchAgentDatabase(options: BranchAgentDatabaseOptions): {
  db: DatabaseSync;
  release: () => void;
} {
  const { db } = openBranchAgentDatabase(options);
  return { db, release: retainAgentDatabase(db) };
}

/** Return whether the exact cached agent database pathname is still open. */
export function isBranchAgentDatabaseOpen(pathname: string): boolean {
  return cache.databases.get(path.resolve(pathname))?.db.isOpen === true;
}

/** Return the matching live cache entry without materializing a database. */
export function getBranchAgentDatabaseIfOpen(
  options: BranchAgentDatabaseOptions,
): BranchAgentDatabase | undefined {
  const agentId = normalizeAgentId(options.agentId);
  assertAgentDatabaseAdmitted(agentId, { env: options.env });
  const pathname = resolveBranchAgentSqlitePath({ ...options, agentId });
  // Incognito skips durable database leases, but still follows the agent deletion fence.
  if (
    isIncognitoBranchAgentSqlitePath(pathname, options) &&
    readAgentDeletionJournal(agentId, { env: options.env }, "runtime")
  ) {
    throw new Error(`Branch Agent agent database is unavailable while agent ${agentId} is deleted.`);
  }
  const database = cache.databases.get(pathname);
  if (!database?.db.isOpen) {
    assertAgentDeletionCleanupAliases(options, isSameBranchAgentDatabasePath);
    return undefined;
  }
  if (cache.failures.has(pathname)) {
    throw cache.failures.get(pathname);
  }
  if (database.agentId !== agentId) {
    throw new Error(
      `Branch Agent agent database ${pathname} is already open for agent ${database.agentId}; requested agent ${agentId}.`,
    );
  }
  assertAgentDeletionDatabaseCleanupAccess(database, options);
  observeBranchDatabaseMaintenanceResource(database.db);
  refreshAgentDatabaseIdleTimer(database);
  return database;
}

/** Pin only admitted native readers already present in captured discovery families. */
export function retainBranchAgentDatabaseReadCandidates(
  candidates: readonly Pick<BranchAgentDatabaseReadCandidateResource, "path" | "scope">[],
  env: NodeJS.ProcessEnv,
): { databases: readonly BranchAgentDatabase[]; release: () => void } {
  const retained: Array<{ database: BranchAgentDatabase; release: () => void }> = [];
  const release = () => {
    for (const reader of retained.toReversed()) {
      reader.release();
    }
  };
  try {
    for (const database of cache.databases.values()) {
      if (
        !database.db.isOpen ||
        database.db.isTransaction ||
        cache.incognito.has(database) ||
        !candidates.some((candidate) =>
          matchesAgentDatabaseReadCandidatePath(candidate, database.path),
        )
      ) {
        continue;
      }
      let admitted: BranchAgentDatabase | undefined;
      try {
        admitted = getBranchAgentDatabaseIfOpen({
          agentId: database.agentId,
          path: database.path,
          env,
        });
      } catch {
        // A refused cached writer cannot supply a read continuation. Fresh reads
        // retain the existing independent read-only schema and ownership checks.
        continue;
      }
      if (admitted === database) {
        retained.push({ database, release: retainAgentDatabase(database.db) });
      }
    }
    return { databases: retained.map(({ database }) => database), release };
  } catch (error) {
    release();
    throw error;
  }
}

/** Close and unregister one unambiguous transient agent database by filesystem identity. */
export function disposeBranchAgentDatabaseByPath(
  pathname: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): boolean {
  const resolvedPath = path.resolve(pathname);
  for (const pendingPath of cache.pending.keys()) {
    if (isSameBranchAgentDatabasePath(pendingPath, resolvedPath)) {
      revokePendingAgentDatabaseOpen(pendingPath);
    }
  }
  for (const retained of cache.retainedCloses) {
    if (isSameBranchAgentDatabasePath(retained.path, resolvedPath)) {
      retained.close();
    }
  }
  // Disposal can be followed by file deletion or recreation, so revalidate next open.
  invalidateBranchAgentDatabaseValidation(resolvedPath);
  const matchingDatabases = [...cache.databases.values()].filter((candidate) =>
    isSameBranchAgentDatabasePath(candidate.path, resolvedPath),
  );
  if (matchingDatabases.length > 1) {
    return false;
  }
  const database = matchingDatabases[0];
  if (database && cache.incognito.has(database)) {
    return closeBranchAgentDatabaseByPath(database.path);
  }
  if (!database) {
    return false;
  }
  try {
    unregisterBranchAgentDatabase({
      agentId: database.agentId,
      path: database.path,
      ...(options.env ? { env: options.env } : {}),
    });
  } finally {
    // Secret-bearing transient DBs must close even when registry maintenance
    // fails; Windows otherwise cannot remove the file during caller cleanup.
    closeBranchAgentDatabaseByPath(database.path);
  }
  return true;
}

export { withAgentDatabaseMaintenanceLease } from "./branch-agent-db-maintenance-lease.js";

/** Release fixture handles and pathname trust before a test root is recreated. */
export function closeBranchAgentDatabasesForTest(rootPath?: string): void {
  closeBranchAgentDatabases(rootPath);
  clearBranchAgentDatabaseValidationCache(rootPath);
  cache.terminal.clearAll(rootPath);
}

export {
  closeBranchAgentDatabaseByPath,
  closeBranchAgentDatabaseByPathAsync,
  closeBranchAgentDatabases,
  closeBranchAgentDatabasesAsync,
  inspectBranchAgentDatabaseOwner,
  isIncognitoBranchAgentDatabase,
  listOpenIncognitoAgentDatabases,
  readOpenIncognitoAgentDatabaseGeneration,
  settleBranchAgentDatabaseWorkerClose,
  type BranchAgentDatabaseWorkerCloseResult,
} from "./branch-agent-db-lifecycle.js";
