// Per-session write leases for an in-place engine handoff (P45): the shared file format.
//
// An engine stepping down for its successor may still have runs in flight. It keeps a lease on each of those
// session lanes, finishes and saves the runs, then releases each lease. The successor takes every other session at
// once and waits for a leased one. Both engines are separate processes on the same state directory, so a lease is a
// small file under <stateDir>/handoff/session-leases, written whole (temp file, then rename).
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/state-dir.js";

/** Only session lanes (embedded-agent-runner/lanes.ts resolveSessionLane) are leased. */
export const SESSION_LANE_PREFIX = "session:";

export type SessionHandoffLease = {
  version: 1;
  lane: string;
  pid: number;
  ownerId: string;
  acquiredAt: number;
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
    typeof value.acquiredAt !== "number"
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

export function writeSessionHandoffLease(dir: string, lane: string): { file: string; lease: SessionHandoffLease } {
  const file = sessionHandoffLeaseFile(dir, lane);
  const existing = readSessionHandoffLease(file);
  if (existing && existing.pid !== process.pid && isLeaseHolderAlive(existing.pid)) {
    throw new Error(`Session ${lane} is already leased by process ${existing.pid}`);
  }
  const lease: SessionHandoffLease = {
    version: 1,
    lane,
    pid: process.pid,
    ownerId: randomUUID(),
    acquiredAt: Date.now(),
  };
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.${lease.ownerId}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(lease));
  fs.renameSync(temp, file);
  return { file, lease };
}

/** Removes `file` only while it still holds `lease`, so a holder never deletes someone else's lease. */
export function removeSessionHandoffLease(file: string, lease: SessionHandoffLease): void {
  if (readSessionHandoffLease(file)?.ownerId !== lease.ownerId) return;
  try {
    fs.unlinkSync(file);
  } catch {
    // Already gone: the lease is released either way.
  }
}
