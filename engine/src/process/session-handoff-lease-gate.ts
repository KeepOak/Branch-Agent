// The successor's side of a per-session handoff lease (see session-handoff-lease-files.ts): work for a session lane
// its predecessor still holds waits until that lease is released, goes stale (holder gone, PID reused, or too old), or
// the bounded wait runs out. Every other session runs at once. With no leases on disk this costs one directory read
// per second.
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
  SESSION_HANDOFF_LEASE_MAX_WAIT_MS,
  SESSION_LANE_PREFIX,
  type SessionHandoffLease,
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

type HeldLease = {
  file: string;
  lease: SessionHandoffLease;
  released: Promise<void>;
  release: () => void;
  waiters: number;
};

const gate = resolveGlobalSingleton(Symbol.for("branch.sessionHandoffLeaseGate"), () => ({
  leases: new Map<string, HeldLease>(),
  scannedAt: Number.NEGATIVE_INFINITY,
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  maxWaitMs: SESSION_HANDOFF_LEASE_MAX_WAIT_MS,
}));

/**
 * Reads the predecessor's leases now. The engine taking over calls this as it takes the state, so no session work
 * can slip in before the next periodic scan. Stale lease files are deleted on sight.
 */
export function refreshSessionHandoffLeases(env: NodeJS.ProcessEnv = process.env): void {
  gate.scannedAt = Date.now();
  for (const { file, lease } of listSessionHandoffLeases(resolveSessionHandoffLeaseDir(env))) {
    if (lease.pid === process.pid || gate.leases.has(lease.lane)) continue;
    // A lease whose holder died, whose PID now belongs to another process, or that outlived any handoff guards
    // nothing: its runs are gone and restart recovery owns them.
    if (!isSessionHandoffLeaseLive(lease)) {
      removeStaleSessionHandoffLease(file, lease);
      continue;
    }
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    gate.leases.set(lease.lane, { file, lease, released, release, waiters: 0 });
  }
  if (gate.leases.size > 0 && !gate.timer) {
    gate.timer = setInterval(pollSessionHandoffLeases, POLL_MS);
    gate.timer.unref?.();
  }
}

function pollSessionHandoffLeases(): void {
  for (const [lane, held] of gate.leases) {
    const current = readSessionHandoffLease(held.file);
    const stillHeld = current?.ownerId === held.lease.ownerId;
    // The holder's identity was checked when the lease was read; here only its death or the lease's age matter.
    if (stillHeld && isLeaseHolderAlive(held.lease.pid) && !isSessionHandoffLeaseExpired(held.lease)) continue;
    if (stillHeld) removeStaleSessionHandoffLease(held.file, held.lease);
    gate.leases.delete(lane);
    held.release();
  }
  if (gate.leases.size === 0 && gate.timer) {
    clearInterval(gate.timer);
    gate.timer = undefined;
  }
}

/** Turns parked behind a lease, per lane: they count as queued work for this engine's activity inventory. */
export function listSessionHandoffLeaseWaiters(): Array<{ lane: string; waiters: number }> {
  return [...gate.leases.values()]
    .filter((held) => held.waiters > 0)
    .map((held) => ({ lane: held.lease.lane, waiters: held.waiters }));
}

export function countSessionHandoffLeaseWaiters(lane: string): number {
  return gate.leases.get(lane)?.waiters ?? 0;
}

/**
 * Undefined when work for `lane` may run now. Otherwise resolves once the predecessor releases the session (waiters
 * resume in the order they arrived) and rejects when `signal` aborts or the bounded wait runs out.
 */
export function waitForSessionHandoffLease(lane: string, signal?: AbortSignal): Promise<void> | undefined {
  if (!lane.startsWith(SESSION_LANE_PREFIX)) return undefined;
  if (Date.now() - gate.scannedAt >= RESCAN_MS) refreshSessionHandoffLeases();
  const held = gate.leases.get(lane);
  if (!held) return undefined;
  const started = Date.now();
  held.waiters += 1;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = () => {
      if (settled) return false;
      settled = true;
      held.waiters -= 1;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      return true;
    };
    const onAbort = () => {
      if (settle()) reject(toErrorObject(signal?.reason, "Queued command aborted"));
    };
    const timer = setTimeout(() => {
      if (settle()) reject(new SessionHandoffLeaseTimeoutError(lane, Date.now() - started));
    }, gate.maxWaitMs);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    void held.released.then(() => {
      if (settle()) resolve();
    });
  });
}

/** Tests only: a short bounded wait and a clean gate. */
export function resetSessionHandoffLeaseGateForTest(maxWaitMs = SESSION_HANDOFF_LEASE_MAX_WAIT_MS): void {
  if (gate.timer) clearInterval(gate.timer);
  gate.timer = undefined;
  gate.leases.clear();
  gate.scannedAt = Number.NEGATIVE_INFINITY;
  gate.maxWaitMs = maxWaitMs;
}
