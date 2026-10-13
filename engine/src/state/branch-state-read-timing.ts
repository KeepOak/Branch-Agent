import { AsyncLocalStorage } from "node:async_hooks";

/** Timing of one read task in the state read worker pool. */
export type BranchStateTaskTiming = {
  /** Tasks queued behind the read pool when this task was enqueued. */
  queueDepth?: number;
  /** Labels of reads holding a worker slot when this task was enqueued. */
  holders?: string[];
  /** Time from enqueue to dispatch onto a worker, in milliseconds. */
  waitMs?: number;
  /** Time from dispatch to reply, in milliseconds. */
  readMs?: number;
  /** Whether the read pool created a worker while this task was queued or running. */
  workerSpawned?: boolean;
};

/** Timing of one read during agent admission. The read transport and the operation fill it as the read runs. */
export type BranchStateReadTiming = {
  label: string;
  /** The freshness check that runs before an artifact-preserving read. */
  validate?: BranchStateTaskTiming;
  /** The snapshot copy of an artifact-preserving read, from start to ready. */
  snapshot?: { ms: number; bytes: number };
  /** The read task itself. */
  query?: BranchStateTaskTiming;
};

const timingScope = new AsyncLocalStorage<BranchStateReadTiming>();
const dispatchedReads = new Map<object, string>();

/** Runs a read with a timing record in scope; the transport and the operation fill the record they capture. */
export function runWithBranchStateReadTiming<T>(timing: BranchStateReadTiming, run: () => T): T {
  return timingScope.run(timing, run);
}

export function getBranchStateReadTiming(): BranchStateReadTiming | undefined {
  return timingScope.getStore();
}

/** Labels of the reads that currently hold a worker slot. */
export function listDispatchedBranchStateReads(): string[] {
  return [...dispatchedReads.values()];
}

export function markBranchStateReadDispatched(token: object, label: string): void {
  dispatchedReads.set(token, label);
}

export function markBranchStateReadSettled(token: object): void {
  dispatchedReads.delete(token);
}

function sumDefined(...values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length ? defined.reduce((total, value) => total + value, 0) : undefined;
}

function rounded(value: number | undefined): number | null {
  return value === undefined ? null : Math.round(value);
}

/**
 * Fields for an admission read that took at least `thresholdMs`; undefined for faster reads.
 * `otherMs` is the part of the total that no recorded phase accounts for.
 */
export function describeSlowBranchStateRead(
  timing: BranchStateReadTiming,
  totalMs: number,
  thresholdMs = 5_000,
): Record<string, unknown> | undefined {
  if (totalMs < thresholdMs) {
    return undefined;
  }
  const validateMs = sumDefined(timing.validate?.waitMs, timing.validate?.readMs);
  const queryMs = sumDefined(timing.query?.waitMs, timing.query?.readMs);
  const accounted = (validateMs ?? 0) + (timing.snapshot?.ms ?? 0) + (queryMs ?? 0);
  return {
    readLabel: timing.label,
    totalMs: Math.round(totalMs),
    validateMs: rounded(validateMs),
    validateWaitMs: rounded(timing.validate?.waitMs),
    validateSpawned: timing.validate?.workerSpawned ?? null,
    snapshotMs: rounded(timing.snapshot?.ms),
    snapshotBytes: timing.snapshot?.bytes ?? null,
    queryWaitMs: rounded(timing.query?.waitMs),
    queryReadMs: rounded(timing.query?.readMs),
    queryQueueDepth: timing.query?.queueDepth ?? null,
    queryHolders: timing.query?.holders ?? [],
    querySpawned: timing.query?.workerSpawned ?? null,
    otherMs: Math.max(0, Math.round(totalMs - accounted)),
  };
}
