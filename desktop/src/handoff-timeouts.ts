// P45 desktop handoff deadlines. Engine-only lease bounds are intentionally not duplicated here.
import shared from "./handoff-timeouts.json";

/**
 * Desktop: how long the old engine gets to answer `branch-desktop:deactivate` (stop channels and cron, lease busy
 * sessions, release the state). Engine: a step-down must answer well within this.
 */
export const HANDOFF_STEP_DOWN_TIMEOUT_MS: number = shared.stepDownTimeoutMs;

/** Desktop: how long a told standby gets to answer `branch-desktop:taking-over` once the state is free. */
export const HANDOFF_TAKE_OVER_TIMEOUT_MS: number = shared.takeOverTimeoutMs;

/**
 * Desktop: how long a standby that took over gets to answer /readyz on its port. Well under the lease deadline, so
 * the old engine can still take control back if the standby never becomes ready.
 */
export const HANDOFF_STANDBY_READY_TIMEOUT_MS: number = shared.standbyReadyTimeoutMs;

/** Desktop: how long it waits for `branch-desktop:rollback-result`. */
export const HANDOFF_ROLLBACK_TIMEOUT_MS: number = shared.rollbackTimeoutMs;

/**
 * Desktop: a retiring old engine still alive this long after step-down was sent is killed: past the lease deadline (its
 * own exit should have come by then) and before a lease turns stale, so two engines never write one session.
 */
export const HANDOFF_RETIRE_KILL_AFTER_MS: number = shared.retireKillAfterMs;
