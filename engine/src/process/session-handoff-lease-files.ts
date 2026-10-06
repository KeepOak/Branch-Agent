// Per-session lane leases for an in-place engine handoff (P45): the shared file format.
//
// An engine stepping down for its successor may still have runs in flight. It keeps a lease on each of those
// session lanes, finishes and saves the runs, then releases each lease. The successor takes every other session at
// once; work it queues in a leased session lane waits. Both engines are separate processes on the same state
// directory, so a lease is a small file under <stateDir>/handoff/session-leases, written whole (temp, then rename).
//
// This gates the session's command lane. Session writes that do not run in that lane (session RPCs, compaction,
// subagent and cron writers) are not gated here; the handoff wiring has to route or fence them.
//
// A lease is live only while its holder process is the same process (pid and start time) and it is younger than
// the longest a handoff may keep a session; anything else is stale and is deleted on sight.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/state-dir.js";
import { getFileLockProcessStartTime } from "../shared/pid-alive.js";

/** Only session lanes (embedded-agent-runner/lanes.ts resolveSessionLane) are leased. */
export const SESSION_LANE_PREFIX = "session:";
/** The predecessor's own drain budget (315 s) plus margin; it releases every lease by then or is gone. */
export const SESSION_HANDOFF_LEASE_MAX_WAIT_MS = 330_000;
/** A lease older than this guards nothing, whoever holds it. */
export const SESSION_HANDOFF_LEASE_MAX_AGE_MS = SESSION_HANDOFF_LEASE_MAX_WAIT_MS + 30_000;
const START_TIME_TIMEOUT_MS = 1_000;

export type SessionHandoffLease = {
  version: 1;
  lane: string;
  pid: number;
  ownerId: string;
  acquiredAt: number;
  /** The holder's process start time, so a reused PID never keeps a lease alive; null where unreadable. */
  startTime: number | null;
};

export function resolveSessionHandoffLeaseDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "handoff", "session-leases");
}

export function sessionHandoffLeaseFile(dir: string, lane: string): string {
  return path.join(dir, `${createHash("sha256").update(lane).digest("hex").slice(0, 32)}.json`);
}

/** The lease in `file`, or undefined when there is none (missing or not a lease this format understands). */
export function readSessionHandoffLease(file: string): SessionHandoffLease | undefined {
  let value: Partial<SessionHandoffLease>;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<SessionHandoffLease>;
  } catch {
    return undefined;
  }
  if (
    value?.version !== 1 ||
    typeof value.lane !== "string" ||
    !value.lane.startsWith(SESSION_LANE_PREFIX) ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid ?? 0) <= 0 ||
    typeof value.ownerId !== "string" ||
    typeof value.acquiredAt !== "number" ||
    !(value.startTime === null || typeof value.startTime === "number")
  ) {
    return undefined;
  }
  return value as SessionHandoffLease;
}

export function listSessionHandoffLeases(
  dir: string,
): Array<{ file: string; lease: SessionHandoffLease }> {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    if (!name.endsWith(".json")) return [];
    const file = path.join(dir, name);
    const lease = readSessionHandoffLease(file);
    return lease ? [{ file, lease }] : [];
  });
}

/** A signal-0 probe: EPERM still means the process exists. */
export function isLeaseHolderAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function isSessionHandoffLeaseExpired(lease: SessionHandoffLease, now = Date.now()): boolean {
  return now - lease.acquiredAt > SESSION_HANDOFF_LEASE_MAX_AGE_MS || lease.acquiredAt > now + 60_000;
}

/** Full liveness: not expired, holder alive, and the same process that wrote it (not a reused PID). */
export function isSessionHandoffLeaseLive(lease: SessionHandoffLease): boolean {
  if (isSessionHandoffLeaseExpired(lease) || !isLeaseHolderAlive(lease.pid)) return false;
  if (lease.startTime === null) return true;
  const startTime = getFileLockProcessStartTime(lease.pid, process.env, START_TIME_TIMEOUT_MS);
  return startTime === null || startTime === lease.startTime;
}

function removeFile(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone.
  }
}

/** Removes a lease that guards nothing (expired, dead holder, reused PID) unless it changed meanwhile. */
export function removeStaleSessionHandoffLease(file: string, lease: SessionHandoffLease): void {
  if (readSessionHandoffLease(file)?.ownerId === lease.ownerId) removeFile(file);
}

export function writeSessionHandoffLease(dir: string, lane: string): { file: string; lease: SessionHandoffLease } {
  const file = sessionHandoffLeaseFile(dir, lane);
  const existing = readSessionHandoffLease(file);
  if (existing && existing.pid !== process.pid && isSessionHandoffLeaseLive(existing)) {
    throw new Error(`Session ${lane} is already leased by process ${existing.pid}`);
  }
  const lease: SessionHandoffLease = {
    version: 1,
    lane,
    pid: process.pid,
    ownerId: randomUUID(),
    acquiredAt: Date.now(),
    startTime: getFileLockProcessStartTime(process.pid, process.env, START_TIME_TIMEOUT_MS),
  };
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${lease.ownerId}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(lease));
    fs.renameSync(temp, file);
  } catch (error) {
    removeFile(temp);
    throw error;
  }
  return { file, lease };
}

/** Removes `file` only while it still holds `lease`, so a holder never deletes someone else's lease. */
export function removeSessionHandoffLease(file: string, lease: SessionHandoffLease): void {
  if (readSessionHandoffLease(file)?.ownerId !== lease.ownerId) return;
  removeFile(file);
}
