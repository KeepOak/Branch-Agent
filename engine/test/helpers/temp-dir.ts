// Test temp directory helper creates and cleans up temporary directories.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Synchronous temporary directory helpers for tests.

type TempDirCollection = string[] | Set<string>;
type RegisterTempDirCleanup = (cleanup: () => void) => unknown;

const canonicalSystemTempRoots = new Map<string, string>();

function resolveCanonicalSystemTempRoot(): string {
  const rawRoot = os.tmpdir();
  const cachedRoot = canonicalSystemTempRoots.get(rawRoot);
  if (cachedRoot !== undefined) {
    return cachedRoot;
  }
  const canonicalRoot = fs.realpathSync.native(rawRoot);
  canonicalSystemTempRoots.set(rawRoot, canonicalRoot);
  return canonicalRoot;
}

interface TestTempDirTracker {
  readonly dirs: ReadonlySet<string>;
  make(prefix: string, root?: string): string;
  cleanup(this: void): void;
}

interface AutoCleanupTempDirTracker {
  readonly dirs: ReadonlySet<string>;
  make(prefix: string, root?: string): string;
}

/** Create a temp dir and register it in an array or set for cleanup. */
export function makeTempDir(tempDirs: TempDirCollection, prefix: string, root?: string): string {
  const tempRoot = root ?? resolveCanonicalSystemTempRoot();
  const dir = fs.mkdtempSync(path.join(tempRoot, prefix));
  if (Array.isArray(tempDirs)) {
    tempDirs.push(dir);
  } else {
    tempDirs.add(dir);
  }
  return dir;
}

const TEMP_DIR_RM_MAX_RETRIES = process.platform === "win32" ? 60 : 5;
const TEMP_DIR_RM_RETRY_DELAY_MS = process.platform === "win32" ? 100 : 20;
const TEMP_DIR_RM_POST_RETRY_PAUSE_MS = process.platform === "win32" ? 250 : 0;

function clearTempDirCollection(tempDirs: TempDirCollection): void {
  if (Array.isArray(tempDirs)) {
    tempDirs.length = 0;
    return;
  }
  tempDirs.clear();
}

/** Remove tracked directories, retaining failed removals for cleanup retry. */
export function cleanupTempDirs(tempDirs: TempDirCollection): void {
  // Successful releases mutate the tracker; walk the original ownership snapshot.
  const dirs = [...tempDirs];
  const errors: unknown[] = [];
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, {
        recursive: true,
        force: true,
        maxRetries: TEMP_DIR_RM_MAX_RETRIES,
        retryDelay: TEMP_DIR_RM_RETRY_DELAY_MS,
      });
      if (Array.isArray(tempDirs)) {
        tempDirs.splice(tempDirs.indexOf(dir), 1);
      } else {
        tempDirs.delete(dir);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, "Test temporary directory cleanup failed");
  }
}

export function createTempDirTracker(): TestTempDirTracker {
  const dirs = new Set<string>();
  return {
    dirs,
    make(prefix: string, root?: string): string {
      return makeTempDir(dirs, prefix, root);
    },
    cleanup(this: void): void {
      try {
        cleanupTempDirs(dirs);
      } catch (firstError) {
        let error = firstError;
        if (TEMP_DIR_RM_POST_RETRY_PAUSE_MS > 0) {
          Atomics.wait(
            new Int32Array(new SharedArrayBuffer(4)),
            0,
            0,
            TEMP_DIR_RM_POST_RETRY_PAUSE_MS,
          );
          try {
            cleanupTempDirs(dirs);
            return;
          } catch (retryError) {
            error = retryError;
          }
        }
        // afterEach hooks share this tracker. A locked leftover must fail this
        // test, not every later case that retries the same EPERM.
        clearTempDirCollection(dirs);
        throw error;
      }
    },
  };
}

/** Create a temp dir tracker that Vitest cleans up after each test. */
export function useAutoCleanupTempDirTracker(
  registerCleanup: RegisterTempDirCleanup,
): AutoCleanupTempDirTracker {
  const tracker = createTempDirTracker();
  registerCleanup(tracker.cleanup);
  return tracker;
}
