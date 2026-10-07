import { addAbortListener } from "node:events";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { DatabaseSync } from "node:sqlite";
import { isMainThread, threadId } from "node:worker_threads";
import { hasLostGatewayStateOwnership } from "../infra/gateway-state-owner.js";
import { disposeNodeSqliteDependents } from "../infra/kysely-sync-cache-state.js";
import { openNodeSqliteDatabase } from "../infra/node-sqlite.js";
import { isPathInside } from "../infra/path-guards.js";
import { setSqliteBusyTimeout } from "../infra/sqlite-busy-timeout.js";
import { SQLITE_IDLE_HANDLE_TTL_MS } from "../infra/sqlite-handle-lifecycle.js";
import type { SqliteIntegrityDiagnostics } from "../infra/sqlite-integrity.js";
import {
  deferSqlitePostCommitPublication,
  hasSqlitePostCommitScope,
} from "../infra/sqlite-post-commit.js";
import { runSqliteReadOperationSync } from "../infra/sqlite-schema-facts.js";
import { createSqliteTerminalOpenLatch } from "../infra/sqlite-terminal-open-latch.js";
import {
  registerSqliteCacheExitClose,
  runInSqliteMaintenanceContext,
} from "../infra/sqlite-wal.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getGatewayShutdownCleanupSignal } from "../process/gateway-work-admission.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { VERSION } from "../version.js";
import { releaseAgentCreationClaimHandle } from "./agent-creation-claim.js";
import { releaseAgentDeletionDatabaseCleanup } from "./agent-deletion-cleanup.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseOptions,
  BranchAgentDatabaseOwnerInspection,
} from "./branch-agent-db-contract.js";
import {
  readBranchAgentDatabaseIdentity,
  findBranchAgentDatabaseIdentity,
  isBranchAgentDatabasePathCurrent,
} from "./branch-agent-db-identity.js";
import {
  readBranchAgentDatabaseWorkerLeaseReceiptFromClaim,
  releaseBranchAgentDatabaseLease,
  type BranchAgentDatabaseWorkerLeaseReceipt,
} from "./branch-agent-db-lease.js";
import { unregisterBranchAgentDatabase } from "./branch-agent-db-registry.js";
import {
  drainAgentDatabaseResources,
  matchesAgentDatabaseClose,
  revokeAgentDatabaseResources,
  withAgentDatabaseCloseFence,
  type AgentDatabaseCloseSelection,
} from "./branch-agent-db-resources.js";
import {
  assertSupportedAgentSchemaVersion,
  readExistingAgentSchemaMeta,
} from "./branch-agent-db-schema-helpers.js";
import {
  hasRevokedBranchAgentDatabaseValidation,
  invalidateBranchAgentDatabaseValidation,
  type BranchAgentDatabaseValidation,
} from "./branch-agent-db-validation-cache.js";
import { isSameBranchAgentDatabasePath } from "./branch-agent-db.paths.js";
import {
  clearBranchAgentIntegrityVerification,
  type BranchAgentIntegrityVerification,
} from "./branch-quarantine-store.js";
import {
  getBranchDatabaseMaintenanceScope,
  observeBranchDatabaseMaintenanceResource,
} from "./branch-state-db-async-lifecycle.js";
import {
  registerBranchStateDatabaseLifecycleListener,
  retainBranchStateDatabaseForIdle,
} from "./branch-state-db-cache.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "./branch-state-db.js";
import { resolveBranchStateSqlitePath } from "./branch-state-db.paths.js";

const agentDbLog = createSubsystemLogger("state/agent-db");
const BRANCH_AGENT_DB_SLOW_OPEN_MS = 1_000;
// Native and transformed SDK graphs must share the complete owner lifecycle;
// sharing only handles would split borrow pins, failure latches, and cleanup.
type AgentDatabaseLifecycle = {
  databases: Map<string, BranchAgentDatabase>;
  borrowers: WeakMap<DatabaseSync, Set<object>>;
  idleTimers: WeakMap<DatabaseSync, Disposable & { refresh(): void }>;
  incognito: WeakSet<BranchAgentDatabase>;
  generation: number;
  failures: Map<string, unknown>;
  leases: Map<string, { leaseId: string; env: NodeJS.ProcessEnv }>;
  terminal: ReturnType<typeof createSqliteTerminalOpenLatch>;
  unregisterExitClose: (() => void) | null;
  pending: Map<string, PendingAgentDatabaseOpen>;
  activePending: Set<PendingAgentDatabaseOpen>;
  retainedCloses: Set<RetainedAgentDatabaseClose>;
};
export type PendingAgentDatabaseOpen = {
  agentId: string;
  path: string;
  controller: AbortController;
  promise: Promise<BranchAgentDatabase>;
  assertHeld?: () => void;
  operations: number;
  releaseBorrow?: () => void;
  validation?: BranchAgentDatabaseValidation;
};
type RetainedAgentDatabaseClose = { agentId: string; path: string; close: () => void };
const cache = resolveGlobalSingleton<AgentDatabaseLifecycle>(
  Symbol.for("branch.agentDatabaseLifecycle"),
  () => ({
    databases: new Map(),
    borrowers: new WeakMap(),
    idleTimers: new WeakMap(),
    incognito: new WeakSet(),
    generation: 0,
    failures: new Map(),
    leases: new Map(),
    terminal: createSqliteTerminalOpenLatch({
      closeByPath: (pathname) => closeBranchAgentDatabaseByPath(pathname),
    }),
    unregisterExitClose: null,
    pending: new Map(),
    activePending: new Set(),
    retainedCloses: new Set(),
  }),
);

/** Queue a non-throwing runtime publication on the outer database commit edge. */
export function deferBranchAgentPostCommitPublication(
  database: BranchAgentDatabase,
  publish: (options: BranchAgentDatabaseOptions) => void,
): boolean {
  // Maintenance can mark projections dirty without scheduling runtime publication.
  if (!hasSqlitePostCommitScope(database.db)) {
    return false;
  }
  const lease = cache.leases.get(database.path);
  if (
    cache.databases.get(database.path) !== database ||
    (!lease && !cache.incognito.has(database))
  ) {
    throw new Error("Agent post-commit publication requires its admitted database owner");
  }
  const options = {
    agentId: database.agentId,
    path: database.path,
    ...(lease ? { env: { ...lease.env } } : {}),
  };
  return deferSqlitePostCommitPublication(database.db, () => publish(options));
}

function logResourceCloseFailure(pathname: string, error: unknown): void {
  agentDbLog.warn("Agent database resource close failed", { path: pathname, error });
}

function unregisterUnusedAgentDatabaseExitClose(): void {
  if (cache.databases.size === 0 && cache.retainedCloses.size === 0) {
    cache.unregisterExitClose?.();
    cache.unregisterExitClose = null;
  }
}

export function resolveAgentDatabaseIntegrityGateReason(
  database: Pick<BranchAgentDatabase, "agentId" | "db" | "path">,
  proof: {
    verification?: BranchAgentIntegrityVerification;
    validation?: BranchAgentDatabaseValidation;
    integrityRevoked: boolean;
    reuseIntegrity: boolean;
  },
): SqliteIntegrityDiagnostics["integrityGateReason"] {
  const { verification, validation, integrityRevoked, reuseIntegrity } = proof;
  if (integrityRevoked) {
    return "stale-lease-full";
  }
  if (hasRevokedBranchAgentDatabaseValidation(database.path, validation)) {
    return "revoked";
  }
  if (!reuseIntegrity) {
    return "lease-class";
  }
  return verification?.clean_close === 0 &&
    verification.app_version === VERSION &&
    `${verification.dev}:${verification.ino}` === readBranchAgentDatabaseIdentity(database).identity
    ? "dirty-receipt"
    : "no-proof";
}

/** Each physical-open generator owns these checkpoints across any integrity await. */
export function startAgentDatabaseOpenTiming(
  agentId: string,
  pathname: string,
  admissionMode: "sync" | "async",
  diagnostics: SqliteIntegrityDiagnostics,
) {
  const startedAt = performance.now();
  let elapsedMs = 0;
  const phaseDurationsMs = { open: 0, validation: 0, configuration: 0, schema: 0, registration: 0 };
  return (phase: keyof typeof phaseDurationsMs): void => {
    const completedMs = Math.floor(performance.now() - startedAt);
    phaseDurationsMs[phase] = completedMs - elapsedMs;
    elapsedMs = completedMs;
    if (phase === "validation" && diagnostics.integrityGateReason) {
      agentDbLog.info("agent database integrity gate", {
        agentId,
        path: pathname,
        pid: process.pid,
        threadId,
        isMainThread,
        admissionMode,
        ...diagnostics,
      });
    }
    // Registration is the final checkpoint; intermediate phases never emit a partial summary.
    if (phase === "registration" && elapsedMs >= BRANCH_AGENT_DB_SLOW_OPEN_MS) {
      agentDbLog.warn("slow Branch Agent agent database open", {
        agentId,
        elapsedMs,
        path: pathname,
        pid: process.pid,
        threadId,
        isMainThread,
        admissionMode,
        phaseDurationsMs,
        ...diagnostics,
        thresholdMs: BRANCH_AGENT_DB_SLOW_OPEN_MS,
      });
    }
  };
}

// A failed native close or lease release keeps its original owner until retry succeeds.
export function retainFailedAgentDatabaseClose(
  agentId: string,
  pathname: string,
  close: () => void,
): void {
  const retained: RetainedAgentDatabaseClose = {
    agentId,
    path: pathname,
    close: () => {
      close();
      cache.retainedCloses.delete(retained);
    },
  };
  cache.retainedCloses.add(retained);
  getBranchDatabaseMaintenanceScope()?.own(retained, "agent-handles", retained.close);
  cache.unregisterExitClose ??= registerSqliteCacheExitClose(closeBranchAgentDatabases);
}

export function revokePendingAgentDatabaseOpen(pathname: string, expectedAgentId?: string): void {
  for (const pending of cache.activePending) {
    if (
      pending.path === pathname &&
      (expectedAgentId === undefined || pending.agentId === expectedAgentId)
    ) {
      pending.controller.abort(new Error(`Agent database open was revoked: ${pathname}`));
    }
  }
}

export function retainAgentDatabase(db: DatabaseSync): () => void {
  observeBranchDatabaseMaintenanceResource(db);
  const borrowers = cache.borrowers.get(db) ?? new Set<object>();
  const borrower = {};
  borrowers.add(borrower);
  cache.borrowers.set(db, borrowers);
  return () => {
    if (borrowers.delete(borrower) && borrowers.size === 0) {
      cache.idleTimers.get(db)?.refresh();
    }
  };
}

/** Keep live deletion-fence reads warm without creating shared state or preventing explicit close. */
export function retainIncognitoSharedState(env?: NodeJS.ProcessEnv): () => void {
  const statePath = path.resolve(resolveBranchStateSqlitePath(env));
  let releaseIdle: (() => void) | undefined;
  const unsubscribe = registerBranchStateDatabaseLifecycleListener((event) => {
    if (event.kind === "opened" && event.database.path === statePath) {
      releaseIdle?.();
      releaseIdle = retainBranchStateDatabaseForIdle(event.database);
    }
  });
  return () => {
    unsubscribe();
    releaseIdle?.();
    releaseIdle = undefined;
  };
}

/** Activity and final borrower release use the same idle or post-grace eviction. */
export function refreshAgentDatabaseIdleTimer(database: BranchAgentDatabase): void {
  // Incognito's connection is its only durable owner; idle close would erase it.
  if (cache.incognito.has(database)) {
    return;
  }
  const existing = cache.idleTimers.get(database.db);
  if (existing) {
    existing.refresh();
    return;
  }
  const cleanupSignal = getGatewayShutdownCleanupSignal();
  const closeIdle = () => {
    if (cache.databases.get(database.path) !== database) {
      cache.idleTimers.get(database.db)?.[Symbol.dispose]();
      cache.idleTimers.delete(database.db);
      return;
    }
    // Awaiting operations own the exact connection; final release rearms eviction.
    if (database.db.isOpen && cache.borrowers.get(database.db)?.size) {
      return;
    }
    if (database.db.isOpen && database.db.isTransaction) {
      timer.refresh();
      return;
    }
    try {
      // Registry discovery metadata survives eviction; only explicit disposal removes it.
      closeCachedBranchAgentDatabase(database, { eviction: true });
      cache.databases.delete(database.path);
      cache.failures.delete(database.path);
      unregisterUnusedAgentDatabaseExitClose();
    } catch (error) {
      // Keep native/lease custody on the original entry until cleanup succeeds.
      logResourceCloseFailure(database.path, error);
      timer.refresh();
    }
  };
  const refresh = () => {
    if (cleanupSignal.aborted) {
      // A synchronous opener can still borrow the exact handle before cleanup runs.
      runInSqliteMaintenanceContext(() => queueMicrotask(closeIdle));
    } else {
      timer.refresh();
    }
  };
  const timer = runInSqliteMaintenanceContext(() =>
    setTimeout(closeIdle, SQLITE_IDLE_HANDLE_TTL_MS),
  );
  const cleanupListener = addAbortListener(cleanupSignal, refresh);
  timer.unref();
  cache.idleTimers.set(database.db, {
    refresh,
    [Symbol.dispose]() {
      clearTimeout(timer);
      cleanupListener[Symbol.dispose]();
    },
  });
}

/** Dispose only this publication; a later admission at the same path is independent. */
export async function closeMaintenanceAgentDatabase(database: BranchAgentDatabase): Promise<void> {
  await database.walMaintenance.stop();
  if (cache.databases.get(database.path) !== database) {
    return;
  }
  closeCachedBranchAgentDatabase(database);
  cache.databases.delete(database.path);
  cache.failures.delete(database.path);
  if (cache.incognito.has(database)) {
    cache.generation += 1;
  }
}

export function closeCachedBranchAgentDatabase(
  database: BranchAgentDatabase,
  options: { eviction?: boolean } = {},
): void {
  // Eviction must stay cheap: PASSIVE skips waiting on concurrent readers,
  // whose drained TRUNCATE checkpoints blocked the event loop for seconds.
  const lease = cache.leases.get(database.path);
  const alreadyClosed = !database.db.isOpen;
  const priorCheckpointError = database.walMaintenance.health?.state === "error";
  let clean: { path: string; identity: string } | undefined;
  let retainRuntimeProof: boolean;
  try {
    disposeNodeSqliteDependents(database.db);
    const checkpointed = database.walMaintenance.close(
      options.eviction ? { checkpointMode: "PASSIVE" } : undefined,
    );
    if (
      checkpointed &&
      !cache.failures.has(database.path) &&
      isBranchAgentDatabasePathCurrent(database)
    ) {
      const { identity } = readBranchAgentDatabaseIdentity(database);
      if (typeof identity === "string") {
        clean = { path: database.path, identity };
      }
    }
    // A reader-pinned WAL is healthy; only restart proof needs a completed checkpoint.
    retainRuntimeProof =
      !cache.failures.has(database.path) &&
      (alreadyClosed
        ? !priorCheckpointError
        : database.walMaintenance.health?.state === "blocked" &&
          isBranchAgentDatabasePathCurrent(database));
    if (database.db.isOpen) {
      database.db.close();
    }
  } catch (error) {
    if (lease) {
      clearBranchAgentIntegrityVerification(database.path, lease.env);
    }
    throw error;
  }
  if (lease) {
    try {
      releaseBranchAgentDatabaseLease(
        lease.leaseId,
        { env: lease.env, initializationAgentPaths: [database.path] },
        clean ?? (retainRuntimeProof ? "uncheckpointed" : undefined),
      );
    } catch (error) {
      // The native handle is closed. After a real loss of state ownership the lease row (a shared-state write)
      // is the next owner's to reconcile; failing here would keep the closed database cached and fail every
      // restart close, so the engine could neither restart nor stop cleanly.
      if (!hasLostGatewayStateOwnership(resolveBranchStateSqlitePath(lease.env))) {
        throw error;
      }
      agentDbLog.warn(
        "Agent database lease left for the next state owner (state ownership was lost)",
        {
          path: database.path,
          error,
        },
      );
    }
    cache.leases.delete(database.path);
  }
  releaseAgentDeletionDatabaseCleanup(database);
  releaseAgentCreationClaimHandle(database);
  cache.idleTimers.get(database.db)?.[Symbol.dispose]();
  cache.idleTimers.delete(database.db);
}

/** Close one cached agent database identified by its exact resolved pathname. */
export function closeBranchAgentDatabaseByPath(
  pathname: string,
  expectedAgentId?: string,
): boolean {
  // Cache keys are lexical resolved paths. Do not realpath aliases here: a
  // symlink swap must never redirect cleanup onto a different cached database.
  const resolvedPath = path.resolve(pathname);
  void revokeAgentDatabaseResources(
    { path: resolvedPath, agentId: expectedAgentId },
    logResourceCloseFailure,
  );
  // Revocation is immediate; the async owner retains its lease until native work joins.
  revokePendingAgentDatabaseOpen(resolvedPath, expectedAgentId);
  for (const retained of cache.retainedCloses) {
    if (
      retained.path === resolvedPath &&
      (expectedAgentId === undefined || retained.agentId === expectedAgentId)
    ) {
      retained.close();
    }
  }
  const database = cache.databases.get(resolvedPath);
  if (!database || (expectedAgentId !== undefined && database.agentId !== expectedAgentId)) {
    return false;
  }
  const incognito = cache.incognito.has(database);
  closeCachedBranchAgentDatabase(database);
  cache.databases.delete(resolvedPath);
  cache.failures.delete(resolvedPath);
  if (incognito) {
    cache.generation += 1;
  }
  unregisterUnusedAgentDatabaseExitClose();
  return true;
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

export type BranchAgentDatabaseWorkerCloseResult = {
  errors: Error[];
  settled: boolean;
};

/** Capture only the exact claim belonging to this admitted Worker connection. */
export function readBranchAgentDatabaseWorkerLeaseReceipt(
  pathname: string,
): BranchAgentDatabaseWorkerLeaseReceipt {
  const resolvedPath = path.resolve(pathname);
  const database = cache.databases.get(resolvedPath);
  const lease = cache.leases.get(resolvedPath);
  if (!database?.db.isOpen || !lease || cache.failures.has(resolvedPath)) {
    throw new Error(`Agent database Worker has no admitted lease: ${resolvedPath}`);
  }
  return readBranchAgentDatabaseWorkerLeaseReceiptFromClaim(lease.leaseId, {
    agentId: database.agentId,
    path: database.path,
    env: lease.env,
  });
}

/**
 * Converge a terminating worker's cached handle and durable lease without
 * turning an already committed worker result into an operation failure.
 * Callers own a bounded retry policy and must surface an unsettled result.
 */
export function settleBranchAgentDatabaseWorkerClose(
  pathname: string,
): BranchAgentDatabaseWorkerCloseResult {
  const resolvedPath = path.resolve(pathname);
  const errors: Error[] = [];
  const database = cache.databases.get(resolvedPath);
  if (database) {
    try {
      closeCachedBranchAgentDatabase(database);
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
    if (database.db.isOpen) {
      try {
        database.db.close();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (!database.db.isOpen) {
      cache.idleTimers.get(database.db)?.[Symbol.dispose]();
      cache.idleTimers.delete(database.db);
      const incognito = cache.incognito.has(database);
      cache.databases.delete(resolvedPath);
      cache.failures.delete(resolvedPath);
      if (incognito) {
        cache.generation += 1;
      }
      unregisterUnusedAgentDatabaseExitClose();
    }
  }

  if (!cache.databases.get(resolvedPath)?.db.isOpen) {
    const lease = cache.leases.get(resolvedPath);
    if (lease) {
      try {
        releaseBranchAgentDatabaseLease(lease.leaseId, {
          env: lease.env,
          initializationAgentPaths: [resolvedPath],
        });
        cache.leases.delete(resolvedPath);
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  return {
    errors,
    settled: !cache.databases.get(resolvedPath)?.db.isOpen && !cache.leases.has(resolvedPath),
  };
}

/** Commit receipts invalidate every current handle of the captured physical database. */
export function invalidateBranchAgentWritableProjections(
  databaseIdentity: string,
  invalidate: (database: DatabaseSync) => void,
): void {
  for (const database of cache.databases.values()) {
    if (findBranchAgentDatabaseIdentity(database)?.identity === databaseIdentity) {
      invalidate(database.db);
    }
  }
}

/** Close cached agent handles, optionally restricted to one runtime root. */
export function closeBranchAgentDatabases(rootPath?: string): void {
  void revokeAgentDatabaseResources({ rootPath }, logResourceCloseFailure);
  for (const pathname of cache.pending.keys()) {
    if (rootPath === undefined || isPathInside(rootPath, pathname)) {
      revokePendingAgentDatabaseOpen(pathname);
    }
  }
  for (const retained of cache.retainedCloses) {
    if (rootPath === undefined || isPathInside(rootPath, retained.path)) {
      retained.close();
    }
  }
  for (const pathname of cache.databases.keys()) {
    if (rootPath === undefined || isPathInside(rootPath, pathname)) {
      closeBranchAgentDatabaseByPath(pathname);
    }
  }
}

async function drainPendingAgentDatabaseOpens(
  selection: AgentDatabaseCloseSelection,
): Promise<void> {
  while (true) {
    const pending = [...cache.activePending].filter((owner) =>
      matchesAgentDatabaseClose(selection, owner),
    );
    if (pending.length === 0) {
      return;
    }
    for (const owner of pending) {
      revokePendingAgentDatabaseOpen(owner.path, selection.agentId);
    }
    await Promise.allSettled(pending.map((owner) => owner.promise));
  }
}

/** Drain native opens before a lifecycle owner releases shared state or removes its root. */
export async function closeBranchAgentDatabasesAsync(rootPath?: string): Promise<void> {
  const selection = { rootPath };
  await withAgentDatabaseCloseFence(selection, async (resourcePaths) => {
    const nativePaths = new Set(
      [...cache.databases.values(), ...cache.activePending, ...cache.retainedCloses]
        .filter((owner) => matchesAgentDatabaseClose(selection, owner))
        .map((owner) => owner.path),
    );
    const paths = new Set([...nativePaths, ...resourcePaths]);
    const results = await Promise.allSettled(
      [...paths].map((pathname) =>
        nativePaths.has(pathname)
          ? closeBranchAgentDatabaseByPathAsync(pathname)
          : drainAgentDatabaseResources({ ...selection, path: pathname }, async () => {}),
      ),
    );
    const errors = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length > 0) {
      throw new AggregateError(errors, "Agent database close failed");
    }
  });
}

/** Drain the exact retained owner before deletion, quarantine, or file replacement. */
export async function closeBranchAgentDatabaseByPathAsync(
  pathname: string,
  expectedAgentId?: string,
): Promise<boolean> {
  const selection = { path: path.resolve(pathname), agentId: expectedAgentId };
  revokePendingAgentDatabaseOpen(selection.path, expectedAgentId);
  return drainAgentDatabaseResources(selection, async () => {
    await drainPendingAgentDatabaseOpens(selection);
    const database = cache.databases.get(selection.path);
    if (database && (expectedAgentId === undefined || database.agentId === expectedAgentId)) {
      await database.walMaintenance.stop();
    }
    return closeBranchAgentDatabaseByPath(selection.path, expectedAgentId);
  });
}

/** Read a database's durable role and agent owner without mutating it. */
export function inspectBranchAgentDatabaseOwner(
  pathname: string,
): BranchAgentDatabaseOwnerInspection {
  let db: DatabaseSync | undefined;
  try {
    // Failed opens retain a disposal-only handle whose agentId is the request,
    // not a verified owner. Only admitted handles can answer from cache.
    const resolvedPath = path.resolve(pathname);
    const opened = cache.databases.get(resolvedPath);
    if (opened?.db.isOpen && !cache.failures.has(resolvedPath)) {
      runSqliteReadOperationSync(
        opened.db,
        () => assertSupportedAgentSchemaVersion(opened.db, pathname),
        "fresh",
      );
      refreshAgentDatabaseIdleTimer(opened);
      return { status: "owned", agentId: opened.agentId };
    }
    db = openNodeSqliteDatabase(pathname, { readOnly: true });
    setSqliteBusyTimeout(db, BRANCH_SQLITE_BUSY_TIMEOUT_MS);
    assertSupportedAgentSchemaVersion(db, pathname);
    const existing = readExistingAgentSchemaMeta(db);
    if (!existing) {
      return { status: "unowned" };
    }
    if (existing.role !== "agent" || !existing.agentId) {
      return { status: "unreadable" };
    }
    return { status: "owned", agentId: normalizeAgentId(existing.agentId) };
  } catch {
    return { status: "unreadable" };
  } finally {
    db?.close();
  }
}

/** Lists process-held incognito databases without opening new sentinel handles. */
export function listOpenIncognitoAgentDatabases(): Array<{ agentId: string; storePath: string }> {
  return [...cache.databases.values()]
    .filter((database) => database.db.isOpen && cache.incognito.has(database))
    .map((database) => ({ agentId: database.agentId, storePath: database.path }))
    .toSorted(
      (left, right) =>
        left.agentId.localeCompare(right.agentId) || left.storePath.localeCompare(right.storePath),
    );
}

/** Borrow committed process-held facts without opening or querying a private store. */
export function getOpenIncognitoAgentDatabase(agentId: string, pathname: string) {
  const database = cache.databases.get(path.resolve(pathname));
  return database?.db.isOpen &&
    database.agentId === normalizeAgentId(agentId) &&
    cache.incognito.has(database)
    ? database
    : undefined;
}

/** Return the generation of process-held incognito database membership. */
export function readOpenIncognitoAgentDatabaseGeneration(): number {
  return cache.generation;
}

/** Returns whether this exact process-held database is incognito/in-memory. */
export function isIncognitoBranchAgentDatabase(database: BranchAgentDatabase): boolean {
  return cache.incognito.has(database);
}

export { cache as agentDatabaseLifecycle };
export { registerBranchAgentDatabaseAsyncResource } from "./branch-agent-db-resources.js";
