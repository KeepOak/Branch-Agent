/** Adapted from OpenHands/OpenHands@a8c05584ec6bb063a0857460b9cbff48e136919f
 * src/manifests/automation-insights.ts summarizeAutomationRuns.
 * Metrics describe the authorized returned sample; partial pages never imply lifetime totals.
 */
import type { CronRunLogEntry } from "./run-log-types.js";

export type CronRunInsights = {
  sampleSize: number;
  terminalSampleSize: number;
  successfulSampleSize: number;
  completedTotal: number | null;
  recentSuccessRate: number | null;
  averageDurationMs: number | null;
};

export function summarizeCronRuns(page: {
  entries: readonly CronRunLogEntry[];
  total: number;
  offset: number;
}): CronRunInsights {
  const terminal = page.entries.filter(
    (entry) => entry.status === "ok" || entry.status === "error",
  );
  // Completion facts distinguish a settled run from successfully completed work.
  const completed = terminal.filter(
    (entry) =>
      entry.status === "ok" &&
      entry.completionStatus !== "failed" &&
      entry.completionStatus !== "unknown",
  ).length;
  const durations = terminal.flatMap((entry) =>
    typeof entry.durationMs === "number" &&
    Number.isFinite(entry.durationMs) &&
    entry.durationMs >= 0
      ? [entry.durationMs]
      : [],
  );
  return {
    sampleSize: page.entries.length,
    terminalSampleSize: terminal.length,
    successfulSampleSize: completed,
    completedTotal: page.offset === 0 && page.total <= page.entries.length ? completed : null,
    recentSuccessRate: terminal.length === 0 ? null : completed / terminal.length,
    averageDurationMs:
      durations.length === 0 ? null : durations.reduce((sum, ms) => sum + ms, 0) / durations.length,
  };
}
