import { AsyncLocalStorage } from "node:async_hooks";
import { lstatSync } from "node:fs";
import path from "node:path";
import { isPromiseLike } from "@branch/normalization-core/promise-like";
import { hasErrnoCode } from "../infra/errno.js";
import { SqliteCoordinatorError } from "../infra/sqlite-lifecycle-errors.js";
import {
  retainSnapshotTempDirectory,
  retainSnapshotWork,
  SqliteSnapshotCleanupError,
} from "../infra/sqlite-readonly-location-cleanup.js";
import { prepareSqliteReadOnlyLocationSyncInProcess } from "../infra/sqlite-readonly-location.js";
import type { PreparedSqliteReadOnlyLocation } from "../infra/sqlite-readonly-location.types.js";
import {
  prepareSqliteReadOnlyLocation,
  prepareSqliteReadOnlyLocationSync,
} from "../infra/sqlite-snapshot-source.js";
import { getAsyncWorkSignal } from "../shared/async-work-scope.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  captureBranchStateDatabaseReadAdmission,
  branchStateDatabaseCache,
} from "./branch-state-db-cache.js";
import { readAdmittedStateContentVersion } from "./branch-state-db-content-version.js";
import type {
  BranchStateDatabaseOptions,
  BranchStateSchemaReadAdmission,
} from "./branch-state-db-contract.js";
import {
  assertStateReadSchema,
  openBranchStateReadOnlyLocation,
  withBranchStateReadOnlyLocation,
} from "./branch-state-db-read-connection.js";
import {
  withCachedBranchStateDatabaseReadOnly,
  withMaintenanceBranchStateDatabaseReadOnly,
  type ReusedBranchStateReadOnlyDatabase,
} from "./branch-state-db-readonly-reuse.js";
import { isExistingBranchStateSchema } from "./branch-state-db-schema-policy.js";
import {
  existingPathOrUndefined,
  resolveBranchStateSqlitePath,
} from "./branch-state-db.paths.js";
import {
  getBranchDatabaseMaintenanceScope,
  maintenanceOwnerMayCopySourcesInProcess,
} from "./branch-state-maintenance-context.js";
import {
  startBranchStateReadOperation,
  type BranchStateReadCompletion,
} from "./branch-state-read-operation.js";
import {
  assertRetainedReadScopeAdmission,
  bindRetainedReadScope,
  createRetainedReadScope,
  runRetainedReadScope,
  runSynchronousReadScope,
} from "./branch-state-read-scope.js";
import type {
  BranchStateReadReceipt,
  BranchStateReadOptions,
  BranchStateReadCommand,
  BranchStateReadReply,
  BranchStateReadOnlyDatabase,
  RetainedReadScope,
} from "./branch-state-read.types.js";
import { captureBranchStateReadWorkerContext } from "./branch-state-worker-context.js";

const artifactPreservingReads = resolveGlobalSingleton(
  Symbol.for("branch.artifactPreservingStateReads"),
  () => new AsyncLocalStorage<boolean>(),
);

const disposableStateReads = resolveGlobalSingleton(
  Symbol.for("branch.disposableStateReads"),
  () => new AsyncLocalStorage<RetainedReadScope[]>(),
);

const stateSnapshotReads = resolveGlobalSingleton(
  Symbol.for("branch.stateSnapshotReads"),
  () =>
    new AsyncLocalStorage<
      RetainedReadScope & { location: string; cleanupRoot?: string; env: NodeJS.ProcessEnv }
    >(),
);

/** Opaque identity for derived facts scoped to these owned private database bytes. */
export function getActiveBranchStateDatabaseReadSnapshot(
  options: BranchStateDatabaseOptions = {},
): object | undefined {
  const current = stateSnapshotReads.getStore();
  return current?.path === resolveReadOnlyPath(options) ? current : undefined;
}

/** Resolve a composite read from one online snapshot without redirecting live writers. */
export async function withBranchStateDatabaseReadSnapshot<T>(
  operation: () => Promise<T>,
  options: BranchStateDatabaseOptions = {},
): Promise<T> {
  const pathname = resolveReadOnlyPath(options);
  const current = stateSnapshotReads.getStore();
  if ((current?.active && current.path === pathname) || !existingPathOrUndefined(pathname)) {
    return await operation();
  }
  const env = options.env ?? process.env;
  const callerSignal = getAsyncWorkSignal();
  const controller = new AbortController();
  let closeSnapshotWork: ((reason: unknown) => void) | undefined;
  const run = async () => {
    let admission: ReturnType<typeof captureBranchStateDatabaseReadAdmission>;
    let prepared: PreparedSqliteReadOnlyLocation;
    try {
      branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(pathname, env);
      admission = captureBranchStateDatabaseReadAdmission(pathname);
      controller.signal.throwIfAborted();
      if (
        isArtifactPreservingStateRead() &&
        maintenanceOwnerMayCopySourcesInProcess(getBranchDatabaseMaintenanceScope(), pathname) &&
        !branchStateDatabaseCache.isBranchStateDatabaseOpen(pathname)
      ) {
        prepared = prepareSqliteReadOnlyLocationSyncInProcess(pathname);
      } else {
        prepared = await prepareSqliteReadOnlyLocation(pathname, {
          preserveSourceArtifacts: isArtifactPreservingStateRead(),
          signal: controller.signal,
        });
      }
    } catch (error) {
      throw new Error(
        `Cannot read shared state for discovery: ${pathname}. Retry after the current state operation completes. ${String(error)}`,
        { cause: error },
      );
    }
    const releaseSource = retainSnapshotTempDirectory(
      prepared.cleanupRoot ?? path.dirname(prepared.location),
    );
    const snapshot = Object.assign(
      createRetainedReadScope(pathname, admission.identity, async () => {
        releaseSource();
        let cause: unknown;
        try {
          if (await prepared.cleanupAsync()) {
            return;
          }
        } catch (error) {
          cause = error;
        }
        throw new SqliteSnapshotCleanupError(
          `Shared-state discovery snapshot cleanup failed: ${prepared.cleanupRoot ?? pathname}`,
          { cause },
        );
      }),
      { location: prepared.location, cleanupRoot: prepared.cleanupRoot, env },
    );
    const lifecycle = stateSnapshotReads.run(snapshot, () => bindRetainedReadScope(snapshot));
    closeSnapshotWork = lifecycle.abort;
    const closeFromCaller = () => lifecycle.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", closeFromCaller, { once: true });
    if (callerSignal?.aborted) {
      closeFromCaller();
    }
    try {
      return await lifecycle.run(async () => {
        controller.signal.throwIfAborted();
        branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(pathname, env);
        admission.assertCurrent();
        return await operation();
      });
    } finally {
      callerSignal?.removeEventListener("abort", closeFromCaller);
    }
  };
  return await retainSnapshotWork(run(), () => {
    controller.abort(new Error("Shared-state snapshot admission closed"));
    closeSnapshotWork?.(controller.signal.reason);
  });
}

/** The caller owns this private database and removes its files after the scope closes. */
export async function withDisposableBranchStateReads<T>(
  pathname: string,
  operation: () => Promise<T>,
): Promise<T> {
  const resolvedPath = resolveReadOnlyPath({ path: pathname });
  const scope = createRetainedReadScope(
    resolvedPath,
    captureBranchStateDatabaseReadAdmission(resolvedPath).identity,
  );
  return await runRetainedReadScope(scope, () =>
    disposableStateReads.run([...(disposableStateReads.getStore() ?? []), scope], operation),
  );
}

function requiresArtifactPreservingSnapshot(pathname: string): boolean {
  return (
    isArtifactPreservingStateRead() &&
    !disposableStateReads.getStore()?.some((scope) => scope.active && scope.path === pathname)
  );
}

/** Admission scopes every nested reader without changing normal live-read semantics. */
export function withArtifactPreservingStateReads<T>(operation: () => T): T {
  return artifactPreservingReads.run(true, operation);
}

export function isArtifactPreservingStateRead(): boolean {
  return artifactPreservingReads.getStore() === true;
}

type ScopedRead = ReturnType<typeof openBranchStateReadOnlyLocation>;
const synchronousReadSnapshots = resolveGlobalSingleton(
  Symbol.for("branch.synchronousStateReadSnapshots"),
  (): { current: Map<string, ScopedRead> | undefined; currentAuthorityPath?: string } => ({
    current: undefined,
  }),
);

/** One synchronous metadata operation shares private bytes, never later admission reads. */
export function withSynchronousArtifactPreservingStateSnapshot<T>(
  operation: () => T,
  options?: { current?: BranchStateDatabaseOptions },
): T {
  if (options?.current) {
    // Check inherited admission before selecting fresh bytes for this assertion.
    const pathname = resolveReadOnlyPath(options.current);
    const inherited = synchronousReadSnapshots.current;
    const inheritedAuthority = synchronousReadSnapshots.currentAuthorityPath;
    return stateSnapshotReads.exit(() => {
      synchronousReadSnapshots.current = undefined;
      synchronousReadSnapshots.currentAuthorityPath = pathname;
      try {
        return withArtifactPreservingStateReads(() =>
          withSynchronousArtifactPreservingStateSnapshot(operation),
        );
      } finally {
        synchronousReadSnapshots.current = inherited;
        synchronousReadSnapshots.currentAuthorityPath = inheritedAuthority;
      }
    });
  }
  if (!isArtifactPreservingStateRead() || synchronousReadSnapshots.current) {
    return operation();
  }
  const readers = new Map<string, ScopedRead>();
  synchronousReadSnapshots.current = readers;
  return runSynchronousReadScope(
    {
      readers,
      leave: () => {
        synchronousReadSnapshots.current = undefined;
      },
    },
    operation,
  );
}

function resolveReadOnlyPath(options: BranchStateDatabaseOptions): string {
  const pathname = path.resolve(
    options.path ?? resolveBranchStateSqlitePath(options.env ?? process.env),
  );
  assertRetainedReadScopeAdmission(pathname, [
    stateSnapshotReads.getStore(),
    ...(disposableStateReads.getStore() ?? []),
  ]);
  isExistingBranchStateSchema(pathname);
  return pathname;
}

function withBranchStateDatabaseReadOnlyIfOpen<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  pathname: string,
  currentAuthority = false,
): ReusedBranchStateReadOnlyDatabase<T> {
  const snapshot = stateSnapshotReads.getStore();
  if (snapshot?.active && snapshot.path === pathname) {
    branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(
      pathname,
      snapshot.env,
    );
    return {
      reused: true,
      value: withBranchStateReadOnlyLocation(operation, pathname, snapshot.location),
    };
  }
  return withCachedBranchStateDatabaseReadOnly(
    operation,
    pathname,
    currentAuthority || synchronousReadSnapshots.currentAuthorityPath === pathname,
  );
}

function withFreshBranchStateDatabaseReadOnly<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  options: BranchStateDatabaseOptions,
  pathname: string,
): T {
  const env = options.env ?? process.env;
  branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(pathname, env);
  if (synchronousReadSnapshots.currentAuthorityPath === pathname) {
    const maintained = withMaintenanceBranchStateDatabaseReadOnly(operation, pathname);
    if (maintained.reused) {
      return maintained.value;
    }
  }
  // Even read-only SQLite opens can create a missing WAL. The existing worker
  // snapshots committed WAL pages without touching source sidecars or caller-held locks.
  // One consistent snapshot per synchronous scope avoids mixed reads and duplicate copies.
  // Concurrent commits become visible in the next scope; this reader closes at scope end.
  const readers = synchronousReadSnapshots.current;
  if (readers && requiresArtifactPreservingSnapshot(pathname)) {
    let opened = readers.get(pathname);
    if (!opened) {
      opened = openBranchStateReadOnlyLocation(
        pathname,
        prepareSqliteReadOnlyLocationSync(pathname),
      );
      readers.set(pathname, opened);
    }
    assertStateReadSchema(opened.database.db, pathname);
    const result = operation(opened.database);
    if (isPromiseLike(result)) {
      throw new SqliteCoordinatorError("SQLite metadata snapshot read must remain synchronous");
    }
    return result;
  }
  const prepared = requiresArtifactPreservingSnapshot(pathname)
    ? prepareSqliteReadOnlyLocationSync(pathname)
    : undefined;
  return withBranchStateReadOnlyLocation(operation, pathname, prepared ?? pathname);
}

/** Read shared state without joining writers; admission inherits artifact preservation. */
export function withBranchStateDatabaseReadOnly<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  options: BranchStateDatabaseOptions = {},
): T {
  const pathname = resolveReadOnlyPath(options);
  // Reusing a handle this process already holds keeps row loops cheap: opening
  // and closing a connection per call made shared-state reads scale with row
  // count. An in-flight transaction is skipped so callers never observe
  // uncommitted rows a fresh read-only connection could not have seen.
  if (synchronousReadSnapshots.current?.has(pathname)) {
    return withFreshBranchStateDatabaseReadOnly(operation, options, pathname);
  }
  const reused = withBranchStateDatabaseReadOnlyIfOpen(operation, pathname);
  if (reused.reused) {
    return reused.value;
  }
  return withFreshBranchStateDatabaseReadOnly(operation, options, pathname);
}

/** A missing pathname is not absence while this read owner can serve retained state. */
export function isBranchStateDatabaseDefinitelyAbsent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  try {
    const pathname = resolveReadOnlyPath({ env });
    const snapshot = stateSnapshotReads.getStore();
    if (
      synchronousReadSnapshots.current?.has(pathname) ||
      (snapshot?.active && snapshot.path === pathname) ||
      branchStateDatabaseCache.getCachedBranchStateDatabase(pathname)?.db.isOpen
    ) {
      return false;
    }
    try {
      lstatSync(pathname);
      return false;
    } catch (error) {
      return hasErrnoCode(error, "ENOENT");
    }
  } catch {
    // Unknown availability retains the normal reader's admission and error behavior.
    return false;
  }
}

/** Read existing shared state while preserving non-missing filesystem failures. */
export function withExistingBranchStateDatabaseReadOnly<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  options: BranchStateDatabaseOptions = {},
): T | undefined {
  const pathname = resolveReadOnlyPath(options);
  if (synchronousReadSnapshots.current?.has(pathname)) {
    return withFreshBranchStateDatabaseReadOnly(operation, options, pathname);
  }
  const reused = withBranchStateDatabaseReadOnlyIfOpen(operation, pathname);
  if (reused.reused) {
    return reused.value;
  }
  const existingPath = existingPathOrUndefined(pathname);
  return existingPath === undefined
    ? undefined
    : withFreshBranchStateDatabaseReadOnly(operation, options, existingPath);
}

/** Fixed reads observe committed state unless their owner explicitly selected a snapshot. */
export function executeExistingBranchStateRead(
  options: BranchStateDatabaseOptions,
  command: BranchStateReadCommand,
  readOptions: BranchStateReadOptions = {},
): Promise<BranchStateReadReply | undefined> {
  const completion = startExistingBranchStateRead(options, command, readOptions);
  return completion.kind === "retained" ? completion.operation.result : completion.result;
}

/** Native cached backups remain awaited-only; fresh and inherited readers retain real progress. */
function startExistingBranchStateRead(
  options: BranchStateDatabaseOptions,
  command: BranchStateReadCommand,
  {
    context,
    current,
    live,
    mapError,
    signal,
    preferIndependentWarmRead,
  }: BranchStateReadOptions = {},
): BranchStateReadCompletion {
  const receipt: BranchStateReadReceipt = { phase: "before-read" };
  try {
    context?.admission.assertCurrent();
    const execute = () =>
      startRetainedBranchStateRead(
        options,
        command,
        receipt,
        mapError,
        context,
        signal,
        current || live,
        preferIndependentWarmRead,
      );
    // Active writer observations use the retained worker connection, not a new
    // artifact-preserving copy. Admission and canonical close still own it.
    const read = live
      ? () => artifactPreservingReads.run(false, () => stateSnapshotReads.exit(execute))
      : current
        ? () => stateSnapshotReads.exit(execute)
        : execute;
    return context?.runInCapturedSchemaScope ? context.runInCapturedSchemaScope(read) : read();
  } catch (error) {
    throw mapError ? mapError(error, receipt.phase) : error;
  }
}

function startRetainedBranchStateRead(
  options: BranchStateDatabaseOptions,
  command: BranchStateReadCommand,
  receipt: BranchStateReadReceipt,
  mapError: BranchStateReadOptions["mapError"],
  capturedContext?: BranchStateReadOptions["context"],
  signal?: AbortSignal,
  currentRead = false,
  preferIndependentWarmRead?: true,
): BranchStateReadCompletion {
  const pathname = resolveReadOnlyPath(options);
  const current = stateSnapshotReads.getStore();
  const snapshot = current?.active && current.path === pathname ? current : undefined;
  const scopes: RetainedReadScope[] = [
    ...(snapshot ? [snapshot] : []),
    ...(disposableStateReads.getStore() ?? []).filter(
      (scope) => scope.active && scope.path === pathname,
    ),
  ];
  const env = snapshot?.env ?? options.env;
  const context = capturedContext ?? captureBranchStateReadWorkerContext({ path: pathname, env });
  if (capturedContext) {
    if (context.admission.databasePath !== pathname) {
      throw new Error("Shared-state read context does not match its selected source");
    }
    context.maintenanceScope?.assertAdmission();
    context.admission.assertCurrent();
  }
  const preserveArtifacts = requiresArtifactPreservingSnapshot(pathname);
  const controller = new AbortController();
  const readSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  const run = () => {
    const inheritedSource = currentRead
      ? undefined
      : synchronousReadSnapshots.current?.get(pathname)?.snapshotSource?.retain();
    return startBranchStateReadOperation(command, {
      pathname,
      snapshot: inheritedSource ?? snapshot,
      scopes,
      context,
      preserveArtifacts,
      preferIndependentWarmRead,
      controller,
      signal: readSignal,
      receipt,
      mapError,
    });
  };
  // Enter the same frames as tracked async work, but keep its retained result independent
  // of the bookkeeping promises used by scope drains.
  const tracked = scopes.reduceRight<() => BranchStateReadCompletion>(
    (operation, scope) => () =>
      scope.work.run(() => {
        const completion = operation();
        const result =
          completion.kind === "retained" ? completion.operation.result : completion.result;
        void scope.work.track(() => result).catch(() => undefined);
        return completion;
      }),
    run,
  );
  const maintenance = context.maintenanceScope;
  let completion: BranchStateReadCompletion | undefined;
  if (maintenance) {
    // Maintenance keeps this captured frame active until the callback's Promise settles.
    void maintenance.run(() => {
      const accepted = tracked();
      completion = accepted;
      return accepted.kind === "retained" ? accepted.operation.result : accepted.result;
    });
  } else {
    completion = tracked();
  }
  if (!completion) {
    throw new Error("Shared-state read maintenance scope did not start its operation");
  }
  const result = completion.kind === "retained" ? completion.operation.result : completion.result;
  void retainSnapshotWork(result, () =>
    controller.abort(new Error("Shared-state read admission closed")),
  );
  return completion;
}

/** Read existing shared state without creating or updating its SQLite sidecars. */
export function withExistingBranchStateDatabaseArtifactPreservingReadOnly<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  options: BranchStateDatabaseOptions = {},
  openStateSchemaReadAdmission?: BranchStateSchemaReadAdmission,
): T | undefined {
  if (openStateSchemaReadAdmission) {
    return withExistingBranchStateDatabaseCurrentReadOnly(
      operation,
      options,
      openStateSchemaReadAdmission,
    );
  }
  return withArtifactPreservingStateReads(() =>
    withExistingBranchStateDatabaseReadOnly(operation, options),
  );
}

/** Publication guards need current rows, never an inherited discovery snapshot. */
export function withExistingBranchStateDatabaseCurrentReadOnly<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  options: BranchStateDatabaseOptions & {
    /** Existing host mutation guards may read natively outside worker admission grants. */
    allowNativeRead?: true;
  } = {},
  openStateSchemaReadAdmission?: BranchStateSchemaReadAdmission,
): T | undefined {
  const pathname = resolveReadOnlyPath(options);
  return stateSnapshotReads.exit(() => {
    // Maintenance admission belongs to a fresh private reader, never a cached writer.
    if (!openStateSchemaReadAdmission) {
      const reused = withBranchStateDatabaseReadOnlyIfOpen(operation, pathname, true);
      if (reused.reused) {
        return reused.value;
      }
    }
    if (existingPathOrUndefined(pathname) === undefined) {
      return undefined;
    }
    branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(
      pathname,
      options.env ?? process.env,
    );
    return withBranchStateReadOnlyLocation(
      operation,
      pathname,
      options.allowNativeRead && !isArtifactPreservingStateRead() && !openStateSchemaReadAdmission
        ? pathname
        : prepareSqliteReadOnlyLocationSync(pathname),
      openStateSchemaReadAdmission,
    );
  });
}

/** Preserve source artifacts while allowing the caller to progress during snapshot preparation. */
export function withExistingBranchStateDatabaseArtifactPreservingReadOnlyAsync<T>(
  operation: (database: BranchStateReadOnlyDatabase) => T,
  options: BranchStateDatabaseOptions = {},
): Promise<T | undefined> {
  return withArtifactPreservingStateReads(async () => {
    const pathname = resolveReadOnlyPath(options);
    const reused = withBranchStateDatabaseReadOnlyIfOpen(operation, pathname);
    if (reused.reused) {
      return reused.value;
    }
    if (existingPathOrUndefined(pathname) === undefined) {
      return undefined;
    }
    const env = options.env ?? process.env;
    branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(pathname, env);
    if (!requiresArtifactPreservingSnapshot(pathname)) {
      return withBranchStateReadOnlyLocation(operation, pathname, pathname);
    }
    const prepared = await prepareSqliteReadOnlyLocation(pathname, {
      preserveSourceArtifacts: true,
    });
    try {
      // Verification can quarantine the live path while the snapshot child is running.
      branchStateDatabaseCache.assertBranchStateDatabaseFreshOpenAllowedAtPath(pathname, env);
    } catch (error) {
      prepared.cleanup();
      throw error;
    }
    return withBranchStateReadOnlyLocation(operation, pathname, prepared);
  });
}

export function readCurrentBranchStateDatabaseContentVersion(
  options: BranchStateDatabaseOptions = {},
): string | undefined {
  const pathname = resolveReadOnlyPath(options);
  const env = options.env ?? process.env;
  return stateSnapshotReads.exit(() => readAdmittedStateContentVersion(pathname, env));
}

/** Current guards leave discovery snapshots after validating their inherited read admission. */
export function withCurrentBranchStateReadScope<T>(
  options: BranchStateDatabaseOptions,
  operation: (pathname: string) => T,
): T {
  const pathname = resolveReadOnlyPath(options);
  return stateSnapshotReads.exit(() => operation(pathname));
}
