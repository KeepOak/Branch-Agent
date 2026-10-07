import type { BranchConfig } from "../../config/types.branch.js";

const DEFAULT_AUTO_CONTINUE_FRESHNESS_MS = 60 * 60 * 1_000;

/** Hermes' one-hour auto-continue window; nonpositive values disable the cutoff. */
export function isFreshRestartInterruption(params: {
  timestamp: number | undefined;
  now: number;
  cfg?: BranchConfig;
}): boolean {
  const seconds = params.cfg?.gateway?.autoContinueFreshnessSeconds;
  const windowMs =
    typeof seconds === "number" && Number.isFinite(seconds)
      ? seconds * 1_000
      : DEFAULT_AUTO_CONTINUE_FRESHNESS_MS;
  return (
    windowMs <= 0 ||
    params.timestamp === undefined ||
    !Number.isFinite(params.timestamp) ||
    params.now - params.timestamp <= windowMs
  );
}
