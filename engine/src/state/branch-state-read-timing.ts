import { AsyncLocalStorage } from "node:async_hooks";

/** Timing of one state read taken during agent admission. The read transport fills it when the read runs in a worker. */
export type BranchStateReadTiming = {
  label: string;
  /** Reads queued behind the worker pool when this read was enqueued. */
  queueDepth?: number;
  /** Labels of reads holding a worker slot when this read was enqueued. */
  holders?: string[];
  /** Time from enqueue to dispatch onto a worker, in milliseconds. */
  waitMs?: number;
  /** Time from dispatch to settlement, in milliseconds. */
  readMs?: number;
};

const timingScope = new AsyncLocalStorage<BranchStateReadTiming>();
const dispatchedReads = new Map<object, string>();

/** Runs a read with a timing record in scope; the transport fills the record it captures on enqueue. */
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

/** Fields for an admission read that took at least `thresholdMs`; undefined for faster reads. */
export function describeSlowBranchStateRead(
  timing: BranchStateReadTiming,
  totalMs: number,
  thresholdMs = 5_000,
): Record<string, unknown> | undefined {
  if (totalMs < thresholdMs) {
    return undefined;
  }
  return {
    readLabel: timing.label,
    totalMs: Math.round(totalMs),
    waitMs: timing.waitMs === undefined ? null : Math.round(timing.waitMs),
    readMs: timing.readMs === undefined ? null : Math.round(timing.readMs),
    queueDepth: timing.queueDepth ?? null,
    holders: timing.holders ?? [],
  };
}
