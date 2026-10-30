// On-disk record for the fallback engine child and its long-lived parent.
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { getFileLockProcessStartTime, isPidAlive } from "../../shared/pid-alive.js";

const APP_CHILD_RECORD_NAME = "gateway-app-child.json";

export const GATEWAY_CHILD_GAVE_UP_MESSAGE =
  "Branch's engine stopped too many times and will not restart. Run `branch doctor` or choose Install background service.";
export const GATEWAY_CHILD_START_FAILED_MESSAGE =
  "Branch's engine did not start. It will not be restarted. Run `branch doctor` or choose Install background service.";
export const GATEWAY_CHILD_STOPPED_MESSAGE = "Stopped Branch's engine.";
export const GATEWAY_CHILD_ESCALATED_STOP_MESSAGE =
  "Stopped Branch's engine after it ignored the first stop.";
export const GATEWAY_CHILD_STOP_FAILED_MESSAGE = "Could not stop Branch's engine.";

export type AppChildRecord = {
  pid?: number;
  port: number;
  startedAt?: number;
  supervisorPid?: number;
  supervisorStartedAt?: number;
  ownerPid?: number;
  ownerStartedAt?: number;
  restartCount?: number;
  healthySince?: number;
  stopRequested?: boolean;
  error?: string;
};

export type AppChildReadStartTime = (pid: number) => number | null;

function isSafePid(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isSafeTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function resolveAppChildRecordPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), APP_CHILD_RECORD_NAME);
}

export function readAppChildRecord(env: NodeJS.ProcessEnv = process.env): AppChildRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveAppChildRecordPath(env), "utf8")) as Record<
      string,
      unknown
    >;
    if (typeof parsed.port !== "number") {
      return null;
    }
    const record: AppChildRecord = { port: parsed.port };
    if (isSafePid(parsed.pid)) {
      record.pid = parsed.pid;
    }
    if (isSafeTime(parsed.startedAt)) {
      record.startedAt = parsed.startedAt;
    }
    if (isSafePid(parsed.supervisorPid)) {
      record.supervisorPid = parsed.supervisorPid;
    }
    if (isSafeTime(parsed.supervisorStartedAt)) {
      record.supervisorStartedAt = parsed.supervisorStartedAt;
    }
    if (isSafePid(parsed.ownerPid)) {
      record.ownerPid = parsed.ownerPid;
    }
    if (isSafeTime(parsed.ownerStartedAt)) {
      record.ownerStartedAt = parsed.ownerStartedAt;
    }
    if (typeof parsed.restartCount === "number" && Number.isSafeInteger(parsed.restartCount)) {
      record.restartCount = parsed.restartCount;
    }
    if (isSafeTime(parsed.healthySince)) {
      record.healthySince = parsed.healthySince;
    }
    if (parsed.stopRequested === true) {
      record.stopRequested = true;
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      record.error = parsed.error;
    }
    return record;
  } catch {
    return null;
  }
}

export function writeAppChildRecord(
  record: AppChildRecord,
  env: NodeJS.ProcessEnv = process.env,
): void {
  fs.mkdirSync(path.dirname(resolveAppChildRecordPath(env)), { recursive: true });
  fs.writeFileSync(resolveAppChildRecordPath(env), `${JSON.stringify(record)}\n`, "utf8");
}

export function clearAppChildRecord(env: NodeJS.ProcessEnv = process.env): void {
  try {
    fs.unlinkSync(resolveAppChildRecordPath(env));
  } catch {
    // The record is advisory; a missing file still means no child to stop.
  }
}

export function writeFailedAppChildRecord(
  port: number,
  error: string,
  env: NodeJS.ProcessEnv = process.env,
  extra: Partial<AppChildRecord> = {},
): void {
  writeAppChildRecord({ port, error, ...extra }, env);
}

export function markAppChildStopRequested(env: NodeJS.ProcessEnv = process.env): AppChildRecord | null {
  const recorded = readAppChildRecord(env);
  if (!recorded) {
    return null;
  }
  const next = { ...recorded, stopRequested: true };
  writeAppChildRecord(next, env);
  return next;
}

export function resolveAppChildOwnerPid(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const fromEnv = Number(env.BRANCH_APP_PID);
  if (Number.isSafeInteger(fromEnv) && fromEnv > 1) {
    return fromEnv;
  }
  if (Number.isSafeInteger(process.ppid) && process.ppid > 1) {
    return process.ppid;
  }
  return undefined;
}

export function defaultReadStartTime(
  pid: number,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  return getFileLockProcessStartTime(pid, env);
}

export function isSameRecordedProcess(
  pid: number | undefined,
  startedAt: number | undefined,
  readStartTime: AppChildReadStartTime,
  alive: (pid: number) => boolean = isPidAlive,
): boolean {
  if (!pid || !alive(pid)) {
    return false;
  }
  if (startedAt === undefined) {
    return false;
  }
  return readStartTime(pid) === startedAt;
}

export function isOwnerProcessCurrent(
  pid: number | undefined,
  startedAt: number | undefined,
  readStartTime: AppChildReadStartTime,
  alive: (pid: number) => boolean = isPidAlive,
): boolean {
  if (!pid || !alive(pid)) {
    return false;
  }
  if (startedAt === undefined) {
    return true;
  }
  return readStartTime(pid) === startedAt;
}

export function canEscalateRecordedPid(
  pid: number | undefined,
  startedAt: number | undefined,
  readStartTime: AppChildReadStartTime,
  alive: (pid: number) => boolean = isPidAlive,
): boolean {
  return isSameRecordedProcess(pid, startedAt, readStartTime, alive);
}

export function attachAppChildFallbackStatus<T extends object>(
  status: T,
  env: NodeJS.ProcessEnv = process.env,
): T & { fallback?: { error: string; restartCount?: number } } {
  const recorded = readAppChildRecord(env);
  if (!recorded?.error) {
    return status;
  }
  return {
    ...status,
    fallback: {
      error: recorded.error,
      ...(recorded.restartCount !== undefined ? { restartCount: recorded.restartCount } : {}),
    },
  };
}
