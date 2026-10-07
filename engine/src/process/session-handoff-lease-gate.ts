// The successor's side of a per-session handoff lease (see session-handoff-lease-files.ts): work for a session lane
// that a predecessor still holds waits until every holder of that lane has released it, or its lease went stale
// (holder gone, PID reused, or older than SESSION_HANDOFF_LEASE_MAX_AGE_MS), or the bounded wait runs out. Every
// other session runs at once. With no leases on disk this costs one directory read per second.
import { toErrorObject } from "../infra/errors.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  isLeaseHolderAlive,
  isSessionHandoffLeaseExpired,
  isSessionHandoffLeaseLive,
  listSessionHandoffLeases,
  readSessionHandoffLease,
  removeStaleSessionHandoffLease,
  resolveSessionHandoffLeaseDir,
  SESSION_HANDOFF_LEASE_MAX_AGE_MS,
  SESSION_LANE_PREFIX,
  type SessionHandoffLease,
  sessionHandoffLeaseExpiresAt,
  sweepSessionHandoffLeaseLeftovers,
} from "./session-handoff-lease-files.js";

export { SESSION_HANDOFF_LEASE_MAX_WAIT_MS } from "./session-handoff-lease-files.js";
const RESCAN_MS = 1_000;
const POLL_MS = 100;

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
}));

/** The lane is free once its last holder's lease expires, whatever the holders still do. */
function laneExpiresAt(held: HeldLane): number {
  return Math.max(...[...held.holders.values()].map(({ lease }) => sessionHandoffLeaseExpiresAt(lease)));
}

/** Adds a live foreign lease to its lane (creating the lane entry), or deletes it when it is stale. */
function admitLease(file: string, lease: SessionHandoffLease): void {
  // Our own leases (a step-down in this process) never hold our own work back.
  if (lease.pid === process.pid) return;
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
  gate.env = env;
  gate.scannedAt = Date.now();
  const dir = resolveSessionHandoffLeaseDir(env);
  for (const { file, lease } of listSessionHandoffLeases(dir)) admitLease(file, lease);
  sweepSessionHandoffLeaseLeftovers(dir);
  if (gate.lanes.size > 0 && !gate.timer) {
    gate.timer = setInterval(pollSessionHandoffLeases, POLL_MS);
    gate.timer.unref?.();
  }
}

function holderStillHolds({ file, lease }: Holder): boolean {
  return (
    readSessionHandoffLease(file)?.ownerId === lease.ownerId &&
    isLeaseHolderAlive(lease.pid) &&
    !isSessionHandoffLeaseExpired(lease)
  );
}

/** Drops holders that no longer hold the lane; frees the lane (and its waiters) once none is left. */
function settleLane(lane: string, held: HeldLane): boolean {
  for (const [ownerId, holder] of held.holders) {
    if (holderStillHolds(holder)) continue;
    if (readSessionHandoffLease(holder.file)?.ownerId === ownerId) removeStaleSessionHandoffLease(holder.file);
    held.holders.delete(ownerId);
  }
  if (held.holders.size > 0) return false;
  // Before freeing the lane, look for a holder that appeared since the last scan (a later step-down).
  for (const { file, lease } of listSessionHandoffLeases(resolveSessionHandoffLeaseDir(gate.env), lane)) {
    admitLease(file, lease);
  }
  if (held.holders.size > 0) return false;
  gate.lanes.delete(lane);
  held.release();
  return true;
}

function pollSessionHandoffLeases(): void {
  if (Date.now() - gate.scannedAt >= RESCAN_MS) refreshSessionHandoffLeases(gate.env);
  for (const [lane, held] of gate.lanes) settleLane(lane, held);
  if (gate.lanes.size === 0 && gate.timer) {
    clearInterval(gate.timer);
    gate.timer = undefined;
  }
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
export function waitForSessionHandoffLease(lane: string, signal?: AbortSignal): Promise<void> | undefined {
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
export function resetSessionHandoffLeaseGateForTest(maxWaitMs = SESSION_HANDOFF_LEASE_MAX_AGE_MS): void {
  if (gate.timer) clearInterval(gate.timer);
  gate.timer = undefined;
  gate.lanes.clear();
  gate.scannedAt = Number.NEGATIVE_INFINITY;
  gate.maxWaitMs = maxWaitMs;
  gate.env = undefined;
}
