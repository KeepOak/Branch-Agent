// Per-session lane leases for an in-place engine handoff (P45): the shared file format.
//
// An engine stepping down for its successor may still have runs in flight. It keeps a lease on each of those
// session lanes, finishes and saves the runs, then releases each lease. The successor takes every other session at
// once; work it queues in a leased session lane waits. Engines are separate processes on the same state directory,
// so a lease is a small file under <stateDir>/handoff/session-leases, written whole (temp, then rename).
//
// Each holder writes its own file, <sha256(lane)[:32]>.<ownerId>.json, and only ever removes its own. A session can
// have several holders at once (back-to-back updates: A still finishes a run while B steps down with a turn for the
// same session parked behind A), and a successor waits until every holder of that session has released it.
//
// This gates the session's command lane, which carries turns, compaction, and cron and heartbeat runs. Gateway
// requests that write a session outside its lane (session RPCs, chat.send's user turn, in-process dispatch) wait in
// gateway/session-handoff-lease-request-gate.ts.
//
// A lease is live only while its holder process is the same process (pid and start time) and it is younger than
// the longest a handoff may keep a session; anything else is stale and is deleted on sight. The format is version 2
// (one file per holder); version 1 was never written by a released engine.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/state-dir.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getFileLockProcessStartTime } from "../shared/pid-alive.js";

/** Only session lanes (embedded-agent-runner/lanes.ts resolveSessionLane) are leased. */
export const SESSION_LANE_PREFIX = "session:";
/**
 * The longest a stepping-down engine may keep a session (its 315 s drain budget plus margin), and the longest a
 * successor's turn waits for one. The holder's `deadline` fires at this age.
 */
export const SESSION_HANDOFF_LEASE_MAX_WAIT_MS = 330_000;
/**
 * The longest a Gateway request that writes a leased session waits before it is refused as retryable. Clients
 * give up on a request after 30 s (DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS), and a write they were told failed must
 * never run later, so this stays well below that. In-process dispatch waits up to its own deadline instead.
 */
export const SESSION_HANDOFF_LEASE_REQUEST_WAIT_MS = 15_000;
/** A lease older than this guards nothing, whoever holds it: the successor runs the session from then on. */
export const SESSION_HANDOFF_LEASE_MAX_AGE_MS = SESSION_HANDOFF_LEASE_MAX_WAIT_MS + 30_000;
const START_TIME_TIMEOUT_MS = 1_000;
const FILE_RETRIES = 3;
const FILE_RETRY_DELAY_MS = 50;

const log = createSubsystemLogger("gateway/handoff");

export type SessionHandoffLease = {
  version: 2;
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

function laneHash(lane: string): string {
  return createHash("sha256").update(lane).digest("hex").slice(0, 32);
}

/** The one file a holder writes for one session lane. */
export function sessionHandoffLeaseFile(dir: string, lane: string, ownerId: string): string {
  return path.join(dir, `${laneHash(lane)}.${ownerId}.json`);
}

/** The lease in `file`, or undefined when there is none (missing or not a lease this format understands). */
export function readSessionHandoffLease(file: string): SessionHandoffLease | undefined {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  return parseSessionHandoffLease(file, text);
}

/**
 * Like readSessionHandoffLease, for deciding whether a holder still holds: a file that is there but cannot be read
 * right now (Windows: antivirus or an indexer has it open) is retried briefly, then reported as "busy" rather than
 * as gone, so a passing read error never frees a session its holder still writes.
 */
export function readHeldSessionHandoffLease(file: string): SessionHandoffLease | undefined | "busy" {
  let text: string;
  try {
    text = withFileRetries(() => fs.readFileSync(file, "utf8"));
  } catch (error) {
    return isTransientFileError(error) ? "busy" : undefined;
  }
  return parseSessionHandoffLease(file, text);
}

function parseSessionHandoffLease(file: string, text: string): SessionHandoffLease | undefined {
  let value: Partial<SessionHandoffLease>;
  try {
    value = JSON.parse(text) as Partial<SessionHandoffLease>;
  } catch {
    return undefined;
  }
  if (
    value?.version !== 2 ||
    typeof value.lane !== "string" ||
    !value.lane.startsWith(SESSION_LANE_PREFIX) ||
    !Number.isSafeInteger(value.pid) ||
    (value.pid ?? 0) <= 0 ||
    typeof value.ownerId !== "string" ||
    typeof value.acquiredAt !== "number" ||
    !(value.startTime === null || typeof value.startTime === "number") ||
    path.basename(file) !== `${laneHash(value.lane)}.${value.ownerId}.json`
  ) {
    return undefined;
  }
  return value as SessionHandoffLease;
}

/** Every lease in `dir`, or only those for `lane`. */
export function listSessionHandoffLeases(
  dir: string,
  lane?: string,
): Array<{ file: string; lease: SessionHandoffLease }> {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const prefix = lane === undefined ? undefined : `${laneHash(lane)}.`;
  return names.flatMap((name) => {
    if (!name.endsWith(".json") || (prefix && !name.startsWith(prefix))) return [];
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

export function sessionHandoffLeaseExpiresAt(lease: SessionHandoffLease): number {
  return lease.acquiredAt + SESSION_HANDOFF_LEASE_MAX_AGE_MS;
}

export function isSessionHandoffLeaseExpired(lease: SessionHandoffLease, now = Date.now()): boolean {
  return now >= sessionHandoffLeaseExpiresAt(lease) || lease.acquiredAt > now + 60_000;
}

/** Full liveness: not expired, holder alive, and the same process that wrote it (not a reused PID). */
export function isSessionHandoffLeaseLive(lease: SessionHandoffLease): boolean {
  if (isSessionHandoffLeaseExpired(lease) || !isLeaseHolderAlive(lease.pid)) return false;
  if (lease.startTime === null) return true;
  const startTime = getFileLockProcessStartTime(lease.pid, process.env, START_TIME_TIMEOUT_MS);
  return startTime === null || startTime === lease.startTime;
}

function isTransientFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}

function pauseSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Antivirus or an indexer can hold a file for a moment on Windows: retry briefly before giving up. */
function withFileRetries<T>(operation: () => T, retries = FILE_RETRIES): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt >= retries || !isTransientFileError(error)) throw error;
      pauseSync(FILE_RETRY_DELAY_MS);
    }
  }
}

export type RemoveLeaseOptions = {
  /** A single attempt, without the short blocking retries (a removal already being retried on a timer). */
  once?: boolean;
  /** No warning when it fails (the caller already warned for this file). */
  quiet?: boolean;
};

/** Removes `file`; false (and logged) when it could not be removed, true when it is gone. */
function removeFile(file: string, options: RemoveLeaseOptions = {}): boolean {
  try {
    withFileRetries(() => fs.unlinkSync(file), options.once ? 0 : FILE_RETRIES);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    if (!options.quiet) log.warn(`session handoff lease ${file} could not be removed: ${String(error)}`);
    return false;
  }
}

/** Removes a lease that guards nothing (expired, dead holder, reused PID); its file is that holder's alone. */
export function removeStaleSessionHandoffLease(file: string): void {
  removeFile(file);
}

/**
 * Removes leftovers that are not leases: temp files from a crash between write and rename, and unreadable files,
 * once they are older than any lease could be.
 */
export function sweepSessionHandoffLeaseLeftovers(dir: string, now = Date.now()): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    if (name.endsWith(".json") && readSessionHandoffLease(file)) continue;
    try {
      if (now - fs.statSync(file).mtimeMs > SESSION_HANDOFF_LEASE_MAX_AGE_MS) removeFile(file);
    } catch {
      // Gone meanwhile.
    }
  }
}

/** Writes this process's own lease on `lane`. Another holder's lease is never read, replaced or refused. */
export function writeSessionHandoffLease(dir: string, lane: string): { file: string; lease: SessionHandoffLease } {
  const lease: SessionHandoffLease = {
    version: 2,
    lane,
    pid: process.pid,
    ownerId: randomUUID(),
    acquiredAt: Date.now(),
    startTime: getFileLockProcessStartTime(process.pid, process.env, START_TIME_TIMEOUT_MS),
  };
  const file = sessionHandoffLeaseFile(dir, lane, lease.ownerId);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${file}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(lease));
    withFileRetries(() => fs.renameSync(temp, file));
  } catch (error) {
    removeFile(temp);
    throw error;
  }
  return { file, lease };
}

/** Removes this holder's own lease file; false (and logged unless `quiet`) when it is still there. */
export function removeSessionHandoffLease(
  file: string,
  _lease?: SessionHandoffLease,
  options?: RemoveLeaseOptions,
): boolean {
  return removeFile(file, options);
}
