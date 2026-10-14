// Private #951: readiness budgets come from this host's measured cold start, never below a floor, not a flat 120 s.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { ADMISSION_ROLLBACK_AFTER_MS } from "./agent-admission";
import { HANDOFF_RETIRE_KILL_AFTER_MS, HANDOFF_ROLLBACK_TIMEOUT_MS, HANDOFF_STANDBY_READY_TIMEOUT_MS, HANDOFF_STEP_DOWN_TIMEOUT_MS, HANDOFF_TAKE_OVER_TIMEOUT_MS } from "./handoff-timeouts";

/** The recent cold starts kept per host; the slowest of them sizes the budget. */
export const COLD_START_SAMPLES = 5;
/** Room over the slowest measured cold start, so a start a little slower than any seen still fits. */
export const COLD_START_HEADROOM = 1.5;
/** Margin kept between the standby's readiness budget and the old engine's retire deadline. */
const RETIRE_MARGIN_MS = 15_000;

/**
 * The most a standby that took over may wait for /readyz: the old engine must still be able to take control back
 * before its retire timer (started at step-down) kills it, even when step-down, take-over and rollback all run long.
 */
export const STANDBY_READY_CEILING_MS = Math.max(HANDOFF_STANDBY_READY_TIMEOUT_MS,
  HANDOFF_RETIRE_KILL_AFTER_MS - HANDOFF_STEP_DOWN_TIMEOUT_MS - HANDOFF_TAKE_OVER_TIMEOUT_MS - HANDOFF_ROLLBACK_TIMEOUT_MS - RETIRE_MARGIN_MS);

/** The longest a swapped engine's agents may stay refused before the automatic rollback, however slow the host. */
export const ADMISSION_ROLLBACK_CEILING_MS = 30 * 60_000;

/** The recorded cold starts in ms, oldest first; a missing or damaged file reads as none. */
export function readColdStarts(file: string): number[] {
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as { samplesMs?: unknown };
    if (!Array.isArray(value.samplesMs)) return [];
    return value.samplesMs.filter((ms): ms is number => Number.isSafeInteger(ms) && ms > 0).slice(-COLD_START_SAMPLES);
  } catch {
    return [];
  }
}

/** Adds one measured cold start (spawn to /readyz) and keeps the last COLD_START_SAMPLES. */
export function recordColdStart(file: string, ms: number): number[] {
  const samplesMs = readColdStarts(file);
  if (!Number.isFinite(ms) || ms <= 0) return samplesMs;
  const next = [...samplesMs, Math.round(ms)].slice(-COLD_START_SAMPLES);
  writeFileSync(`${file}.tmp`, JSON.stringify({ samplesMs: next }));
  renameSync(`${file}.tmp`, file);
  return next;
}

/** COLD_START_HEADROOM over the slowest recent cold start, never under floorMs nor over ceilingMs. */
export function measuredBudgetMs(samplesMs: readonly number[], bounds: { floorMs: number; ceilingMs: number }): number {
  const slowest = samplesMs.reduce((max, ms) => Math.max(max, ms), 0);
  const ceiling = Math.max(bounds.floorMs, bounds.ceilingMs);
  return Math.min(ceiling, Math.max(bounds.floorMs, Math.ceil(slowest * COLD_START_HEADROOM)));
}

/** How long a standby that took over gets to answer /readyz on this host (floor: the shared 120 s deadline). */
export function standbyReadyBudgetMs(samplesMs: readonly number[]): number {
  return measuredBudgetMs(samplesMs, { floorMs: HANDOFF_STANDBY_READY_TIMEOUT_MS, ceilingMs: STANDBY_READY_CEILING_MS });
}

/** How long agents may stay refused after a swap before it rolls back (floor: the 10 minutes from #951 part 2). */
export function admissionRollbackBudgetMs(samplesMs: readonly number[]): number {
  return measuredBudgetMs(samplesMs, { floorMs: ADMISSION_ROLLBACK_AFTER_MS, ceilingMs: ADMISSION_ROLLBACK_CEILING_MS });
}
