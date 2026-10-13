import fs from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { extractErrorCode } from "@branch/normalization-core/error-coercion";
import {
  createRetainedOperation,
  type RetainedOperation,
} from "@branch/worker-runtime/lifecycle";
import { registerSignalExitFinalizer } from "../cli/signal-exit-barrier.js";
import { getChildLogger } from "../logging/logger.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { createSqliteLifecycleAggregateError } from "./sqlite-lifecycle-errors.js";
import type {
  PreparedSqliteReadOnlyLocation,
  RetainedPreparedSqliteReadOnlyLocation,
} from "./sqlite-readonly-location.types.js";
import {
  beginSqliteSnapshotRetirement,
  drainPendingSqliteSnapshotTokens,
} from "./sqlite-snapshot-retirement.js";
import { SQLITE_STAGING_TOKEN_FILES, type SqliteStagingToken } from "./sqlite-staging-token.js";

export class SqliteSnapshotCleanupError extends Error {}

/** A failed result does not discharge the original request's native cleanup custody. */
export function settleSqliteSnapshotRequest<T>(request: {
  result: Promise<T>;
  startClose(): RetainedOperation<void>;
}): Promise<T> {
  return request.result.catch(async (error: unknown) => {
    try {
      await request.startClose().result;
    } catch (cleanupError) {
      if (cleanupError === error) {
        throw error;
      }
      const combined = createSqliteLifecycleAggregateError(
        [error, cleanupError],
        "SQLite snapshot allocation and cleanup failed",
        error,
      );
      throw error instanceof SqliteSnapshotCleanupError
        ? new SqliteSnapshotCleanupError(error.message, { cause: combined })
        : combined;
    }
    throw error;
  });
}

type SnapshotDirectory = {
  release?: SqliteStagingToken;
  releaseRetained?: () => RetainedOperation<void>;
  retiringRetained?: RetainedOperation<boolean>;
  retirementStarted?: boolean;
  retired?: boolean;
  removed?: boolean;
  readers: Set<symbol>;
};
type SnapshotCleanupState = {
  directories: Map<string, SnapshotDirectory>;
  activeWork: Map<Promise<unknown>, () => void>;
  exitHandlerInstalled: boolean;
  pendingSignalCleanup: Promise<void> | undefined;
  signalCleanup: () => Promise<void>;
};
// Reloaded callers share reader, work, and retirement fences with retained native owners.
const cleanupState = resolveGlobalSingleton<SnapshotCleanupState>(
  Symbol.for("branch.sqliteSnapshotCleanup"),
  () => ({
    directories: new Map<string, SnapshotDirectory>(),
    activeWork: new Map<Promise<unknown>, () => void>(),
    exitHandlerInstalled: false,
    pendingSignalCleanup: undefined,
    signalCleanup: cleanupSnapshotOperations,
  }),
);
const snapshotDirectories = cleanupState.directories;
const activeSnapshotWork = cleanupState.activeWork;
// A caller keeps its original record until settlement, even after another caller removes its bytes.
const pendingTempDirectoryCleanup = new Map<string, SnapshotDirectory>();

function snapshotDirectory(directory: string): SnapshotDirectory {
  let owner = snapshotDirectories.get(directory);
  if (!owner) {
    owner = { readers: new Set() };
    snapshotDirectories.set(directory, owner);
  }
  return owner;
}

function findSnapshotDirectory(directory: string): SnapshotDirectory | undefined {
  return pendingTempDirectoryCleanup.get(directory) ?? snapshotDirectories.get(directory);
}

function releaseSnapshotDirectoryCustody(directory: string, owner: SnapshotDirectory | undefined) {
  if (pendingTempDirectoryCleanup.get(directory) === owner) {
    pendingTempDirectoryCleanup.delete(directory);
  }
  if (snapshotDirectories.get(directory) === owner) {
    snapshotDirectories.delete(directory);
  }
}

export function cleanupSnapshotOperations(): Promise<void> {
  cleanupState.pendingSignalCleanup ??= (async () => {
    const directories = snapshotDirectories.entries();
    while (true) {
      while (activeSnapshotWork.size > 0) {
        for (const stop of activeSnapshotWork.values()) {
          stop();
        }
        await Promise.allSettled(activeSnapshotWork.keys());
      }
      // Removal yields: join readers admitted during it before selecting more bytes.
      const next = directories.next();
      if (next.done) {
        break;
      }
      const [directory, owner] = next.value;
      await removeTempDirectoryAsync(
        directory,
        (error) =>
          emitSnapshotCleanupFailure({
            cleanupRoot: directory,
            operation: "rm",
            code: extractErrorCode(error),
          }),
        owner,
      );
    }
  })().finally(() => {
    cleanupState.pendingSignalCleanup = undefined;
  });
  return cleanupState.pendingSignalCleanup;
}

/** Join native backup work or a terminated child before removing its private bytes. */
export function retainSnapshotWork<T>(work: Promise<T>, stop: () => void = () => {}): Promise<T> {
  registerSnapshotCleanup();
  activeSnapshotWork.set(work, stop);
  const release = () => activeSnapshotWork.delete(work);
  void work.then(release, release);
  return work;
}

/** Keep signal cleanup behind the consumer, including private transforms and publication. */
export async function withPreparedSqliteSnapshot<T>(
  snapshot: PreparedSqliteReadOnlyLocation,
  read: (location: string) => T | Promise<T>,
): Promise<T> {
  let outcome: { value: T } | { cause: unknown };
  try {
    outcome = {
      value: await retainSnapshotWork(Promise.resolve().then(() => read(snapshot.location))),
    };
  } catch (cause) {
    outcome = { cause };
  }
  if (!(await snapshot.cleanupAsync())) {
    // An exit retry is best-effort, not proof that this private copy was removed.
    const readFailure =
      "cause" in outcome
        ? `${outcome.cause instanceof Error ? outcome.cause.message : String(outcome.cause)}; `
        : "";
    throw new Error(
      `${readFailure}SQLite snapshot cleanup failed: ${snapshot.cleanupRoot ?? path.dirname(snapshot.location)}. Check directory permissions and available storage before retrying.`,
      "cause" in outcome ? outcome : undefined,
    );
  }
  if ("cause" in outcome) {
    throw outcome.cause;
  }
  return outcome.value;
}

export function registerSnapshotTempDirectory(
  directory: string,
  release?: SqliteStagingToken,
): void {
  const owner = snapshotDirectory(directory);
  owner.release = release ?? owner.release;
  pendingTempDirectoryCleanup.set(directory, owner);
  registerSnapshotCleanup();
}

function registerSnapshotCleanup(): void {
  if (!cleanupState.exitHandlerInstalled) {
    cleanupState.exitHandlerInstalled = true;
    process.once("exit", () => {
      for (const stop of activeSnapshotWork.values()) {
        stop();
      }
      // A surviving child retains its kernel token; the next owner reclaims it.
      if (activeSnapshotWork.size === 0) {
        for (const [pendingDir, owner] of snapshotDirectories) {
          removeTempDirectory(pendingDir, undefined, owner);
        }
      }
    });
  }
  registerSignalExitFinalizer(cleanupState.signalCleanup);
}

/** This owner joins token retirement and directory removal in its worker. */
export function registerRetainedSnapshotTempDirectory(
  directory: string,
  release: () => RetainedOperation<void>,
): void {
  snapshotDirectory(directory).releaseRetained = release;
  registerSnapshotCleanup();
}

/** Rejection is not retirement: only the reader's successful close releases custody. */
export function retainSnapshotTempDirectory(directory: string): () => void {
  registerSnapshotTempDirectory(directory);
  const owner = snapshotDirectory(directory);
  if (owner.retirementStarted) {
    throw new SqliteSnapshotCleanupError("SQLite snapshot retirement has started");
  }
  const reader = Symbol("sqlite.snapshot.reader");
  owner.readers.add(reader);
  return () => owner.readers.delete(reader);
}

/** A successful child hands its files to the caller's enclosing staging owner. */
export function releaseSnapshotTempDirectory(directory: string): void {
  const owner = findSnapshotDirectory(directory);
  assertSnapshotReadersRetired(owner);
  if (owner?.releaseRetained) {
    throw new SqliteSnapshotCleanupError("SQLite snapshot requires asynchronous cleanup");
  }
  owner?.release?.(false);
  releaseSnapshotDirectoryCustody(directory, owner);
}
const tempDirectoryRemovalOptions = {
  force: true,
  maxRetries: 3,
  recursive: true,
  retryDelay: 20,
} as const;

// Windows keeps a just-closed snapshot busy for a moment (scanners, indexers). Only those
// transient lock errors are retried, with backoff; anything else surfaces at once.
const removalBackoffMs = [20, 40, 80, 160, 320] as const;
const removalRetryCodes = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);
const removalBackoffCell = new Int32Array(new SharedArrayBuffer(4));

function removalBackoff(error: unknown, attempt: number): number | undefined {
  return removalRetryCodes.has(extractErrorCode(error) ?? "")
    ? removalBackoffMs.at(attempt)
    : undefined;
}

/** Blocking wait one snapshot's synchronous removal may spend in total, shared by all its paths. */
export type SyncRemovalBudget = { remainingMs: number };
const syncRemovalBudgetMs = removalBackoffMs.reduce((total, wait) => total + wait, 0);

export function createSyncRemovalBudget(): SyncRemovalBudget {
  return { remainingMs: syncRemovalBudgetMs };
}

/**
 * Synchronous removal of one snapshot path, retried only on transient lock errors. The shared budget caps
 * the total Atomics.wait for the whole snapshot at 620 ms, so many locked payload files cannot block the
 * caller for 620 ms each. A handle still open at rm time (the Windows EPERM case) outlasts the budget; the
 * deferred retry then removes the directory once the handle is released.
 */
function removeSnapshotPathSync(target: string, budget: SyncRemovalBudget): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.rmSync(target, tempDirectoryRemovalOptions);
      return;
    } catch (error) {
      const wait = removalBackoff(error, attempt);
      if (wait === undefined || wait > budget.remainingMs) {
        throw error;
      }
      budget.remainingMs -= wait;
      Atomics.wait(removalBackoffCell, 0, 0, wait);
    }
  }
}

/** Asynchronous removal of one snapshot path, retried only on transient lock errors. */
async function removeSnapshotPathAsync(target: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.promises.rm(target, tempDirectoryRemovalOptions);
      return;
    } catch (error) {
      const wait = removalBackoff(error, attempt);
      if (wait === undefined) {
        throw error;
      }
      await delay(wait);
    }
  }
}

// A removal that loses to a briefly-held Windows handle used to wait in memory until process exit.
// Only the transient lock codes retry, on an interval, and only for a bounded window. Any other error
// gives up at once. After the window the directory stays on disk and the age-based orphan sweep takes it
// over, because a claimed directory keeps its mtime.
export const deferredSnapshotRemovalPolicy = {
  intervalMs: 1_000,
  giveUpAfterMs: 10 * 60_000,
};
const deferredRemovalsInFlight = new Set<string>();
const deferredRemovalSince = new Map<string, number>();
let deferredRemovalTimer: ReturnType<typeof setInterval> | undefined;

function scheduleDeferredSnapshotRemoval(): void {
  if (deferredRemovalTimer) {
    return;
  }
  deferredRemovalTimer = setInterval(
    retryDeferredSnapshotRemovals,
    deferredSnapshotRemovalPolicy.intervalMs,
  );
  deferredRemovalTimer.unref?.();
}

function retryDeferredSnapshotRemovals(): void {
  if (pendingTempDirectoryCleanup.size === 0) {
    clearInterval(deferredRemovalTimer);
    deferredRemovalTimer = undefined;
    return;
  }
  for (const [directory, owner] of Array.from(pendingTempDirectoryCleanup)) {
    if (deferredRemovalsInFlight.has(directory)) {
      continue;
    }
    deferredRemovalsInFlight.add(directory);
    void retryDeferredSnapshotRemoval(directory, owner).finally(() => {
      deferredRemovalsInFlight.delete(directory);
    });
  }
}

async function retryDeferredSnapshotRemoval(
  directory: string,
  owner: SnapshotDirectory,
): Promise<void> {
  const since = deferredRemovalSince.get(directory) ?? Date.now();
  deferredRemovalSince.set(directory, since);
  let failure: unknown;
  const removed = await removeTempDirectoryAsync(
    directory,
    (error) => {
      failure = error;
    },
    owner,
  );
  if (removed) {
    deferredRemovalSince.delete(directory);
    return;
  }
  const code = extractErrorCode(failure);
  if (!removalRetryCodes.has(code ?? "")) {
    giveUpDeferredSnapshotRemoval(directory, owner, "non-transient error", code);
  } else if (Date.now() - since >= deferredSnapshotRemovalPolicy.giveUpAfterMs) {
    giveUpDeferredSnapshotRemoval(directory, owner, "retry window ended", code);
  }
}

function giveUpDeferredSnapshotRemoval(
  directory: string,
  owner: SnapshotDirectory,
  reason: string,
  code: string | undefined,
): void {
  deferredRemovalSince.delete(directory);
  try {
    owner.release?.();
  } catch {
    // The native token is released as far as it can be; the sweep reclaims the directory later.
  }
  owner.release = undefined;
  releaseSnapshotDirectoryCustody(directory, owner);
  getChildLogger({ subsystem: "infra/sqlite-snapshot" }).warn(
    { path: directory, errorCode: code, reason },
    "SQLite snapshot removal gave up for this process; the orphan sweep reclaims it once idle.",
  );
}

// A non-throwing cleanup-failure report emitted once per owner; a successful
// read is never turned into a failure by temp-file cleanup.
export type CleanupFailureReport = {
  cleanupRoot: string;
  operation: "rm";
  code: string | undefined;
};

function emitSnapshotCleanupFailure(
  report: CleanupFailureReport,
  onCleanupFailure?: (report: CleanupFailureReport) => void,
): void {
  if (onCleanupFailure) {
    try {
      onCleanupFailure(report);
      return;
    } catch {
      // A failed consumer diagnostic still belongs in the shared log sink.
    }
  }
  try {
    // File/diagnostic transports preserve subprocess stdout/stderr result contracts.
    getChildLogger({ subsystem: "infra/sqlite-snapshot" }).warn(
      { path: report.cleanupRoot, operation: report.operation, errorCode: report.code },
      "SQLite read-only snapshot cleanup failed. Check directory permissions and available storage before retrying.",
    );
  } catch {
    // Diagnostic failures must not replace the read's result or original error.
  }
}

function assertSnapshotReadersRetired(owner: SnapshotDirectory | undefined): void {
  if (owner?.readers.size) {
    throw new SqliteSnapshotCleanupError("SQLite snapshot still belongs to an active reader");
  }
}

function prepareSnapshotRetirement(directory: string, owner: SnapshotDirectory | undefined) {
  drainPendingSqliteSnapshotTokens(directory);
  assertSnapshotReadersRetired(owner);
  if (owner?.releaseRetained) {
    throw new SqliteSnapshotCleanupError("SQLite snapshot requires asynchronous cleanup");
  }
  if (
    owner?.retired ||
    (!owner?.release && !fs.existsSync(path.join(directory, SQLITE_STAGING_TOKEN_FILES[0])))
  ) {
    return undefined;
  }
  if (owner) {
    owner.retirementStarted = true;
  }
  return beginSqliteSnapshotRetirement(directory, { token: owner?.release });
}

/** Delete in the token process: owner death must stop unlinking when its locks disappear. */
export function retireSqliteSnapshotPayload(
  retirement: ReturnType<typeof beginSqliteSnapshotRetirement>,
  budget: SyncRemovalBudget = createSyncRemovalBudget(),
): void {
  for (const file of retirement.payload) {
    removeSnapshotPathSync(file, budget);
  }
  // Free copied bytes before SQLite allocates its retirement page/journal.
  // Controls stay intact until every marker commits and native handle closes.
  retirement.retire();
}

export function removeTempDirectory(
  tempDir: string,
  onFailure?: (error: unknown) => void,
  selectedOwner = findSnapshotDirectory(tempDir),
  budget: SyncRemovalBudget = createSyncRemovalBudget(),
): boolean {
  let owner = selectedOwner;
  try {
    if (owner?.removed) {
      releaseSnapshotDirectoryCustody(tempDir, owner);
      return true;
    }
    const retirement = prepareSnapshotRetirement(tempDir, owner);
    try {
      if (retirement) {
        retireSqliteSnapshotPayload(retirement, budget);
        owner = snapshotDirectory(tempDir);
        owner.release = undefined;
        owner.retired = true;
      }
      removeSnapshotPathSync(tempDir, budget);
    } finally {
      retirement?.release();
    }
    if (owner) {
      owner.removed = true;
    }
    releaseSnapshotDirectoryCustody(tempDir, owner);
    return true;
  } catch (error) {
    onFailure?.(error);
    registerSnapshotTempDirectory(tempDir);
    scheduleDeferredSnapshotRemoval();
    return false;
  }
}

export async function removeTempDirectoryAsync(
  tempDir: string,
  onFailure?: (error: unknown) => void,
  selectedOwner = findSnapshotDirectory(tempDir),
): Promise<boolean> {
  let owner = selectedOwner;
  if (owner?.removed) {
    releaseSnapshotDirectoryCustody(tempDir, owner);
    return true;
  }
  if (owner?.releaseRetained) {
    const removed = await startRemoveTempDirectory(tempDir, onFailure, owner).result;
    if (removed) {
      releaseSnapshotDirectoryCustody(tempDir, owner);
    }
    return removed;
  }
  try {
    assertSnapshotReadersRetired(owner);
    const retirement = prepareSnapshotRetirement(tempDir, owner);
    try {
      for (const file of retirement?.payload ?? []) {
        await retainSnapshotWork(removeSnapshotPathAsync(file));
      }
      if (retirement) {
        retirement.retire();
        owner = snapshotDirectory(tempDir);
        owner.release = undefined;
        owner.retired = true;
      }
      await retainSnapshotWork(removeSnapshotPathAsync(tempDir));
    } finally {
      retirement?.release();
    }
    if (owner) {
      owner.removed = true;
    }
    releaseSnapshotDirectoryCustody(tempDir, owner);
    return true;
  } catch (error) {
    onFailure?.(error);
    registerSnapshotTempDirectory(tempDir);
    scheduleDeferredSnapshotRemoval();
    return false;
  }
}

export function startRemoveTempDirectory(
  directory: string,
  onFailure?: (error: unknown) => void,
  owner = findSnapshotDirectory(directory),
): RetainedOperation<boolean> {
  if (owner?.retiringRetained) {
    return owner.retiringRetained;
  }
  let release: RetainedOperation<void> | undefined;
  const retained = createRetainedOperation<boolean>(() => {
    if (!release || retained.operation.read().status !== "pending") {
      return;
    }
    release.service();
    const outcome = release.read();
    if (outcome.status === "pending") {
      return;
    }
    if (owner) {
      owner.retiringRetained = undefined;
    }
    if (outcome.status === "rejected") {
      onFailure?.(outcome.error);
      retained.resolve(false);
    } else {
      if (owner) {
        owner.removed = true;
      }
      releaseSnapshotDirectoryCustody(directory, owner);
      retained.resolve(true);
    }
  });
  if (owner?.removed) {
    releaseSnapshotDirectoryCustody(directory, owner);
    retained.resolve(true);
    return retained.operation;
  }
  try {
    sealRetainedSnapshotTempDirectory(directory);
    if (!owner?.releaseRetained) {
      throw new SqliteSnapshotCleanupError("SQLite snapshot has no retained cleanup owner");
    }
    owner.retiringRetained = retained.operation;
    release = owner.releaseRetained();
    void release.result.then(
      () => retained.operation.service(),
      () => retained.operation.service(),
    );
    retained.operation.service();
  } catch (error) {
    if (owner) {
      owner.retiringRetained = undefined;
    }
    onFailure?.(error);
    retained.resolve(false);
  }
  return retained.operation;
}

/** A surviving native owner may retire bytes only after their original host readers leave. */
export function sealRetainedSnapshotTempDirectory(
  directory: string,
  options?: { requireRequested: true },
): void {
  const owner = snapshotDirectories.get(directory);
  if (!owner?.releaseRetained) {
    throw new SqliteSnapshotCleanupError("SQLite snapshot has no retained cleanup owner");
  }
  if (options?.requireRequested && !owner.retirementStarted) {
    throw new SqliteSnapshotCleanupError(
      "SQLite snapshot is still owned; cleanup has not been requested",
    );
  }
  assertSnapshotReadersRetired(owner);
  owner.retirementStarted = true;
}

export function adoptPreparedLocation(
  location: string,
  ownedRoot?: string,
  requireCleanup = false,
  onCleanupFailure?: (report: CleanupFailureReport) => void,
): PreparedSqliteReadOnlyLocation {
  return adoptRetainedPreparedLocation(location, ownedRoot, requireCleanup, onCleanupFailure);
}

export function adoptRetainedPreparedLocation(
  location: string,
  ownedRoot?: string,
  requireCleanup = false,
  onCleanupFailure?: (report: CleanupFailureReport) => void,
): PreparedSqliteReadOnlyLocation & RetainedPreparedSqliteReadOnlyLocation {
  const tempDir = ownedRoot ?? path.dirname(location);
  registerSnapshotTempDirectory(tempDir);
  const originalOwner = snapshotDirectory(tempDir);
  let active = true;
  let pending: Promise<boolean> | undefined;
  let retainedCleanup: RetainedOperation<boolean> | undefined;
  let reported = false;
  const reportFailure = (error: unknown) => {
    if (!requireCleanup && !reported) {
      reported = true;
      emitSnapshotCleanupFailure(
        { cleanupRoot: tempDir, operation: "rm", code: extractErrorCode(error) },
        onCleanupFailure,
      );
    }
  };
  const complete = (removed: boolean) => {
    if (removed) {
      active = false;
      releaseSnapshotDirectoryCustody(tempDir, originalOwner);
    } else if (requireCleanup) {
      throw new SqliteSnapshotCleanupError(
        `SQLite read-only worker snapshot cleanup failed: ${tempDir}`,
      );
    }
    return removed;
  };
  const startCleanup = (): RetainedOperation<boolean> => {
    if (retainedCleanup?.read().status === "pending") {
      return retainedCleanup;
    }
    let removal: RetainedOperation<boolean> | undefined;
    const retained = createRetainedOperation<boolean>(() => {
      if (!removal || retained.operation.read().status !== "pending") {
        return;
      }
      removal.service();
      const outcome = removal.read();
      if (outcome.status === "pending") {
        return;
      }
      try {
        if (outcome.status === "rejected") {
          throw outcome.error;
        }
        retained.resolve(complete(outcome.value));
      } catch (error) {
        retained.reject(error);
      }
    });
    retainedCleanup = retained.operation;
    if (!active || originalOwner.removed) {
      retained.resolve(complete(true));
    } else {
      removal = startRemoveTempDirectory(tempDir, reportFailure);
      void removal.result.then(
        () => retained.operation.service(),
        () => retained.operation.service(),
      );
      retained.operation.service();
    }
    return retained.operation;
  };
  return {
    location,
    cleanupRoot: tempDir,
    cleanup: () => {
      if (pending || retainedCleanup?.read().status === "pending") {
        // Pending async removal: return false without a false warning;
        // requireCleanup delegates to complete(false) for the fatal throw.
        return requireCleanup ? complete(false) : false;
      }
      if (!active || originalOwner.removed) {
        return complete(true);
      }
      return complete(removeTempDirectory(tempDir, reportFailure));
    },
    cleanupAsync: () => {
      if (findSnapshotDirectory(tempDir)?.releaseRetained || retainedCleanup) {
        return startCleanup().result;
      }
      if (pending) {
        return pending;
      }
      if (!active || originalOwner.removed) {
        return Promise.resolve(complete(true));
      }
      // Register ownership before invoking native removal; concurrent callers
      // join it, and synchronous callers cannot race or report early success.
      pending = Promise.resolve()
        .then(() => removeTempDirectoryAsync(tempDir, reportFailure, originalOwner))
        .then(complete)
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
    startCleanup,
  };
}
