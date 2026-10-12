/** Resolves cron job wall-clock timeout policy. */
import { finiteSecondsToTimerSafeMilliseconds } from "@branch/normalization-core/number-coercion";
import type { CronJob } from "../types.js";

/**
 * Maximum wall-clock time for a single job execution. Acts as a safety net
 * on top of per-provider/per-agent timeouts to prevent one stuck job from
 * wedging the entire cron lane.
 */
const DEFAULT_JOB_TIMEOUT_MS = 10 * 60_000; // 10 minutes

/**
 * Agent turns can legitimately run much longer than generic cron jobs.
 * Use a larger safety ceiling when no explicit timeout is set.
 */
const AGENT_TURN_SAFETY_TIMEOUT_MS = 60 * 60_000; // 60 minutes

/** Resolves the wall-clock timeout for a cron job, including explicit detached-run overrides. */
export function resolveCronJobTimeoutMs(job: CronJob): number | undefined {
  const defaultTimeoutMs =
    job.payload.kind === "agentTurn" ? AGENT_TURN_SAFETY_TIMEOUT_MS : DEFAULT_JOB_TIMEOUT_MS;
  const timeoutSeconds =
    job.payload.kind === "agentTurn" ||
    job.payload.kind === "command" ||
    job.payload.kind === "script"
      ? job.payload.timeoutSeconds
      : undefined;
  if (typeof timeoutSeconds !== "number" || !Number.isFinite(timeoutSeconds)) {
    return defaultTimeoutMs;
  }
  // Only an explicit finite non-positive value requests an unlimited run.
  if (timeoutSeconds <= 0) {
    return undefined;
  }
  // Positive sub-millisecond values retain a deadline at Node's timer resolution.
  return finiteSecondsToTimerSafeMilliseconds(timeoutSeconds) ?? 1;
}