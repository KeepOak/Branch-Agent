import { expectDefined } from "@branch/normalization-core";
import { isPromiseLike } from "@branch/normalization-core/promise-like";
import { isVitestRuntimeEnv } from "../../../infra/env.js";
import { SqliteSnapshotCleanupError } from "../../../infra/sqlite-readonly-location-cleanup.js";
import type { DatabasePathIdentity } from "../../../infra/sqlite-worker-identity.js";
import { getAsyncWorkSignal } from "../../../shared/async-work-scope.js";
import { freezeJsonSnapshot } from "../../../shared/immutable-data.js";
import {
  isStateDatabaseReadAdmissionInvalidatedError,
  type BranchStateDatabaseReadAdmission,
} from "../../../state/branch-state-db-async-lifecycle.js";
import {
  captureBranchStateDatabaseReadAdmission,
  branchStateDatabaseCache,
} from "../../../state/branch-state-db-cache.js";
import {
  executeExistingBranchStateRead,
  getActiveBranchStateDatabaseReadSnapshot,
} from "../../../state/branch-state-db-readonly.js";
import { resolveBranchStateSqlitePath } from "../../../state/branch-state-db.paths.js";
import type { BranchStateReadCommand } from "../../../state/branch-state-read.types.js";
import {
  captureBranchStateReadContext,
  captureBranchStateWorkerContext,
  type BranchStateReadContext,
} from "../../../state/branch-state-worker-context.js";
import type { BranchStateWorkerContext } from "../../../state/branch-state-worker-context.types.js";
import {
  hydrateBranchStateWorkerError,
  retainBranchStateWorkerErrorPayload,
} from "../../../state/branch-state-worker-error.js";
import { immutableSubagentRun } from "./subagent-registry-memory.js";
import type { SubagentRunReadRecord } from "./subagent-registry-read.types.js";
import { rememberSubagentRunVersion } from "./subagent-registry.store.codec.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";
import { SubagentSessionReadLookup } from "./subagent-session-read-scope.js";

type SubagentRunChange<T> = { entry: T | undefined };

type SubagentRunsCacheState<T extends SubagentRunReadRecord> = (
  | {
      snapshot: Map<string, T>;
      lookup?: SubagentSessionReadLookup;
      changes?: never;
    }
  | {
      snapshot?: undefined;
      lookup?: never;
      changes?: Map<string, SubagentRunChange<T>>;
    }
) & {
  admission?: BranchStateDatabaseReadAdmission;
  sourceIdentity?: string;
  retiredPublicationIdentity?: DatabasePathIdentity;
  pending?: {
    promise: Promise<void>;
    ownerAbortSignal?: AbortSignal;
    cleanCancellation?: boolean;
    committedRevision?: number;
  };
};

export type SubagentRunsCache<T extends SubagentRunReadRecord> = {
  state: SubagentRunsCacheState<T>;
  load?: () => Map<string, T>;
  copy: (entry: SubagentRunRecord) => T;
  project: (entry: SubagentRunRecord) => T;
};

export function getSessionListLookup<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  snapshot: Map<string, T>,
): SubagentSessionReadLookup {
  const state = cache.state;
  if (state.snapshot !== snapshot) {
    return new SubagentSessionReadLookup(snapshot);
  }
  return (state.lookup ??= new SubagentSessionReadLookup(snapshot));
}

export function indexedSnapshotRows<T>(snapshot: Map<string, T>, keys: readonly string[]): T[] {
  return keys.map((key) => expectDefined(snapshot.get(key), "indexed subagent cache entry"));
}

export function shouldReadPersistedSubagentRuns(): boolean {
  return !isVitestRuntimeEnv() || process.env.BRANCH_TEST_READ_SUBAGENT_RUNS_FROM_SQLITE === "1";
}

function captureSubagentFactsAdmission(databasePath = resolveBranchStateSqlitePath()) {
  return captureBranchStateDatabaseReadAdmission(databasePath);
}

function matchesSubagentCacheAdmission(
  previous: BranchStateDatabaseReadAdmission | undefined,
  current: BranchStateDatabaseReadAdmission | undefined,
): boolean {
  if (!previous) {
    return true;
  }
  if (!current || previous.identity.key !== current.identity.key) {
    return false;
  }
  try {
    previous.assertCurrent();
    return true;
  } catch {
    return false;
  }
}

function applySubagentRunChanges<T extends SubagentRunReadRecord>(
  runs: Map<string, T>,
  changes: Map<string, SubagentRunChange<T>> | undefined,
): Map<string, T> {
  for (const [runId, { entry }] of changes ?? []) {
    if (entry) {
      runs.set(runId, entry);
    } else {
      runs.delete(runId);
    }
  }
  return runs;
}

/** Selecting a read must not consume another database owner's publication. */
export function selectSubagentCacheStateForRead<T extends SubagentRunReadRecord>(
  state: SubagentRunsCacheState<T>,
  context?: Pick<BranchStateReadContext, "admission">,
): SubagentRunsCacheState<T> {
  const identity = state.retiredPublicationIdentity ?? state.admission?.identity;
  const matches = context
    ? !state.retiredPublicationIdentity &&
      matchesSubagentCacheAdmission(state.admission, context.admission) &&
      (state.sourceIdentity === undefined ||
        state.sourceIdentity === context.admission.identity.key)
    : !identity ||
      identity ===
        branchStateDatabaseCache.getKnownBranchStateDatabaseIdentity(
          resolveBranchStateSqlitePath(),
        );
  return matches ? state : {};
}

export function rememberSubagentRunsSnapshot<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  runs: Map<string, SubagentRunRecord>,
  changedRunIds: readonly string[] | undefined,
  databasePath?: string,
): void {
  let admission: BranchStateDatabaseReadAdmission | undefined;
  let retiredPublicationIdentity: DatabasePathIdentity | undefined;
  try {
    admission = captureSubagentFactsAdmission(databasePath);
  } catch (error) {
    if (!isStateDatabaseReadAdmissionInvalidatedError(error)) {
      throw error;
    }
    // Read retirement cannot turn committed publication into a write failure.
    if (!cache.load) {
      cache.state = {};
      return;
    }
    // Published full facts survive read retirement; this identity is provenance, not admission.
    retiredPublicationIdentity = expectDefined(
      branchStateDatabaseCache.getKnownBranchStateDatabaseIdentity(
        databasePath ?? resolveBranchStateSqlitePath(),
      ),
      "retired subagent registry publication identity",
    );
  }
  const previous = retiredPublicationIdentity
    ? (cache.state.retiredPublicationIdentity ?? cache.state.admission?.identity) ===
      retiredPublicationIdentity
      ? cache.state
      : {}
    : !cache.state.retiredPublicationIdentity &&
        matchesSubagentCacheAdmission(cache.state.admission, admission) &&
        (cache.state.sourceIdentity === undefined ||
          cache.state.sourceIdentity === admission?.identity.key)
      ? cache.state
      : {};
  const owner = {
    admission,
    sourceIdentity: admission?.identity.key ?? retiredPublicationIdentity?.key,
    retiredPublicationIdentity,
  };
  if (previous.pending?.committedRevision !== undefined) {
    previous.pending.committedRevision += 1;
  }
  const snapshot = previous.snapshot;
  if (!changedRunIds) {
    cache.state = {
      snapshot: new Map([...runs].map(([runId, entry]) => [runId, cache.copy(entry)])),
      ...owner,
      // Publication replaces facts, not custody of an accepted read and its cleanup.
      pending: previous.pending,
    };
    return;
  }
  if (!snapshot) {
    // Until the first full read, named writes cannot account for durable-only rows.
    const changes = previous.changes ?? new Map<string, SubagentRunChange<T>>();
    for (const runId of changedRunIds) {
      const entry = runs.get(runId);
      changes.set(runId, { entry: entry ? cache.copy(entry) : undefined });
    }
    cache.state = {
      changes,
      ...owner,
      pending: previous.pending,
    };
    return;
  }
  const lookup = previous.lookup;
  // A failed projection/update cannot leave derived membership ahead of its Map.
  previous.lookup = undefined;
  for (const runId of new Set(changedRunIds)) {
    const entry = runs.get(runId);
    if (entry) {
      snapshot.set(runId, cache.copy(entry));
    } else {
      snapshot.delete(runId);
    }
    lookup?.set(runId, snapshot.get(runId));
  }
  cache.state = {
    snapshot,
    ...owner,
    pending: previous.pending,
    ...(lookup ? { lookup } : {}),
  };
}

export function getPersistedSubagentRunsSnapshot<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  prepared?: BranchStateReadContext,
): Map<string, T> | null {
  let admission: BranchStateDatabaseReadAdmission | undefined;
  if (!cache.load) {
    const context = prepared ?? captureBranchStateReadContext();
    context.maintenanceScope?.assertAdmission();
    context.admission.assertCurrent();
    admission = context.admission;
  } else {
    try {
      admission = captureSubagentFactsAdmission();
    } catch (error) {
      if (!isStateDatabaseReadAdmissionInvalidatedError(error)) {
        throw error;
      }
      const state = selectSubagentCacheStateForRead(cache.state);
      return applySubagentRunChanges(new Map(state.snapshot), state.changes);
    }
  }
  if (
    cache.state.retiredPublicationIdentity ||
    !matchesSubagentCacheAdmission(cache.state.admission, admission) ||
    (admission && cache.state.sourceIdentity !== admission.identity.key)
  ) {
    if (!prepared) {
      cache.state = { admission, sourceIdentity: admission?.identity.key };
    }
    return null;
  }
  return cache.state.pending ? null : (cache.state.snapshot ?? null);
}

export function loadPersistedSubagentRunsForRead<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  prepared?: BranchStateReadContext,
): Map<string, T> {
  const cached = getPersistedSubagentRunsSnapshot(cache, prepared);
  if (cached) {
    return cached;
  }
  if (!cache.load) {
    throw new Error("Subagent session-list facts must be prepared before synchronous reads");
  }
  const runs = applySubagentRunChanges(cache.load(), cache.state.changes);
  runs.forEach(freezeJsonSnapshot);
  const admission = captureSubagentFactsAdmission();
  cache.state = {
    snapshot: runs,
    admission,
    sourceIdentity: admission?.identity.key,
  };
  return runs;
}

export function assertSubagentReadContext(context: BranchStateWorkerContext): void {
  getAsyncWorkSignal()?.throwIfAborted();
  context.maintenanceScope?.assertAdmission();
  context.admission.assertCurrent();
  const current = captureBranchStateReadContext();
  if (current.admission.identity.key !== context.admission.identity.key) {
    throw new Error("Subagent registry database changed during preparation");
  }
}

export function getSubagentRunsSnapshot<T extends SubagentRunReadRecord>(
  inMemoryRuns: Map<string, SubagentRunRecord>,
  cache: SubagentRunsCache<T>,
  scope?: {
    context?: BranchStateReadContext;
    load?: () => Iterable<T>;
    selectCached?: (lookup: SubagentSessionReadLookup) => readonly string[];
    fresh?: boolean;
    matches: (entry: SubagentRunReadRecord) => boolean;
  },
): Map<string, T> {
  if (
    shouldReadPersistedSubagentRuns() &&
    !cache.load &&
    !getPersistedSubagentRunsSnapshot(cache, scope?.context)
  ) {
    throw new Error("Subagent session-list facts must be prepared before synchronous reads");
  }
  const merged = new Map<string, T>();
  if (shouldReadPersistedSubagentRuns()) {
    try {
      // Scoped reads use indexed SQL until a complete owner snapshot is available.
      const cached =
        scope?.load && !scope.fresh ? getPersistedSubagentRunsSnapshot(cache, scope.context) : null;
      const cachedRows =
        cached && scope?.selectCached
          ? indexedSnapshotRows(cached, scope.selectCached(getSessionListLookup(cache, cached)))
          : cached?.values();
      const persisted = scope?.load
        ? (cachedRows ?? scope.load())
        : loadPersistedSubagentRunsForRead(cache, scope?.context).values();
      for (const entry of persisted) {
        if (!scope || scope.matches(entry)) {
          merged.set(entry.runId, entry);
        }
      }
    } catch {
      // Ignore disk read failures and fall back to local memory.
    }
  }
  if (shouldReadPersistedSubagentRuns()) {
    const state = selectSubagentCacheStateForRead(cache.state, scope?.context);
    for (const [runId, { entry }] of state.changes ?? []) {
      if (entry && (!scope || scope.matches(entry))) {
        merged.set(runId, entry);
      } else {
        merged.delete(runId);
      }
    }
  }
  for (const [runId, entry] of inMemoryRuns) {
    if (!scope || scope.matches(entry)) {
      merged.set(runId, cache.project(entry));
    } else {
      // Live memory wins even when a run moved out of the persisted scope.
      merged.delete(runId);
    }
  }
  return merged;
}

export class SubagentSessionListUnavailableError extends Error {}

export async function readCompactSubagentRuns(context: BranchStateWorkerContext) {
  const reply = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "subagents.sessionList" },
    { context },
  );
  if (!reply) {
    return new Map<string, SubagentRunReadRecord>();
  }
  if (!reply.ok || reply.type !== "subagents.sessionList") {
    throw new Error("Unexpected compact subagent registry read result");
  }
  if ("unavailable" in reply) {
    const failure = new Error(reply.unavailable.message);
    retainBranchStateWorkerErrorPayload(failure, reply.unavailable.error);
    throw new SubagentSessionListUnavailableError(reply.unavailable.message, {
      cause: hydrateBranchStateWorkerError(failure, { includeOrdinary: true }),
    });
  }
  reply.runs.forEach(freezeJsonSnapshot);
  return reply.runs;
}

export async function readFullSubagentRuns(
  context: BranchStateWorkerContext,
  scope: Extract<BranchStateReadCommand, { type: "subagents.runs" }>["scope"],
  options: { current?: boolean } = {},
) {
  if (scope.kind === "ids" && scope.runIds.length === 0) {
    assertSubagentReadContext(context);
    return new Map<string, SubagentRunRecord>();
  }
  const reply = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "subagents.runs", scope },
    options.current ? { context, current: true } : undefined,
  );
  assertSubagentReadContext(context);
  if (!reply) {
    return new Map<string, SubagentRunRecord>();
  }
  if (!reply.ok || reply.type !== "subagents.runs" || reply.projection === "maintenance") {
    throw new Error("Unexpected subagent registry read result");
  }
  if (
    options.current &&
    scope.kind === "all" &&
    reply.versions &&
    [...reply.versions].some(([runId, version]) => version !== null && !reply.runs.has(runId))
  ) {
    throw new Error("Canonical subagent restore found an unreadable durable row");
  }
  for (const [runId, entry] of reply.runs) {
    const version = reply.versions?.get(runId);
    if (version) {
      rememberSubagentRunVersion(entry, version);
    }
    immutableSubagentRun(entry);
  }
  return reply.runs;
}

export async function prepareSubagentRunsCache<T extends SubagentRunReadRecord>(
  cache: SubagentRunsCache<T>,
  load: (context: BranchStateWorkerContext) => Promise<Map<string, T>>,
  prepared?: BranchStateWorkerContext,
): Promise<Map<string, T>> {
  const context = prepared ?? captureBranchStateWorkerContext();
  const assertCurrent = () => {
    if (!prepared) {
      assertSubagentReadContext(context);
      return;
    }
    getAsyncWorkSignal()?.throwIfAborted();
    context.maintenanceScope?.assertAdmission();
    context.admission.assertCurrent();
  };
  assertCurrent();
  if (
    getActiveBranchStateDatabaseReadSnapshot({
      path: context.admission.databasePath,
      env: context.environment,
    })
  ) {
    // Private snapshot bytes never become canonical resident facts.
    const runs = await load(context);
    assertCurrent();
    return runs;
  }
  const callerAbortSignal = getAsyncWorkSignal();
  let retriedCanceledFill = false;
  while (true) {
    assertCurrent();
    let state = cache.state;
    if (
      !matchesSubagentCacheAdmission(state.admission, context.admission) ||
      (state.sourceIdentity !== undefined &&
        state.sourceIdentity !== context.admission.identity.key)
    ) {
      cache.state = state = {
        admission: captureSubagentFactsAdmission(context.admission.databasePath),
        sourceIdentity: context.admission.identity.key,
      };
    }
    if (state.snapshot && !state.pending) {
      return state.snapshot;
    }
    if (!state.pending) {
      const sourceIdentity = context.admission.identity.key;
      // Readiness checks must recognize the pending fill before its facts exist.
      state.admission = captureSubagentFactsAdmission(context.admission.databasePath);
      state.sourceIdentity = sourceIdentity;
      const fill: NonNullable<SubagentRunsCacheState<T>["pending"]> = {
        ownerAbortSignal: callerAbortSignal,
        promise: Promise.resolve().then(async () => {
          const runs = await load(context);
          try {
            assertCurrent();
          } catch (error) {
            // Classify only after successful read cleanup, before waiters observe rejection.
            fill.cleanCancellation =
              fill.ownerAbortSignal?.aborted === true &&
              error === fill.ownerAbortSignal.reason &&
              !(error instanceof AggregateError) &&
              !isStateDatabaseReadAdmissionInvalidatedError(error) &&
              !(error instanceof SqliteSnapshotCleanupError);
            throw error;
          }
          // A newer full publication wins, but its readers still join this fill.
          if (cache.state.pending === fill && !cache.state.snapshot) {
            const admission = captureSubagentFactsAdmission(context.admission.databasePath);
            cache.state =
              sourceIdentity === admission.identity.key
                ? {
                    snapshot: applySubagentRunChanges(runs, cache.state.changes),
                    admission,
                    sourceIdentity,
                  }
                : {
                    changes: cache.state.changes,
                    admission,
                    sourceIdentity: admission.identity.key,
                  };
          }
        }),
      };
      state.pending = fill;
    }
    const fill = state.pending;
    try {
      await fill.promise;
    } catch (error) {
      if (
        !fill.cleanCancellation ||
        fill.ownerAbortSignal === callerAbortSignal ||
        retriedCanceledFill
      ) {
        throw error;
      }
      assertCurrent();
      retriedCanceledFill = true;
    } finally {
      if (cache.state.pending === fill) {
        cache.state.pending = undefined;
      }
    }
    if (
      prepared &&
      cache.state.sourceIdentity !== undefined &&
      cache.state.sourceIdentity !== context.admission.identity.key
    ) {
      throw new Error("Subagent registry database changed during preparation");
    }
  }
}

/** Restore consumes durable rows before another host publication can overtake the accepted read. */
export async function consumeFreshSubagentRuns<T>(
  cache: SubagentRunsCache<SubagentRunRecord>,
  context: BranchStateWorkerContext,
  consume: (runs: Map<string, SubagentRunRecord>) => T,
): Promise<T> {
  assertSubagentReadContext(context);
  while (cache.state.pending) {
    await cache.state.pending.promise;
    assertSubagentReadContext(context);
  }
  const previous = selectSubagentCacheStateForRead(cache.state, context);
  const state = {
    ...previous,
    admission: captureSubagentFactsAdmission(context.admission.databasePath),
    sourceIdentity: context.admission.identity.key,
  };
  cache.state = state;
  let result: T;
  const fill: NonNullable<SubagentRunsCacheState<SubagentRunRecord>["pending"]> = {
    committedRevision: 0,
    promise: Promise.resolve().then(async () => {
      while (true) {
        assertSubagentReadContext(context);
        const revision = fill.committedRevision;
        const runs = await readFullSubagentRuns(context, { kind: "all" }, { current: true });
        assertSubagentReadContext(context);
        if (cache.state.pending !== fill) {
          throw new Error("Subagent restore lost its accepted read owner");
        }
        if (revision !== fill.committedRevision) {
          continue;
        }
        // A committed deletion invalidates the read above. Consume and publish
        // without another asynchronous boundary.
        result = consumeSubagentRuns(runs, () => consume(runs));
        return;
      }
    }),
  };
  state.pending = fill;
  try {
    await fill.promise;
    return result!;
  } finally {
    if (cache.state.pending === fill) {
      cache.state.pending = undefined;
    }
  }
}

export function acceptedFullSnapshot(
  cache: SubagentRunsCache<SubagentRunRecord>,
  context: BranchStateWorkerContext,
) {
  const state = cache.state;
  return !state.retiredPublicationIdentity &&
    !getActiveBranchStateDatabaseReadSnapshot({
      path: context.admission.databasePath,
      env: context.environment,
    }) &&
    state.sourceIdentity === context.admission.identity.key &&
    matchesSubagentCacheAdmission(state.admission, context.admission)
    ? state.snapshot
    : undefined;
}

export function consumeSubagentRuns<T>(
  runs: Map<string, SubagentRunRecord>,
  consume: (runs: ReadonlyMap<string, SubagentRunRecord>) => T,
): T {
  getAsyncWorkSignal()?.throwIfAborted();
  const result = consume(runs);
  if (isPromiseLike(result)) {
    void Promise.resolve(result).catch(() => {});
    throw new Error("Subagent registry read consumers must remain synchronous");
  }
  return result;
}

export function mergeSelectedFullRuns(
  cache: SubagentRunsCache<SubagentRunRecord>,
  inMemoryRuns: Map<string, SubagentRunRecord>,
  persisted: Map<string, SubagentRunRecord>,
  matches: (entry: SubagentRunReadRecord) => boolean,
  {
    context,
    runIds,
    freshPersisted = false,
  }: {
    context?: BranchStateWorkerContext;
    runIds?: ReadonlySet<string>;
    freshPersisted?: boolean;
  } = {},
): Map<string, SubagentRunRecord> {
  const current = context && !freshPersisted ? acceptedFullSnapshot(cache, context) : undefined;
  const merged = new Map<string, SubagentRunRecord>();
  for (const [runId, entry] of selectedEntries(current ?? persisted, runIds)) {
    if (matches(entry)) {
      merged.set(runId, entry);
    }
  }
  const state = selectSubagentCacheStateForRead(cache.state, context);
  if (
    context &&
    !freshPersisted &&
    !getActiveBranchStateDatabaseReadSnapshot({
      path: context.admission.databasePath,
      env: context.environment,
    }) &&
    state.sourceIdentity === context.admission.identity.key &&
    matchesSubagentCacheAdmission(state.admission, context.admission)
  ) {
    for (const [runId, { entry }] of state.changes ? selectedEntries(state.changes, runIds) : []) {
      if (entry && matches(entry)) {
        merged.set(runId, entry);
      } else {
        merged.delete(runId);
      }
    }
  }
  for (const [runId, entry] of selectedEntries(inMemoryRuns, runIds)) {
    if (matches(entry)) {
      merged.set(runId, entry);
    } else {
      merged.delete(runId);
    }
  }
  return merged;
}

function* selectedEntries<T>(
  rows: ReadonlyMap<string, T>,
  runIds?: ReadonlySet<string>,
): Iterable<[string, T]> {
  if (!runIds) {
    yield* rows;
    return;
  }
  for (const runId of runIds) {
    const entry = rows.get(runId);
    if (entry !== undefined) {
      yield [runId, entry];
    }
  }
}
