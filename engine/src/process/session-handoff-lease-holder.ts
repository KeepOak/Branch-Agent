// The stepping-down engine's side of a per-session handoff lease (see session-handoff-lease-files.ts).
import {
  getCommandLaneSnapshot,
  listCommandLaneTotals,
  registerSessionLaneHandoffEnqueue,
} from "./command-queue.js";
import { GatewayDrainingError } from "./gateway-work-admission.js";
import {
  removeSessionHandoffLease,
  resolveSessionHandoffLeaseDir,
  SESSION_HANDOFF_LEASE_MAX_AGE_MS,
  SESSION_HANDOFF_LEASE_MAX_WAIT_MS,
  SESSION_LANE_PREFIX,
  type SessionHandoffLease,
  sessionHandoffLeaseExpiresAt,
  writeSessionHandoffLease,
} from "./session-handoff-lease-files.js";

export type SessionHandoffLeaseHold = {
  /** The session lanes this engine kept when the hold started (later ones from `leaseNewLanes` are not listed). */
  readonly lanes: readonly string[];
  /** Resolves once every kept session was released (and `hasPendingWork` reports none). */
  readonly released: Promise<void>;
  /**
   * Resolves true SESSION_HANDOFF_LEASE_MAX_WAIT_MS (330 s) after the hold started while sessions are still kept, or
   * false once they were all released. At true the caller must stop the work it still runs in kept sessions (stop or
   * exit the process) before `expiresAt`, when successors run those sessions regardless.
   */
  readonly deadline: Promise<boolean>;
  /** When the first kept lease expires for successors (its acquiredAt + SESSION_HANDOFF_LEASE_MAX_AGE_MS). */
  readonly expiresAt: number;
  /**
   * Stops leasing new sessions; from then on work for a session this hold does not keep is refused with
   * GatewayDrainingError. Call it right before the state is released, so successors see every lease.
   */
  seal(): void;
  /** Releases every lease still held now (shutdown, or the handoff was called off). */
  releaseAll(): void;
};

const POLL_MS = 100;

/**
 * The default test of "still in flight": a task runs in the session's lane or waits for it (including turns parked
 * behind another engine's lease). A caller that knows more about a run's last writes passes its own `isBusy`.
 */
export function isSessionLaneBusy(lane: string): boolean {
  const snapshot = getCommandLaneSnapshot(lane);
  return snapshot.activeCount + snapshot.queuedCount > 0;
}

export function listBusySessionLanes(): string[] {
  return listCommandLaneTotals()
    .filter(
      ({ lane, activeCount, queuedCount }) =>
        lane.startsWith(SESSION_LANE_PREFIX) && activeCount + queuedCount > 0,
    )
    .map(({ lane }) => lane);
}

/**
 * Called by the engine stepping down, before it releases the state to its successor: keeps a lease on every session
 * with a run in flight or queued here, and releases each one as soon as that session is no longer busy. With
 * `leaseNewLanes`, a session that receives work during the step-down is leased too, until `seal()`. The successor
 * takes every other session at once. The caller has already closed admission for new work.
 */
export function holdSessionHandoffLeases(
  opts: {
    lanes?: readonly string[];
    isBusy?: (lane: string) => boolean;
    /** Work not yet tied to a session (it keeps `released` from resolving while it reports true). */
    hasPendingWork?: () => boolean;
    /** Lease sessions that receive work after the hold started, until `seal()`. */
    leaseNewLanes?: boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): SessionHandoffLeaseHold {
  const isBusy = opts.isBusy ?? isSessionLaneBusy;
  const dir = resolveSessionHandoffLeaseDir(opts.env);
  const holdStartedAt = Date.now();
  const held = new Map<string, { file: string; lease: SessionHandoffLease }>();
  let resolveReleased!: () => void;
  const released = new Promise<void>((resolve) => {
    resolveReleased = resolve;
  });
  let resolveDeadline!: (elapsed: boolean) => void;
  const deadline = new Promise<boolean>((resolve) => {
    resolveDeadline = resolve;
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let unregisterEnqueue: (() => void) | undefined;
  let sealed = false;
  let finished = false;
  const lease = (lane: string) => {
    if (!held.has(lane)) held.set(lane, writeSessionHandoffLease(dir, lane));
  };
  const releaseSync = () => {
    for (const [lane, { file, lease: written }] of held) {
      removeSessionHandoffLease(file, written);
      held.delete(lane);
    }
  };
  const stopTimers = () => {
    if (timer) clearInterval(timer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    timer = undefined;
    deadlineTimer = undefined;
    process.off("exit", releaseSync);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    stopTimers();
    // A sealed engine keeps refusing new sessions until it exits; otherwise the hook goes with the hold.
    if (!sealed) {
      unregisterEnqueue?.();
      unregisterEnqueue = undefined;
    }
    resolveReleased();
    resolveDeadline(false);
  };
  const stillBusy = (lane: string) => {
    try {
      return isBusy(lane);
    } catch {
      return true; // An unanswerable busy test keeps the session until the deadline.
    }
  };
  const pendingWork = () => {
    try {
      return opts.hasPendingWork?.() ?? false;
    } catch {
      return true;
    }
  };
  const poll = () => {
    for (const [lane, { file, lease: written }] of held) {
      if (stillBusy(lane)) continue;
      removeSessionHandoffLease(file, written);
      held.delete(lane);
    }
    if (held.size === 0 && !pendingWork()) finish();
  };
  try {
    for (const lane of opts.lanes ?? listBusySessionLanes()) {
      if (lane.startsWith(SESSION_LANE_PREFIX)) lease(lane);
    }
    unregisterEnqueue = registerSessionLaneHandoffEnqueue((lane) => {
      if (held.has(lane)) return;
      // Sealed: the state is (being) released, so a session this engine does not keep is its successor's now.
      if (sealed) throw new GatewayDrainingError();
      if (!finished && opts.leaseNewLanes) lease(lane);
    });
  } catch (error) {
    releaseSync();
    unregisterEnqueue?.();
    throw error;
  }
  const lanes = [...held.keys()];
  // An engine that exits with leases still held must not leave its successor waiting for a dead holder's files.
  process.once("exit", releaseSync);
  // Kept referenced: the stepping-down engine stays up until it has released every session it kept.
  timer = setInterval(poll, POLL_MS);
  deadlineTimer = setTimeout(() => resolveDeadline(true), SESSION_HANDOFF_LEASE_MAX_WAIT_MS);
  poll();
  return {
    lanes,
    released,
    deadline,
    get expiresAt() {
      return Math.min(
        holdStartedAt + SESSION_HANDOFF_LEASE_MAX_AGE_MS,
        ...[...held.values()].map(({ lease: written }) => sessionHandoffLeaseExpiresAt(written)),
      );
    },
    seal: () => {
      sealed = true;
    },
    releaseAll: () => {
      releaseSync();
      sealed = false;
      finished = false;
      finish();
    },
  };
}
