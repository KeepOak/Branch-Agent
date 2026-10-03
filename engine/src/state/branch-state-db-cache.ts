import { existsSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  assertStateDatabaseAccessAllowed,
  assertStateDatabaseReadAllowed,
} from "../infra/gateway-state-owner.js";
import {
  clearNodeSqliteKyselyCacheForDatabase,
  registerNodeSqliteKyselyQueryErrorHandler,
} from "../infra/kysely-sync-cache-state.js";
import { openNodeSqliteDatabase, resolveExistingSqliteFileUri } from "../infra/node-sqlite.js";
import {
  isSqliteCorruptionError,
  isSqliteLockError,
  sqlitePrimaryResultCode,
} from "../infra/sqlite-error-diagnostics.js";
import type { SqliteFileGeneration } from "../infra/sqlite-file-generation.js";
import {
  confirmSqliteFileIntegrity,
  type SqliteIntegrityConfirmation,
} from "../infra/sqlite-integrity.js";
import {
  createSqliteLifecycleAggregateError,
  throwSqliteLifecycleErrors,
} from "../infra/sqlite-lifecycle-errors.js";
import {
  admitSqliteSchema,
  getAdmittedSqliteSchemaFacts,
  runSqliteReadOperationSync,
} from "../infra/sqlite-schema-facts.js";
import { createSqliteTerminalOpenLatch } from "../infra/sqlite-terminal-open-latch.js";
import { cancelSqliteWalWriteAdmission } from "../infra/sqlite-wal-write-admission.js";
import { registerSqliteCacheExitClose } from "../infra/sqlite-wal.js";
import type { DatabasePathIdentity } from "../infra/sqlite-worker-identity.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { BranchQuarantineReadCleanupError } from "./branch-quarantine-error.js";
import { readBranchDatabaseQuarantineFailure } from "./branch-quarantine-store.js";
import {
  createBranchStateDatabaseAsyncLifecycle,
  getBranchDatabaseMaintenanceScope,
  isBranchDatabaseMaintenanceResourceOwned,
  observeBranchDatabaseMaintenanceResource,
  type BranchDatabaseMaintenanceScope,
  type BranchStateDatabaseAsyncResource,
  type BranchStateDatabaseReadAdmission,
} from "./branch-state-db-async-lifecycle.js";
import {
  assertStateDatabaseBorrowersReleased,
  createStateDatabaseRetainer,
  type StateDatabaseBorrowers,
} from "./branch-state-db-borrow.js";
import { createStateDatabaseIdleRetirement } from "./branch-state-db-cache.idle.js";
import type {
  CachedBranchStateDatabase,
  StateDatabaseLifecycle,
} from "./branch-state-db-cache.types.js";
import { createStateDatabaseWalOwner } from "./branch-state-db-cache.wal.js";
import type {
  BranchStateDatabase,
  BranchStateDatabaseCloseOptions,
  BranchStateDatabaseLifecycleEvent,
  StateDatabaseHandle,
} from "./branch-state-db-contract.js";
import { closeTrackedStateDatabase } from "./branch-state-db-handle.js";
import { createBranchStateDatabaseRuntimeFailureOwner } from "./branch-state-db-runtime-failure.js";
import { assertExistingBranchStateSchemaCacheAdmission } from "./branch-state-db-schema-policy.js";
import { assertSupportedStateSchemaVersion } from "./branch-state-db-schema-version.js";
import { branchStateSnapshotOwners } from "./branch-state-db-snapshot-owner.js";
import type { BranchStateWorkerContext } from "./branch-state-worker-context.types.js";

const stateDatabaseLifecycle = resolveGlobalSingleton<StateDatabaseLifecycle>(
  Symbol.for("branch.stateDatabaseLifecycle"),
  () => ({
    cachedDatabases: new Map<string, CachedBranchStateDatabase>(),
    retainedDatabaseHandles: new Map<DatabaseSync, StateDatabaseHandle>(),
    idleTimers: new WeakMap(),
    idleReferences: new WeakMap(),
    unregisterRetainedExitClose: undefined,
    databaseIdentities: new WeakMap<DatabaseSync, DatabasePathIdentity>(),
    borrowers: new WeakMap<DatabaseSync, StateDatabaseBorrowers>(),
    databaseLifecycleListeners: new Set<(event: BranchStateDatabaseLifecycleEvent) => void>(),
    terminalOpenLatch: createSqliteTerminalOpenLatch({
      closeByPath: (pathname, error) => runtimeFailures.closeTerminalFailure(pathname, error),
    }),
    asyncResources: createBranchStateDatabaseAsyncLifecycle(),
  }),
  () => closeBranchStateDatabaseAsync(),
);
const {
  cachedDatabases,
  retainedDatabaseHandles,
  idleTimers,
  idleReferences,
  databaseIdentities,
  borrowers,
  databaseLifecycleListeners,
  terminalOpenLatch,
  asyncResources,
} = stateDatabaseLifecycle;

const { touch: touchStateDatabase, retain: retainBranchStateDatabaseForIdle } =
  createStateDatabaseIdleRetirement(stateDatabaseLifecycle, retireBranchStateDatabaseHandle);
const { register: registerStateDatabaseWalAdmission, readHealth: readBranchStateWalHealth } =
  createStateDatabaseWalOwner(stateDatabaseLifecycle, retainBranchStateDatabaseForIdle);
export { readBranchStateWalHealth, retainBranchStateDatabaseForIdle };

function notifyBranchStateDatabaseLifecycle(event: BranchStateDatabaseLifecycleEvent): void {
  const notification =
    event.kind === "open-error"
      ? { ...event, identity: event.identity ?? asyncResources.knownIdentity(event.path) }
      : event;
  for (const listener of databaseLifecycleListeners) {
    listener(notification);
  }
}

function notifyBranchStateDatabaseClosed(database: StateDatabaseHandle): void {
  notifyBranchStateDatabaseLifecycle({
    kind: "closed",
    path: database.path,
    identity: requireBranchStateDatabaseIdentity(database),
  });
}

export function requireBranchStateDatabaseIdentity(
  database: Pick<StateDatabaseHandle, "db">,
): DatabasePathIdentity {
  const identity = databaseIdentities.get(database.db);
  if (!identity) {
    throw new Error("Published shared-state owner has no recorded database identity");
  }
  return identity;
}

const runtimeFailures = createBranchStateDatabaseRuntimeFailureOwner({
  cachedDatabases,
  latch: terminalOpenLatch,
  evict: evictCachedBranchStateDatabase,
  invalidate: (pathname) => asyncResources.invalidate(pathname),
  notifyTerminalFailure: (pathname, error) =>
    notifyBranchStateDatabaseLifecycle({
      kind: "terminal-failure",
      path: pathname,
      error,
      identity: asyncResources.knownIdentity(pathname),
    }),
  recordSchemaFailure: (pathname, error) => {
    terminalOpenLatch.record(pathname, error);
    notifyBranchStateDatabaseLifecycle({ kind: "open-error", path: pathname, error });
  },
});

export function registerBranchStateDatabaseLifecycleListener(
  listener: (event: BranchStateDatabaseLifecycleEvent) => void,
): () => void {
  databaseLifecycleListeners.add(listener);
  for (const database of cachedDatabases.values()) {
    if (database.db.isOpen) {
      listener({
        kind: "opened",
        database,
        identity: requireBranchStateDatabaseIdentity(database),
      });
    }
  }
  return () => databaseLifecycleListeners.delete(listener);
}

function retainStateDatabaseClose(database: StateDatabaseHandle): void {
  retainedDatabaseHandles.set(database.db, database);
  stateDatabaseLifecycle.unregisterRetainedExitClose ??= registerSqliteCacheExitClose(
    closeBranchStateDatabase,
  );
}

function ownMaintenanceStateDatabaseHandle(database: StateDatabaseHandle): void {
  getBranchDatabaseMaintenanceScope()?.own(database.db, "shared-handles", async () => {
    const closingScope = getBranchDatabaseMaintenanceScope();
    if (!closingScope || !isBranchDatabaseMaintenanceResourceOwned(database.db, closingScope)) {
      return;
    }
    if (
      cachedDatabases.get(database.path) === database ||
      retainedDatabaseHandles.get(database.db) === database
    ) {
      await cancelSqliteWalWriteAdmission(database.db);
      if (
        isBranchDatabaseMaintenanceResourceOwned(database.db, closingScope) &&
        (cachedDatabases.get(database.path) === database ||
          retainedDatabaseHandles.get(database.db) === database)
      ) {
        retireBranchStateDatabaseHandle(database, false);
      }
    }
  });
}

function closeUnpublishedBranchStateDatabaseHandle(database: StateDatabaseHandle): unknown[] {
  const errors = closeBranchStateDatabaseHandle(database);
  if (retainedDatabaseHandles.get(database.db) === database) {
    ownMaintenanceStateDatabaseHandle(database);
  }
  return errors;
}

/** Retain one exact canonical native owner; only the final reference retires its handle. */
export const {
  retain: retainBranchStateDatabase,
  borrowForRead: borrowBranchStateDatabaseForAsyncRead,
  retainForIndependentRead: retainBranchStateDatabaseForIndependentRead,
} = createStateDatabaseRetainer(stateDatabaseLifecycle, {
  assertOpen(pathname, ownership) {
    assertBranchStateDatabaseOpenAllowed(pathname, ownership);
    assertExistingBranchStateSchemaCacheAdmission(pathname, stateDatabaseLifecycle);
  },
  capture: (pathname) => asyncResources.capture(pathname),
  retire: retireBranchStateDatabaseHandle,
  retainFailed: retainStateDatabaseClose,
  touch: touchStateDatabase,
});

/** Close both physical-handle owners while retaining every cleanup failure. */
function closeBranchStateDatabaseHandle(
  database: StateDatabaseHandle,
  options?: Parameters<BranchStateDatabase["walMaintenance"]["close"]>[0],
): unknown[] {
  clearTimeout(idleTimers.get(database.db));
  idleTimers.delete(database.db);
  try {
    assertStateDatabaseBorrowersReleased(borrowers.get(database.db), database.path);
  } catch (error) {
    const owner = borrowers.get(database.db);
    if (owner) {
      owner.retiring = true;
      // Deferred native cleanup keeps this exact request, not the last read pin's scope.
      owner.retirement = {
        ordinary: true,
        isCurrent: () => true,
        retire: () => {
          throwSqliteLifecycleErrors(
            closeBranchStateDatabaseHandle(database, options),
            `Branch Agent state database cleanup failed for ${database.path}.`,
          );
          owner.cleanupComplete = true;
          borrowers.delete(database.db);
        },
      };
    }
    retainStateDatabaseClose(database);
    return [error];
  }
  idleReferences.delete(database.db);
  const errors: unknown[] = [];
  branchStateSnapshotOwners.release(database.db);
  try {
    void cancelSqliteWalWriteAdmission(database.db);
    database.walMaintenance?.close(options);
  } catch (error) {
    errors.push(error);
  }
  try {
    clearNodeSqliteKyselyCacheForDatabase(database.db);
  } catch (error) {
    errors.push(error);
  }
  try {
    closeTrackedStateDatabase(database.db);
  } catch (error) {
    errors.push(error);
  }
  let cleanupPending = false;
  if (!database.db.isOpen) {
    try {
      database.afterClose?.();
    } catch (error) {
      errors.push(error);
      cleanupPending = true;
    }
  }
  if (database.db.isOpen || cleanupPending) {
    retainStateDatabaseClose(database);
  } else {
    retainedDatabaseHandles.delete(database.db);
  }
  // A failed native close retains physical custody, never a successful cache hit.
  if (cachedDatabases.get(database.path)?.db === database.db) {
    cachedDatabases.delete(database.path);
  }
  if (retainedDatabaseHandles.size === 0) {
    stateDatabaseLifecycle.unregisterRetainedExitClose?.();
    stateDatabaseLifecycle.unregisterRetainedExitClose = undefined;
  }
  return errors;
}

function evictCachedBranchStateDatabase(database: BranchStateDatabase): boolean {
  if (cachedDatabases.get(database.path) !== database) {
    return false;
  }
  // Remove ownership before cleanup. A poisoned native handle can reject close,
  // but it must never remain discoverable as the process-wide shared handle.
  asyncResources.invalidate(database.path);
  cachedDatabases.delete(database.path);
  notifyBranchStateDatabaseClosed(database);
  // A poisoned cache owner is not the database lifecycle owner. PASSIVE avoids
  // waiting on readers or resetting recovery frames another connection needs.
  closeBranchStateDatabaseHandle(database, { checkpointMode: "PASSIVE" });
  return true;
}

/** Evict an exact cached shared-state owner after a proven corruption read. */
function evictBranchStateDatabaseAfterCorruption(
  database: BranchStateDatabase,
  error: unknown,
): boolean {
  return isSqliteCorruptionError(error) && evictCachedBranchStateDatabase(database);
}

/** Publish a fully opened handle and bind query corruption to its exact cache owner. */
function publishBranchStateDatabase(
  database: BranchStateDatabase,
  env: NodeJS.ProcessEnv,
): BranchStateDatabase {
  const { db, path: pathname } = database;
  admitSqliteSchema(db);
  const schemaFacts = runSqliteReadOperationSync(db, () => {
    assertSupportedStateSchemaVersion(db, pathname);
    return getAdmittedSqliteSchemaFacts(db);
  });
  const { identity, admission } = asyncResources.publish(pathname);
  databaseIdentities.set(db, identity);
  cachedDatabases.set(pathname, Object.assign(database, { schemaFacts }));
  registerStateDatabaseWalAdmission(database, identity, admission, env);
  touchStateDatabase(database);
  branchStateSnapshotOwners.register(database, () => cachedDatabases.get(pathname));
  ownMaintenanceStateDatabaseHandle(database);
  notifyBranchStateDatabaseLifecycle({ kind: "opened", database, identity });
  registerNodeSqliteKyselyQueryErrorHandler(db, (error) => {
    // Write transactions own rollback and evict at their outer boundary.
    if (!db.isTransaction && isSqliteCorruptionError(error)) {
      evictCachedBranchStateDatabase(database);
    }
  });
  terminalOpenLatch.clear(pathname);
  return database;
}

function getCachedBranchStateDatabase(
  pathname: string,
  options?: { readOnly: true },
): BranchStateDatabase | undefined {
  const maintenance = getBranchDatabaseMaintenanceScope();
  if (options?.readOnly) {
    maintenance?.assertReadAdmission();
  } else {
    maintenance?.assertAdmission();
  }
  assertExistingBranchStateSchemaCacheAdmission(pathname, stateDatabaseLifecycle);
  const runtimeFailure = runtimeFailures.get(pathname);
  if (runtimeFailure) {
    throw runtimeFailure;
  }
  const database = cachedDatabases.get(path.resolve(pathname));
  if (database && borrowers.get(database.db)?.retiring) {
    throw new Error(`Branch Agent state database native borrower cleanup is pending: ${pathname}`);
  }
  if (database) {
    touchStateDatabase(database);
  }
  return database;
}

function getBranchStateDatabaseIfOpenAtPath(pathname: string): BranchStateDatabase | undefined {
  const cached = getCachedBranchStateDatabase(pathname);
  observeBranchDatabaseMaintenanceResource(cached?.db.isOpen ? cached.db : undefined);
  return cached?.db.isOpen ? cached : undefined;
}

/** Remove a closed cached owner while fresh-open access is held. */
function closeStaleCachedBranchStateDatabase(database: BranchStateDatabase): void {
  if (cachedDatabases.get(database.path) !== database) {
    return;
  }
  asyncResources.invalidate(database.path);
  const errors = closeBranchStateDatabaseHandle(database);
  notifyBranchStateDatabaseClosed(database);
  throwSqliteLifecycleErrors(
    errors,
    `Stale Branch Agent state database cleanup failed for ${database.path}.`,
  );
}

/** Latch background verification damage so later opens fail without rescanning. */
export function recordBranchStateDatabaseOpenFailure(
  pathname: string,
  error: Error,
  generation?: SqliteFileGeneration,
): boolean {
  return terminalOpenLatch.record(pathname, error, generation);
}

/** Clear a terminal open failure after doctor rewrites the database file. */
export function clearBranchStateDatabaseOpenFailure(pathname: string): void {
  const resolvedPath = path.resolve(pathname);
  terminalOpenLatch.clear(resolvedPath);
  asyncResources.invalidate(resolvedPath);
  notifyBranchStateDatabaseLifecycle({
    kind: "failure-cleared",
    path: resolvedPath,
    identity: asyncResources.knownIdentity(resolvedPath),
  });
}

/** Validate the canonical terminal fact before acquiring a domain-operation lease. */
export async function getBranchStateDatabaseTerminalFailureAsync(
  context: BranchStateWorkerContext,
): Promise<Error | undefined> {
  context.admission.assertCurrent();
  const failure = await terminalOpenLatch.getAsync(
    context.admission.databasePath,
    async (_path, generation) => {
      const { inspectBranchStateDatabase } = await import("./branch-state-worker-store.js");
      const matches = await inspectBranchStateDatabase(context, {
        type: "database.generationMatches",
        input: { generation },
      });
      if (matches === undefined) {
        throw new Error("Recorded shared-state database generation is unavailable");
      }
      return matches;
    },
  );
  context.admission.assertCurrent();
  return failure;
}

/** Reject shared-state access after a process-local terminal failure. */
function assertBranchStateDatabaseOpenAllowed(pathname: string, ownership?: "cached-read"): void {
  if (ownership === "cached-read") {
    assertStateDatabaseReadAllowed(pathname);
  } else {
    assertStateDatabaseAccessAllowed(pathname);
  }
  const { identity } = asyncResources.capture(pathname);
  const terminalFailure = terminalOpenLatch.get(pathname);
  if (terminalFailure) {
    throw terminalFailure;
  }
  const resolvedPath = path.resolve(pathname);
  for (const database of retainedDatabaseHandles.values()) {
    if (
      borrowers.get(database.db)?.retiring &&
      (database.path === resolvedPath || databaseIdentities.get(database.db)?.key === identity.key)
    ) {
      throw new Error(`Branch Agent state database native borrower cleanup is pending: ${pathname}`);
    }
  }
}

function recordBranchStateDatabaseLifecycleOpenError(pathname: string, error: unknown): void {
  notifyBranchStateDatabaseLifecycle({ kind: "open-error", path: path.resolve(pathname), error });
}

/** Reject a fresh shared-state open after known corruption until repair clears it. */
function assertBranchStateDatabaseFreshOpenAllowedAtPath(
  pathname: string,
  env: NodeJS.ProcessEnv,
  onNativeCleanupFailure?: (error: BranchQuarantineReadCleanupError) => void,
): void {
  assertBranchStateDatabaseOpenAllowed(pathname);
  let quarantineFailure: Error | undefined;
  try {
    quarantineFailure = readBranchDatabaseQuarantineFailure("state", pathname, { env });
  } catch (error) {
    if (!(error instanceof BranchQuarantineReadCleanupError)) {
      throw error;
    }
    onNativeCleanupFailure?.(error);
    return;
  }
  if (quarantineFailure?.cause instanceof BranchQuarantineReadCleanupError) {
    onNativeCleanupFailure?.(quarantineFailure.cause);
  }
  if (quarantineFailure) {
    // Another process can record quarantine. Revoke admitted owners without a
    // process-local latch that could outlive the durable decision's generation.
    runtimeFailures.closeTerminalFailure(pathname, quarantineFailure);
    throw quarantineFailure;
  }
}

/** SQLite owns checkpoint exclusion; retirement joins the actual native handle. */
function retireBranchStateDatabaseHandle(
  database: StateDatabaseHandle,
  retireAdmission = true,
  options?: BranchStateDatabaseCloseOptions,
): void {
  // Retained native custody permits disposal after the caller loses admission.
  assertStateDatabaseBorrowersReleased(borrowers.get(database.db), database.path);
  const borrowedOwner = borrowers.get(database.db);
  try {
    const wasCached = cachedDatabases.get(database.path)?.db === database.db;
    if (retireAdmission) {
      asyncResources.invalidate(database.path);
    }
    const errors = closeBranchStateDatabaseHandle(database, options);
    if (wasCached && retireAdmission) {
      try {
        notifyBranchStateDatabaseClosed(database);
      } catch (error) {
        errors.push(error);
      }
    }
    throwSqliteLifecycleErrors(
      errors,
      `Branch Agent state database cleanup failed for ${database.path}.`,
    );
  } catch (error) {
    if (borrowedOwner) {
      retainStateDatabaseClose(database);
    }
    throw error;
  }
  if (borrowedOwner) {
    borrowedOwner.cleanupComplete = true;
    borrowers.delete(database.db);
  }
}

/** Close cached and disposal-only handles, preserving independent cleanup failures. */
function retireBranchStateDatabaseHandles(
  pathname?: string,
  options?: BranchStateDatabaseCloseOptions,
  identity?: DatabasePathIdentity,
): boolean {
  const databases = new Set<StateDatabaseHandle>([
    ...retainedDatabaseHandles.values(),
    ...cachedDatabases.values(),
  ]);
  const errors: unknown[] = [];
  let found = false;
  for (const database of databases) {
    if (
      pathname !== undefined &&
      database.path !== pathname &&
      (identity === undefined || databaseIdentities.get(database.db)?.key !== identity.key)
    ) {
      continue;
    }
    found = true;
    try {
      retireBranchStateDatabaseHandle(database, true, options);
    } catch (error) {
      errors.push(error);
    }
  }
  throwSqliteLifecycleErrors(errors, "Branch Agent state database cleanup failed.");
  return found;
}

/** Close one cached shared state database handle by exact pathname. */
export function closeBranchStateDatabaseByPath(
  pathname: string,
  options?: BranchStateDatabaseCloseOptions,
): boolean {
  return retireBranchStateDatabaseHandles(
    path.resolve(pathname),
    options,
    asyncResources.identity(pathname),
  );
}

/** Close all cached shared state database handles. */
export function closeBranchStateDatabase(options?: BranchStateDatabaseCloseOptions): void {
  retireBranchStateDatabaseHandles(undefined, options);
}

/** Register a resource owner before it can admit any shared-state worker opens. */
export function registerBranchStateDatabaseAsyncResource(
  resource: BranchStateDatabaseAsyncResource,
): () => void {
  return asyncResources.register(resource);
}

/** Capture the canonical read generation before any asynchronous worker admission. */
export const captureBranchStateDatabaseReadAdmission = asyncResources.capture;

/** Bind worker-created storage to its captured admission without publishing a native handle. */
export function publishBranchStateDatabaseWorkerAdmission(
  admission: BranchStateDatabaseReadAdmission,
): void {
  admission.assertCurrent();
  asyncResources.publish(admission.databasePath);
  admission.assertCurrent();
}

/** Drain worker resources before native checkpoint/close at one exact path. */
export function closeBranchStateDatabaseByPathAsync(
  pathname: string,
  options?: BranchStateDatabaseCloseOptions,
): Promise<boolean> {
  const resolvedPath = path.resolve(pathname);
  return asyncResources.close(resolvedPath, (identity) =>
    retireBranchStateDatabaseHandles(resolvedPath, options, identity),
  );
}

/** Orderly lifecycle close; synchronous close remains native/exit cleanup only. */
export async function closeBranchStateDatabaseAsync(
  options?: BranchStateDatabaseCloseOptions,
): Promise<void> {
  await asyncResources.close(undefined, () =>
    retireBranchStateDatabaseHandles(undefined, options),
  );
}

/** Test whether a cached shared state database handle is still open, optionally at one path. */
export function isBranchStateDatabaseOpen(pathname?: string): boolean {
  if (pathname !== undefined) {
    return cachedDatabases.get(path.resolve(pathname))?.db.isOpen === true;
  }
  return Array.from(cachedDatabases.values()).some((database) => database.db.isOpen);
}

/**
 * Close shared state handles and clear terminal failure latches for test isolation.
 * Worker retirement continues after return; await closeBranchStateDatabaseAsync()
 * before raw SQLite or file access to a database that workers have used.
 */
export function closeBranchStateDatabaseForTest(): void {
  closeBranchStateDatabase();
  terminalOpenLatch.clearAll();
}

/** Process-wide owner for cached shared-state handles and terminal open failures. */
export const branchStateDatabaseCache = {
  assertBranchStateDatabaseFreshOpenAllowedAtPath,
  assertBranchStateDatabaseOpenAllowed,
  clearBranchStateDatabaseOpenFailure,
  closeBranchStateDatabase,
  closeBranchStateDatabaseByPath,
  closeBranchStateDatabaseForTest,
  closeBranchStateDatabaseHandle,
  closeUnpublishedBranchStateDatabaseHandle,
  closeStaleCachedBranchStateDatabase,
  evictCachedBranchStateDatabase,
  evictBranchStateDatabaseAfterCorruption,
  getCachedBranchStateDatabase,
  getBranchStateDatabaseRuntimeFailure: runtimeFailures.get,
  getBranchStateDatabaseRecordedFailure: terminalOpenLatch.peek,
  getBranchStateDatabaseIfOpenAtPath,
  getKnownBranchStateDatabaseIdentity: asyncResources.knownIdentity,
  isBranchStateDatabaseOpen,
  publishBranchStateDatabase,
  recordBranchStateDatabaseOpenFailure,
  recordBranchStateDatabaseLifecycleOpenError,
  touchStateDatabase,
};

/** Offline removal drains local work and refuses an active native SQLite owner. */
export async function prepareBranchStateDatabaseRemoval(
  pathname: string,
  assertOwnerCurrent: () => void,
) {
  const databasePath = path.resolve(pathname);
  const maintenance = getBranchDatabaseMaintenanceScope();
  if (!maintenance?.ownsSchemaMaintenance) {
    throw new Error("State removal requires the installation's maintenance owner");
  }
  maintenance.assertAdmission();
  const releaseAdmission = asyncResources.holdExclusion(databasePath);
  try {
    await closeBranchStateDatabaseByPathAsync(databasePath);
    maintenance.assertOwnerCurrent();
    retainSqliteDatabaseRemovalExclusion(databasePath, maintenance);
    maintenance.assertOwnerCurrent();
  } catch (error) {
    releaseAdmission();
    throw error;
  }
  let active = true;
  return {
    assertCurrent() {
      if (!active) {
        throw new Error("State removal admission has been released");
      }
      assertOwnerCurrent();
    },
    release() {
      if (active) {
        active = false;
        releaseAdmission();
      }
    },
  };
}

function retainSqliteDatabaseRemovalExclusion(
  databasePath: string,
  maintenance: BranchDatabaseMaintenanceScope,
): void {
  if (!existsSync(databasePath)) {
    return;
  }
  const database = openNodeSqliteDatabase(resolveExistingSqliteFileUri(databasePath));
  const close = () => {
    if (!database.isOpen) {
      return;
    }
    const errors: unknown[] = [];
    try {
      if (database.isTransaction) {
        database.exec("ROLLBACK"); // sqlite-allow-raw -- Release the native removal exclusion before close.
      }
    } catch (error) {
      errors.push(error);
    }
    try {
      database.close();
    } catch (error) {
      errors.push(error);
    }
    throwSqliteLifecycleErrors(errors, "SQLite state removal exclusion cleanup failed.");
  };
  try {
    // The maintenance owner drains this handle after state removal. A failed
    // close retains both native custody and the external process owner.
    maintenance.own(database, "shared-handles", close);
    // Exclusive connection mode obtains the main-file lock even in WAL mode.
    // Do not change journal_mode: a refused removal must preserve recovery bytes.
    database.exec("PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE;"); // sqlite-allow-raw -- Native file-removal exclusion, without mutating journal mode.
  } catch (error) {
    try {
      close();
    } catch (cleanupError) {
      throw createSqliteLifecycleAggregateError(
        [error, cleanupError],
        "SQLite state removal admission and cleanup both failed.",
        error,
      );
    }
    if (isSqliteLockError(error)) {
      throw new Error(
        "Cannot remove Branch Agent state directory while another SQLite connection is active",
        {
          cause: error,
        },
      );
    }
    const code = sqlitePrimaryResultCode(error);
    // Explicit reset may remove corrupt state after process ownership is established.
    if (code !== 11 && code !== 26) {
      throw error;
    }
    return;
  }
  if (process.platform === "win32") {
    // WinVFS denies FILE_SHARE_DELETE: any peer handle prevents unlink. Our
    // own probe must close so removal can proceed when no peer remains.
    close();
  }
}

/** Reconfirm an advisory worker failure on the live owner connection. */
export async function confirmBranchStateDatabaseIntegrity(
  pathname: string,
): Promise<SqliteIntegrityConfirmation> {
  const resolvedPath = path.resolve(pathname);
  await closeBranchStateDatabaseByPathAsync(resolvedPath);
  return confirmSqliteFileIntegrity(resolvedPath, resolvedPath);
}
