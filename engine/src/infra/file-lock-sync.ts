import fs from "node:fs";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { getFileLockProcessStartTime } from "../shared/pid-alive.js";
import { acquireFileLockSync } from "./file-lock-manager.js";
import { isLockOwnerDefinitelyStale } from "./stale-lock-file.js";

/** Retry budget for the synchronous lock. The defaults are unchanged for existing callers. */
export type FileLockSyncRetryOptions = {
  retries?: number;
  minTimeout?: number;
  maxTimeout?: number;
  randomize?: boolean;
};

/** Synchronous lock for legacy stores that cannot transact in SQLite yet. */
export function acquireFileLockSyncWithRetry(
  path: string,
  retryOptions: FileLockSyncRetryOptions = {},
): () => void {
  rejectUnsupportedLockPath(`${path}.lock`);
  const processStartTime = getFileLockProcessStartTime(process.pid);
  const createPayload = () => ({
    pid: process.pid,
    createdAt: new Date().toISOString(),
    ...(processStartTime === null ? {} : { starttime: processStartTime }),
  });
  const isStale = ({ payload }: { payload: unknown }) =>
    isLockOwnerDefinitelyStale({
      payload: isRecord(payload) ? payload : null,
    });
  const lock = acquireFileLockSync(path, {
    staleMs: 30_000,
    retry: {
      retries: retryOptions.retries ?? 9,
      factor: 1,
      minTimeout: retryOptions.minTimeout ?? 20,
      maxTimeout: retryOptions.maxTimeout ?? 20,
      randomize: retryOptions.randomize ?? false,
    },
    staleRecovery: "remove-if-unchanged",
    payload: createPayload,
    shouldReclaim: isStale,
    shouldRemoveStaleLock: isStale,
  });
  return () => lock.release();
}

function rejectUnsupportedLockPath(lockPath: string): void {
  let observed: fs.Stats;
  try {
    observed = fs.lstatSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  if (observed.isFile() && !observed.isSymbolicLink()) {
    return;
  }
  if (!observed.isDirectory() || observed.isSymbolicLink()) {
    throw new Error(`Storage lock path has an unsupported legacy type: ${lockPath}`);
  }
  throw Object.assign(
    new Error(
      `Legacy storage lock requires manual removal after verifying no older Branch Agent process is running: ${lockPath}`,
    ),
    { code: "file_lock_stale", lockPath },
  );
}
