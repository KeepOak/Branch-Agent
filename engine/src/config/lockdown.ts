// Lockdown: one global switch (security.lockdown) that stops every Trunk from sending, changing or spending.
import fs from "node:fs";
import { parseConfigJson5 } from "./io.read-helpers.js";
import { resolveConfigPath } from "./paths.js";
import { getRuntimeConfigSnapshot } from "./runtime-snapshot.js";

export const LOCKDOWN_MESSAGE = "Lockdown is on: Trunks cannot run or send anything.";
const LOCKDOWN_CODE = "LOCKDOWN";

/** Thrown wherever Lockdown refuses work, so callers can tell a refusal from a failure. */
export class LockdownError extends Error {
  readonly code = LOCKDOWN_CODE;
  constructor(message = LOCKDOWN_MESSAGE) {
    super(message);
    this.name = "LockdownError";
  }
}

/** True for a Lockdown refusal, including one that was flattened to its message on the way up. */
export function isLockdownError(error: unknown): boolean {
  if (error instanceof LockdownError) return true;
  if (error && typeof error === "object" && (error as { code?: unknown }).code === LOCKDOWN_CODE) return true;
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : undefined;
  return typeof text === "string" && text.includes(LOCKDOWN_MESSAGE);
}

type FileRead = { path: string; mtimeMs: number; size: number; on: boolean };
let lastFileRead: FileRead | undefined;

function lockdownFlag(config: unknown): boolean {
  const security = (config as { security?: { lockdown?: unknown } } | null | undefined)?.security;
  return security?.lockdown === true;
}

/**
 * The config file's own switch, re-read only when the file changes. An engine whose config reloader has
 * stopped (a stepped-down P45 engine still finishing runs) still sees Lockdown turned on through it.
 * An unreadable or half-written file never turns Lockdown off: the last good read stands.
 */
function fileLockdown(): boolean {
  let path: string;
  let stat: fs.Stats;
  try {
    path = resolveConfigPath();
    stat = fs.statSync(path);
  } catch {
    return false;
  }
  const last = lastFileRead?.path === path ? lastFileRead : undefined;
  if (last && last.mtimeMs === stat.mtimeMs && last.size === stat.size) return last.on;
  try {
    const parsed = parseConfigJson5(fs.readFileSync(path, "utf8"));
    if (!parsed.ok) return last?.on ?? false;
    lastFileRead = { path, mtimeMs: stat.mtimeMs, size: stat.size, on: lockdownFlag(parsed.parsed) };
    return lastFileRead.on;
  } catch {
    return last?.on ?? false;
  }
}

/** Lockdown is on when the running engine's committed config or the config file on disk says so. */
export function isLockdownOn(): boolean {
  return lockdownFlag(getRuntimeConfigSnapshot()) || fileLockdown();
}

export function assertLockdownOff(): void {
  if (isLockdownOn()) {
    throw new LockdownError();
  }
}

/** For entry points that return a promise: refuse by rejecting, never by throwing synchronously. */
export function lockdownRefusal(): Promise<never> | undefined {
  return isLockdownOn() ? Promise.reject(new LockdownError()) : undefined;
}

export const testing = {
  resetFileCache() {
    lastFileRead = undefined;
  },
};
