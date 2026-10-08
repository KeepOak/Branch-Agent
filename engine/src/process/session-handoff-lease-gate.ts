// The successor's side of a per-session handoff lease (see session-handoff-lease-files.ts): work for a session lane
// that a predecessor still holds waits until every holder of that lane has released it, or its lease went stale
// (holder gone, PID reused, or older than SESSION_HANDOFF_LEASE_MAX_AGE_MS), or the bounded wait runs out. Every
// other session runs at once. With no leases on disk this costs one directory read per second.
import { toErrorObject } from "../infra/errors.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  isLeaseHolderAlive,
  isSessionHandoffLeaseExpired,
  isSessionHandoffLeaseLive,
  listSessionHandoffLeases,
  readHeldSessionHandoffLease,
  readSessionHandoffLease,
  removeStaleSessionHandoffLease,
  resolveSessionHandoffLeaseDir,
  SESSION_HANDOFF_LEASE_MAX_AGE_MS,
  SESSION_LANE_PREFIX,
  type SessionHandoffLease,
  sessionHandoffLeaseExpiresAt,
  sweepSessionHandoffLeaseLeftovers,
} from "./session-handoff-lease-files.js";

export {
  SESSION_HANDOFF_LEASE_MAX_WAIT_MS,
  SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS,
} from "./session-handoff-lease-files.js";
const RESCAN_MS = 1_000;
const POLL_MS = 100;
const log = createSubsystemLogger("gateway/handoff");

export class SessionHandoffLeaseTimeoutError extends Error {
  constructor(lane: string, waitedMs: number) {
    super(
      `This conversation is still finishing on the previous engine after ${Math.round(waitedMs / 1000)}s; try again shortly (${lane}).`,
    );
    this.name = "SessionHandoffLeaseTimeoutError";
  }
}

type Holder = { file: string; lease: SessionHandoffLease };
type HeldLane = {
  lane: string;
  /** Every predecessor holding this lane, by lease ownerId. */
  holders: Map<string, Holder>;
  released: Promise<void>;
  release: () => void;
  waiters: number;
};

const gate = resolveGlobalSingleton(Symbol.for("branch.sessionHandoffLeaseGate"), () => ({
  lanes: new Map<string, HeldLane>(),
  scannedAt: Number.NEGATIVE_INFINITY,
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  // A turn waits at most as long as a lease can live; normally the lease's own release or expiry frees it first.
  maxWaitMs: SESSION_HANDOFF_LEASE_MAX_AGE_MS,
  env: undefined as NodeJS.ProcessEnv | undefined,
  /** When this process started stepping down (its own hold), if it is. */
  ownHoldStartedAt: undefined as number | undefined,
  /** Successor recovery hooks: a lane is free after its last predecessor died, expired, or released. */
  releasedListeners: new Set<(lane: string) => void>(),
  /** Releases that settled with no listener; replayed when a watcher registers. */
  releasedWhileUnwatched: [] as string[],
}));

/**
 * Called by this process's own hold (session-handoff-lease-holder.ts) as it starts stepping down, and with
 * undefined when it calls the step-down off. From then on, a lease written at or after that moment belongs to an
 * engine that came after this one, and this engine never waits for its successors: they wait for it.
 */
export function noteOwnSessionHandoffHold(startedAt: number | undefined): void {
  gate.ownHoldStartedAt = startedAt;
}

/** Clears the record of this process's own hold, unless a newer hold has replaced it since. */
export function clearOwnSessionHandoffHold(startedAt: number): void {
  if (gate.ownHoldStartedAt === startedAt) gate.ownHoldStartedAt = undefined;
}

/** The lane is free once its last holder's lease expires, whatever the holders still do. */
function laneExpiresAt(held: HeldLane): number {
  return Math.max(
    ...[...held.holders.values()].map(({ lease }) => sessionHandoffLeaseExpiresAt(lease)),
  );
}

/** Adds a live foreign lease to its lane (creating the lane entry), or deletes it when it is stale. */
function admitLease(file: string, lease: SessionHandoffLease): void {
  // Our own leases (a step-down in this process) never hold our own work back.
  if (lease.pid === process.pid) return;
  // Nor do our successors' (A steps down for B, B for C: A finishing a run must not wait on B's lease for it,
  // while B waits on A). Every one of them was written after our own step-down started. That relies on each
  // predecessor writing all its leases before its successor activates: the stepping-down engine seals its hold
  // right before it releases the state, and leases no new session once sealed (session-handoff-lease-holder.ts).
  // A caller with `leaseNewLanes` that never seals would break it.
  if (gate.ownHoldStartedAt !== undefined && lease.acquiredAt >= gate.ownHoldStartedAt) return;
  const existing = gate.lanes.get(lease.lane);
  if (existing?.holders.has(lease.ownerId)) return;
  if (!isSessionHandoffLeaseLive(lease)) {
    removeStaleSessionHandoffLease(file);
    return;
  }
  if (existing) {
    existing.holders.set(lease.ownerId, { file, lease });
    return;
  }
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  gate.lanes.set(lease.lane, {
    lane: lease.lane,
    holders: new Map([[lease.ownerId, { file, lease }]]),
    released,
    release,
    waiters: 0,
  });
}

/**
 * Reads the predecessors' leases now. The engine taking over calls this as it takes the state, so no session work
 * can slip in before the next periodic scan. Stale leases and old leftovers are deleted on sight.
 */
export function refreshSessionHandoffLeases(env: NodeJS.ProcessEnv = process.env): void {
  const starting = gate.scannedAt === Number.NEGATIVE_INFINITY;
  gate.env = env;
  gate.scannedAt = Date.now();
  const dir = resolveSessionHandoffLeaseDir(env);
  for (const { file, lease } of listSessionHandoffLeases(dir, undefined, starting))
    admitLease(file, lease);
  sweepSessionHandoffLeaseLeftovers(dir);
  if (gate.lanes.size > 0 && !gate.timer) {
    gate.timer = setInterval(pollSessionHandoffLeases, POLL_MS);
    gate.timer.unref?.();
  }
}

function holderStillHolds({ file, lease }: Holder): boolean {
  if (isSessionHandoffLeaseExpired(lease) || !isLeaseHolderAlive(lease.pid)) return false;
  // A lease file that is there but unreadable for now still holds; its expiry bounds that.
  const current = readHeldSessionHandoffLease(file);
  return current === "busy" || current?.ownerId === lease.ownerId;
}

/** Drops holders that no longer hold the lane; frees the lane (and its waiters) once none is left. */
function settleLane(lane: string, held: HeldLane): boolean {
  for (const [ownerId, holder] of held.holders) {
    if (holderStillHolds(holder)) continue;
    if (readSessionHandoffLease(holder.file)?.ownerId === ownerId)
      removeStaleSessionHandoffLease(holder.file);
    held.holders.delete(ownerId);
  }
  if (held.holders.size > 0) return false;
  // Before freeing the lane, look for a holder that appeared since the last scan (a later step-down).
  for (const { file, lease } of listSessionHandoffLeases(
    resolveSessionHandoffLeaseDir(gate.env),
    lane,
  )) {
    admitLease(file, lease);
  }
  if (held.holders.size > 0) return false;
  gate.lanes.delete(lane);
  held.release();
  if (gate.releasedListeners.size === 0) {
    gate.releasedWhileUnwatched.push(lane);
    return true;
  }
  for (const listener of gate.releasedListeners) {
    try {
      listener(lane);
    } catch (error) {
      log.warn(
        `session handoff lease release hook failed (${lane}): ${String(error)}`,
      );
    }
  }
  return true;
}

/**
 * Fires once a predecessor lane is free (holder gone, lease expired, or the file was released).
 * The successor uses this to recover conversations that were skipped by the startup orphan scan.
 */
export function onSessionHandoffLaneReleased(listener: (lane: string) => void): () => void {
  gate.releasedListeners.add(listener);
  const pending = gate.releasedWhileUnwatched.splice(0);
  for (const lane of pending) {
    try {
      listener(lane);
    } catch (error) {
      log.warn(
        `session handoff lease release hook failed (${lane}): ${String(error)}`,
      );
    }
  }
  return () => {
    gate.releasedListeners.delete(listener);
  };
}

/** Tests only: run the same poll that notices a dead or expired predecessor. */
export function pollSessionHandoffLeasesForTest(): void {
  pollSessionHandoffLeases();
}

function pollSessionHandoffLeases(): void {
  if (Date.now() - gate.scannedAt >= RESCAN_MS) refreshSessionHandoffLeases(gate.env);
  for (const [lane, held] of gate.lanes) settleLane(lane, held);
  if (gate.lanes.size === 0 && gate.timer) {
    clearInterval(gate.timer);
    gate.timer = undefined;
  }
}

/** The session lanes a predecessor holds now, from a scan at most a second old. */
export function listLeasedSessionLanes(): string[] {
  if (Date.now() - gate.scannedAt >= RESCAN_MS) refreshSessionHandoffLeases(gate.env);
  return [...gate.lanes.keys()];
}

/** Whether a predecessor still holds `lane` (from a scan at most a second old); an expired lane is free. */
export function isSessionLaneHeldByPredecessor(lane: string): boolean {
  if (!lane.startsWith(SESSION_LANE_PREFIX)) return false;
  if (Date.now() - gate.scannedAt >= RESCAN_MS) refreshSessionHandoffLeases(gate.env);
  const held = gate.lanes.get(lane);
  return held !== undefined && !(Date.now() >= laneExpiresAt(held) && settleLane(lane, held));
}

/** Turns parked behind a lease, per lane: they count as queued work for this engine's activity inventory. */
export function listSessionHandoffLeaseWaiters(): Array<{ lane: string; waiters: number }> {
  return [...gate.lanes.values()]
    .filter((held) => held.waiters > 0)
    .map((held) => ({ lane: held.lane, waiters: held.waiters }));
}

export function countSessionHandoffLeaseWaiters(lane: string): number {
  return gate.lanes.get(lane)?.waiters ?? 0;
}

/**
 * Undefined when work for `lane` may run now. Otherwise resolves once every predecessor holding the session has
 * released it or its lease expired (waiters resume in the order they arrived), and rejects when `signal` aborts or
 * the bounded wait runs out first.
 */
export function waitForSessionHandoffLease(
  lane: string,
  signal?: AbortSignal,
): Promise<void> | undefined {
  if (!lane.startsWith(SESSION_LANE_PREFIX)) return undefined;
  if (Date.now() - gate.scannedAt >= RESCAN_MS) refreshSessionHandoffLeases(gate.env);
  const held = gate.lanes.get(lane);
  // A lane whose leases all expired is free now, even before the next poll notices.
  if (!held || (Date.now() >= laneExpiresAt(held) && settleLane(lane, held))) return undefined;
  const parkedAt = Date.now();
  held.waiters += 1;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (settled) return false;
      settled = true;
      held.waiters -= 1;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = () => {
      if (settle()) reject(toErrorObject(signal?.reason, "Queued command aborted"));
    };
    // The wait ends at whichever comes first: the bounded wait (reject) or the lane's lease expiry (run).
    const arm = () => {
      const now = Date.now();
      const giveUpAt = parkedAt + gate.maxWaitMs;
      const expiresAt = held.holders.size > 0 ? laneExpiresAt(held) : now;
      // Every holder's lease expired: the lane is freed (and this waiter with it), unless a newer holder appeared.
      if (now >= expiresAt && settleLane(lane, held)) {
        if (settle()) resolve();
        return;
      }
      if (now >= giveUpAt) {
        if (settle()) reject(new SessionHandoffLeaseTimeoutError(lane, now - parkedAt));
        return;
      }
      const nextExpiry = held.holders.size > 0 ? laneExpiresAt(held) : now + POLL_MS;
      timer = setTimeout(arm, Math.max(1, Math.min(giveUpAt, nextExpiry) - now));
      timer.unref?.();
    };
    arm();
    signal?.addEventListener("abort", onAbort, { once: true });
    void held.released.then(() => {
      if (settle()) resolve();
    });
  });
}

/** Tests only: a short bounded wait and a clean gate. */
export function resetSessionHandoffLeaseGateForTest(
  maxWaitMs = SESSION_HANDOFF_LEASE_MAX_AGE_MS,
): void {
  if (gate.timer) clearInterval(gate.timer);
  gate.timer = undefined;
  gate.lanes.clear();
  gate.scannedAt = Number.NEGATIVE_INFINITY;
  gate.maxWaitMs = maxWaitMs;
  gate.env = undefined;
  gate.ownHoldStartedAt = undefined;
  gate.releasedListeners.clear();
  gate.releasedWhileUnwatched.length = 0;
}
