// The successor's side of a per-session handoff lease (see session-handoff-lease-files.ts): work for a session its
// predecessor still holds waits in the command queue until that lease is released, its holder dies, or the bounded
// wait runs out. Every other session runs at once. With no leases on disk this costs one directory read per second.
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  isLeaseHolderAlive,
  listSessionHandoffLeases,
  readSessionHandoffLease,
  resolveSessionHandoffLeaseDir,
  SESSION_LANE_PREFIX,
  type SessionHandoffLease,
} from "./session-handoff-lease-files.js";

/** The predecessor's own drain budget (315 s) plus margin; it releases every lease by then or is gone. */
export const SESSION_HANDOFF_LEASE_MAX_WAIT_MS = 330_000;
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

type HeldLease = { file: string; lease: SessionHandoffLease; released: Promise<void>; release: () => void };

const gate = resolveGlobalSingleton(Symbol.for("branch.sessionHandoffLeaseGate"), () => ({
  leases: new Map<string, HeldLease>(),
  scannedAt: Number.NEGATIVE_INFINITY,
  timer: undefined as ReturnType<typeof setInterval> | undefined,
  maxWaitMs: SESSION_HANDOFF_LEASE_MAX_WAIT_MS,
}));

/**
 * Reads the predecessor's leases now. The engine taking over calls this as it takes the state, so no session work
 * can slip in before the next periodic scan.
 */
export function refreshSessionHandoffLeases(env: NodeJS.ProcessEnv = process.env): void {
  gate.scannedAt = Date.now();
  for (const { file, lease } of listSessionHandoffLeases(resolveSessionHandoffLeaseDir(env))) {
    if (lease.pid === process.pid || gate.leases.has(lease.lane)) continue;
    // A lease whose holder died guards nothing: its runs are gone and restart recovery owns them.
    if (!isLeaseHolderAlive(lease.pid)) continue;
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    gate.leases.set(lease.lane, { file, lease, released, release });
  }
  if (gate.leases.size > 0 && !gate.timer) {
    gate.timer = setInterval(pollSessionHandoffLeases, POLL_MS);
    gate.timer.unref?.();
  }
}

function pollSessionHandoffLeases(): void {
  for (const [lane, held] of gate.leases) {
    const current = readSessionHandoffLease(held.file);
    if (current?.ownerId === held.lease.ownerId && isLeaseHolderAlive(held.lease.pid)) continue;
    gate.leases.delete(lane);
    held.release();
  }
  if (gate.leases.size === 0 && gate.timer) {
    clearInterval(gate.timer);
    gate.timer = undefined;
  }
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
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Queued command aborted"));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new SessionHandoffLeaseTimeoutError(lane, Date.now() - started));
    }, gate.maxWaitMs);
    timer.unref?.();
    signal?.addEventListener("abort", onAbort, { once: true });
    void held.released.then(() => {
      cleanup();
      resolve();
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
