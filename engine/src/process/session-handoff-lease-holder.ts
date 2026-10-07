// The stepping-down engine's side of a per-session handoff lease (see session-handoff-lease-files.ts).
import {
  getCommandLaneSnapshot,
  listCommandLaneTotals,
  registerSessionLaneHandoffEnqueue,
} from "./command-queue.js";
import { GatewayDrainingError } from "./gateway-work-admission.js";
import { clearOwnSessionHandoffHold, noteOwnSessionHandoffHold } from "./session-handoff-lease-gate.js";
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
   * Resolves true SESSION_HANDOFF_LEASE_MAX_WAIT_MS (330 s) after the hold started while it still holds (a kept
   * session, or `hasPendingWork`), or false once it was released. At true the caller must stop the work it still runs in kept sessions (stop or
   * exit the process) before `expiresAt`, when successors run those sessions regardless.
   */
  readonly deadline: Promise<boolean>;
  /** When successors run the kept sessions regardless: the hold's start + SESSION_HANDOFF_LEASE_MAX_AGE_MS. */
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
/** The longest wait between attempts to remove a lease file something else keeps open. */
const STUCK_RETRY_MAX_MS = 5_000;

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
  let leftoverTimer: ReturnType<typeof setInterval> | undefined;
  /**
   * Released leases whose file could not be removed (Windows: antivirus holds it). They no longer keep the hold
   * open, since the session is done here and the file goes stale for successors once this process exits. They are
   * retried with backoff, one quick attempt at a time, until removed or expired (successors then delete them).
   */
  const stuck = new Map<string, { file: string; lease: SessionHandoffLease; retryAt: number; delayMs: number }>();
  const lease = (lane: string) => {
    if (!held.has(lane)) held.set(lane, writeSessionHandoffLease(dir, lane));
  };
  const retryStuck = (now = Date.now()) => {
    for (const [file, entry] of stuck) {
      if (now < entry.retryAt) continue;
      if (
        removeSessionHandoffLease(file, entry.lease, { once: true, quiet: true }) ||
        now >= sessionHandoffLeaseExpiresAt(entry.lease)
      ) {
        stuck.delete(file);
        continue;
      }
      entry.delayMs = Math.min(entry.delayMs * 2, STUCK_RETRY_MAX_MS);
      entry.retryAt = now + entry.delayMs;
    }
  };
  /** Removes a released lane's lease; one that could not be removed is retried later. */
  const releaseLane = (lane: string) => {
    const kept = held.get(lane);
    if (!kept) return;
    held.delete(lane);
    if (removeSessionHandoffLease(kept.file, kept.lease)) return;
    stuck.set(kept.file, { ...kept, retryAt: Date.now() + POLL_MS, delayMs: POLL_MS });
  };
  const releaseSync = () => {
    for (const lane of [...held.keys()]) releaseLane(lane);
  };
  const releaseAtExit = () => {
    releaseSync();
    for (const [file, entry] of stuck) removeSessionHandoffLease(file, entry.lease, { quiet: true });
  };
  const stopTimers = () => {
    if (timer) clearInterval(timer);
    if (deadlineTimer) clearTimeout(deadlineTimer);
    timer = undefined;
    deadlineTimer = undefined;
    if (stuck.size === 0) {
      process.off("exit", releaseAtExit);
      return;
    }
    leftoverTimer ??= setInterval(() => {
      retryStuck();
      if (stuck.size > 0) return;
      clearInterval(leftoverTimer);
      leftoverTimer = undefined;
      process.off("exit", releaseAtExit);
    }, POLL_MS);
    leftoverTimer.unref?.();
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
    for (const lane of [...held.keys()]) {
      if (!stillBusy(lane)) releaseLane(lane);
    }
    retryStuck();
    if (held.size === 0 && !pendingWork()) finish();
  };
  const onEnqueue = (lane: string) => {
    if (held.has(lane)) return;
    // Sealed: the state is (being) released, so a session this engine does not keep is its successor's now.
    if (sealed) throw new GatewayDrainingError();
    if (!finished && opts.leaseNewLanes) lease(lane);
  };
  try {
    for (const lane of opts.lanes ?? listBusySessionLanes()) {
      if (lane.startsWith(SESSION_LANE_PREFIX)) lease(lane);
    }
    unregisterEnqueue = registerSessionLaneHandoffEnqueue(onEnqueue);
  } catch (error) {
    releaseSync();
    unregisterEnqueue?.();
    throw error;
  }
  noteOwnSessionHandoffHold(holdStartedAt);
  const lanes = [...held.keys()];
  // An engine that exits with leases still held must not leave its successor waiting for a dead holder's files.
  process.once("exit", releaseAtExit);
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
      // A hold that already finished dropped its hook; a sealed engine still refuses unheld sessions until exit.
      unregisterEnqueue ??= registerSessionLaneHandoffEnqueue(onEnqueue);
    },
    releaseAll: () => {
      releaseSync();
      sealed = false;
      finished = false;
      finish();
      clearOwnSessionHandoffHold(holdStartedAt);
    },
  };
}
