// The stepping-down engine's side of a per-session handoff lease (see session-handoff-lease-files.ts).
import { getCommandLaneSnapshot, listCommandLaneTotals } from "./command-queue.js";
import {
  removeSessionHandoffLease,
  resolveSessionHandoffLeaseDir,
  SESSION_LANE_PREFIX,
  type SessionHandoffLease,
  writeSessionHandoffLease,
} from "./session-handoff-lease-files.js";

export type SessionHandoffLeaseHold = {
  /** The session lanes this engine kept. */
  readonly lanes: readonly string[];
  /** Resolves once every kept session was released. */
  readonly released: Promise<void>;
  /** Releases every lease still held now (shutdown, or the handoff was called off). */
  releaseAll(): void;
};

const POLL_MS = 100;

/**
 * The default test of "still in flight": a task runs in the session's lane or waits for it. A caller that knows more
 * about a run's last writes (for example the gateway's terminal persistence) passes its own `isBusy`.
 */
export function isSessionLaneBusy(lane: string): boolean {
  const snapshot = getCommandLaneSnapshot(lane);
  return snapshot.activeCount + snapshot.queuedCount > 0;
}

export function listBusySessionLanes(): string[] {
  return listCommandLaneTotals()
    .filter(({ lane, activeCount, queuedCount }) => lane.startsWith(SESSION_LANE_PREFIX) && activeCount + queuedCount > 0)
    .map(({ lane }) => lane);
}

/**
 * Called by the engine stepping down, before it releases the state to its successor: keeps a lease on every session
 * with a run in flight or queued here, and releases each one as soon as that session's lane has drained. The
 * successor takes every other session at once. The caller has already closed admission for new work.
 */
export function holdSessionHandoffLeases(
  opts: {
    lanes?: readonly string[];
    isBusy?: (lane: string) => boolean;
    env?: NodeJS.ProcessEnv;
  } = {},
): SessionHandoffLeaseHold {
  const isBusy = opts.isBusy ?? isSessionLaneBusy;
  const dir = resolveSessionHandoffLeaseDir(opts.env);
  const held = new Map<string, { file: string; lease: SessionHandoffLease }>();
  let resolveReleased!: () => void;
  const released = new Promise<void>((resolve) => {
    resolveReleased = resolve;
  });
  let timer: ReturnType<typeof setInterval> | undefined;
  const releaseSync = () => {
    for (const [lane, { file, lease }] of held) {
      removeSessionHandoffLease(file, lease);
      held.delete(lane);
    }
  };
  const finish = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
    process.off("exit", releaseSync);
    resolveReleased();
  };
  const stillBusy = (lane: string) => {
    try {
      return isBusy(lane);
    } catch {
      return true; // An unanswerable busy test keeps the session until the lease ages out.
    }
  };
  const poll = () => {
    for (const [lane, { file, lease }] of held) {
      if (stillBusy(lane)) continue;
      removeSessionHandoffLease(file, lease);
      held.delete(lane);
    }
    if (held.size === 0) finish();
  };
  try {
    for (const lane of opts.lanes ?? listBusySessionLanes()) {
      if (lane.startsWith(SESSION_LANE_PREFIX) && !held.has(lane)) held.set(lane, writeSessionHandoffLease(dir, lane));
    }
  } catch (error) {
    releaseSync();
    throw error;
  }
  const lanes = [...held.keys()];
  // An engine that exits with leases still held must not leave its successor waiting for a dead holder's files.
  process.once("exit", releaseSync);
  // Kept referenced: the stepping-down engine stays up until it has released every session it kept.
  timer = setInterval(poll, POLL_MS);
  poll();
  return {
    lanes,
    released,
    releaseAll: () => {
      releaseSync();
      finish();
    },
  };
}
