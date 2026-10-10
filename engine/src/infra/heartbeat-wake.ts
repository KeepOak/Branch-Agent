import type { HeartbeatWakeHandler } from "./heartbeat-wake-contracts.js";
import { requestSessionEventWake, setSessionEventWakeHandler } from "./session-event-wake.js";

export type {
  HeartbeatRunResult,
  HeartbeatScheduledTask,
  HeartbeatWakeHandler,
  HeartbeatWakeIntent,
  HeartbeatWakeRequest,
  HeartbeatWakeSource,
} from "./heartbeat-wake-contracts.js";
export {
  requestSessionEventWakeAndWait as requestHeartbeatAndWait,
  areSessionEventWakesEnabled as areHeartbeatsEnabled,
  setSessionEventWakesEnabled as setHeartbeatsEnabled,
  getSessionEventWakeAbortSignal as getHeartbeatWakeAbortSignal,
  isRetryableSessionEventWakeReason as isRetryableHeartbeatSkipReason,
  SESSION_EVENT_IDLE_RETRY_MS as HEARTBEAT_IDLE_RETRY_GRACE_MS,
} from "./session-event-wake.js";

/** Public wake entry for every caller except the signal poller. A `signal` source is refused at runtime, so aliases and spread objects cannot bypass it. */
export function requestHeartbeat(options: Parameters<typeof requestSessionEventWake>[0]): void {
  if (options.source === "signal") {
    throw new Error(
      "signal wakes are internal to the signal poller; they must use requestSignalWake",
    );
  }
  requestSessionEventWake(options);
}

/** Internal entry for the signal poller dispatch only. A static test pins its importers. */
export function requestSignalWake(options: Parameters<typeof requestSessionEventWake>[0]): void {
  requestSessionEventWake(options);
}

export const HEARTBEAT_SKIP_REQUESTS_IN_FLIGHT = "requests-in-flight";
export const HEARTBEAT_SKIP_CRON_IN_PROGRESS = "cron-in-progress";
export const HEARTBEAT_SKIP_NO_PENDING_EVENT = "no-pending-event";
export const HEARTBEAT_SKIP_PREEMPTED = "preempted";
export const HEARTBEAT_SKIP_CHANNEL_NOT_READY = "channel-not-ready";

// Shipped SDK callers retain their one-argument handler.
export function setHeartbeatWakeHandler(next: HeartbeatWakeHandler | null): () => void {
  return setSessionEventWakeHandler(next ? (wake) => next(wake) : null);
}
