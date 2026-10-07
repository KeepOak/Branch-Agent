// P45 engine handoff: the one table of deadlines both sides of the handoff use, kept in handoff-timeouts.json. The
// desktop reads it through the typed names below; the engine imports the same JSON file
// (`import timeouts from "<repo>/desktop/src/handoff-timeouts.json" with { type: "json" }`), so the two never drift.
// The bounds between the values are checked in desktop/scripts/handoff-timeouts.test.mjs.
import shared from "./handoff-timeouts.json";

/**
 * The longest a run in flight keeps its session on the old engine after a step-down. At this deadline the old
 * engine gives the session up and stops itself (engine session-handoff-lease-files.ts, #391).
 */
export const HANDOFF_LEASE_MAX_WAIT_MS: number = shared.leaseMaxWaitMs;

/** A lease older than this is stale: the new engine may take the session over (engine, #391). */
export const HANDOFF_LEASE_MAX_AGE_MS: number = shared.leaseMaxAgeMs;

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

/**
 * Engine: how long `branch-desktop:rollback` waits for the state lock before answering `ok:false`. The desktop kills
 * the standby (and waits for its exit) before it asks, so the lock is normally free at once.
 */
export const HANDOFF_ROLLBACK_LOCK_WAIT_MS: number = shared.rollbackLockWaitMs;

/** Desktop: how long it waits for `branch-desktop:rollback-result`; longer than the engine's lock wait. */
export const HANDOFF_ROLLBACK_TIMEOUT_MS: number = shared.rollbackTimeoutMs;

/**
 * Desktop: a retiring old engine still alive this long after its step-down is killed: past the lease deadline (its
 * own exit should have come by then) and before a lease turns stale, so two engines never write one session.
 */
export const HANDOFF_RETIRE_KILL_AFTER_MS: number = shared.retireKillAfterMs;
