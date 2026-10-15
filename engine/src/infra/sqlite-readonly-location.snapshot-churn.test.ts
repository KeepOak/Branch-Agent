import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  adoptPreparedLocation,
  cleanupSnapshotOperations,
  createSyncRemovalBudget,
  deferredSnapshotRemovalPolicy,
  removeTempDirectory,
  retireSqliteSnapshotPayload,
} from "./sqlite-readonly-location-cleanup.js";
import {
  acquireSqliteSnapshotReadToken,
  createSqliteSnapshotStagingDirectorySync,
  createSqliteSnapshotStagingTokenSync,
  reclaimAbandonedSqliteSnapshots,
} from "./sqlite-snapshot-staging.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(async () => {
    vi.restoreAllMocks();
    // Staging directories hold native token handles and may still have a deferred removal in flight.
    // On Windows either one makes removing the temp root fail with EPERM, so join them first.
    await cleanupSnapshotOperations();
    cleanup();
  });
});

const SNAPSHOT_PREFIX = "branch-sqlite-readonly-v2-";
const ORPHAN_AGE_MS = 11 * 60_000;

function createCache(): string {
  const cache = path.join(tempDirs.make("sqlite-snapshot-churn-"), "cache");
  fs.mkdirSync(cache);
  return cache;
}

function snapshotDirectories(cache: string): string[] {
  return fs.readdirSync(cache).filter((name) => name.startsWith(SNAPSHOT_PREFIX));
}

function writeSnapshot(directory: string): string {
  const location = path.join(directory, "database.sqlite");
  fs.writeFileSync(location, "private synthetic snapshot");
  return location;
}

function ageTree(directory: string, ageMs: number): void {
  const stale = new Date(Date.now() - ageMs);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      ageTree(location, ageMs);
    }
    fs.utimesSync(location, stale, stale);
  }
  fs.utimesSync(directory, stale, stale);
}

/**
 * SYNTHETIC: this stands in for a transient Windows lock and does not reproduce it. The first removal of each
 * path throws a fabricated EBUSY, so the retry path is exercised. The real Windows error seen on the affected
 * machine is EPERM (see the PR body): a node:sqlite handle still open at rm time.
 */
function busyOnFirstRemoval(remove: typeof fs.rmSync): typeof fs.rmSync {
  const attempted = new Set<string>();
  return ((target, options) => {
    const key = String(target);
    if (!attempted.has(key)) {
      attempted.add(key);
      throw Object.assign(new Error(`EBUSY: resource busy or locked, rm '${key}'`), {
        code: "EBUSY",
      });
    }
    return remove(target, options);
  }) as typeof fs.rmSync;
}

it("keeps snapshot directories bounded across a create-and-release loop when removal hits EBUSY", () => {
  const cache = createCache();
  const remove = fs.rmSync;
  const stub = vi.spyOn(fs, "rmSync").mockImplementation(busyOnFirstRemoval(remove));
  try {
    for (let index = 0; index < 25; index += 1) {
      const directory = createSqliteSnapshotStagingDirectorySync(cache);
      const prepared = adoptPreparedLocation(writeSnapshot(directory), directory);
      expect(prepared.cleanup()).toBe(true);
      expect(snapshotDirectories(cache).length).toBeLessThanOrEqual(1);
    }
  } finally {
    stub.mockRestore();
  }
  expect(snapshotDirectories(cache)).toEqual([]);
});

/**
 * SIMULATED: a briefly-held Windows handle. Removal of the directory throws EPERM until the window ends.
 * Evidence for the mechanism: a node:sqlite handle left open inside a snapshot directory makes rm fail
 * with EPERM (errno 1, syscall rm) on Windows, and the same directories were removed without error once
 * the holder released (the interim sweep removed 1,000+ leaked directories with zero errors).
 */
it("removes a snapshot that a briefly-held Windows handle blocks past the inline backoff", async () => {
  const cache = createCache();
  const directory = createSqliteSnapshotStagingDirectorySync(cache);
  writeSnapshot(directory);
  const blockedUntil = Date.now() + 1_500;
  const blocked = (target: fs.PathLike) =>
    Date.now() < blockedUntil && String(target).startsWith(directory);
  const eperm = (target: fs.PathLike) =>
    Object.assign(new Error(`EPERM: operation not permitted, rm '${String(target)}'`), {
      code: "EPERM",
    });
  const syncRemove = fs.rmSync;
  const asyncRemove = fs.promises.rm;
  vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (blocked(target)) {
      throw eperm(target);
    }
    return syncRemove(target, options);
  });
  vi.spyOn(fs.promises, "rm").mockImplementation(async (target, options) => {
    if (blocked(target)) {
      throw eperm(target);
    }
    return asyncRemove(target, options);
  });

  // The inline backoff gives up while the handle is still held; the removal must then complete on its own.
  expect(removeTempDirectory(directory)).toBe(false);
  const deadline = Date.now() + 5_000;
  while (fs.existsSync(directory) && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  expect(fs.existsSync(directory)).toBe(false);
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Fails every removal under the directory with the given error and counts the attempts. */
function failRemovals(directory: string, failure: () => Error): { attempts: () => number } {
  let count = 0;
  const syncRemove = fs.rmSync;
  const asyncRemove = fs.promises.rm;
  vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (String(target).startsWith(directory)) {
      count += 1;
      throw failure();
    }
    return syncRemove(target, options);
  });
  vi.spyOn(fs.promises, "rm").mockImplementation(async (target, options) => {
    if (String(target).startsWith(directory)) {
      count += 1;
      throw failure();
    }
    return asyncRemove(target, options);
  });
  return { attempts: () => count };
}

it("does not keep retrying a removal that fails with a non-transient error", async () => {
  const cache = createCache();
  const directory = createSqliteSnapshotStagingDirectorySync(cache);
  writeSnapshot(directory);
  const attempts = failRemovals(directory, () =>
    Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }),
  );
  expect(removeTempDirectory(directory)).toBe(false);
  // Let several retry intervals pass; a non-transient failure must not be retried again.
  await sleep(1_500);
  const settled = attempts.attempts();
  await sleep(2_500);
  expect(attempts.attempts()).toBe(settled);
  expect(fs.existsSync(directory)).toBe(true);
});

it("gives up a transient removal once the retry window ends and leaves the directory for the sweep", async () => {
  const cache = createCache();
  const directory = createSqliteSnapshotStagingDirectorySync(cache);
  writeSnapshot(directory);
  const previousWindow = deferredSnapshotRemovalPolicy.giveUpAfterMs;
  deferredSnapshotRemovalPolicy.giveUpAfterMs = 1_500;
  try {
    const attempts = failRemovals(directory, () =>
      Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" }),
    );
    expect(removeTempDirectory(directory)).toBe(false);
    // The retry window ends during this wait; retries then stop.
    await sleep(4_000);
    const retried = attempts.attempts();
    await sleep(2_500);
    expect(attempts.attempts()).toBe(retried);
    expect(fs.existsSync(directory)).toBe(true);
  } finally {
    deferredSnapshotRemovalPolicy.giveUpAfterMs = previousWindow;
  }
});

it("caps the blocking wait of one snapshot removal across all its paths", () => {
  const cache = createCache();
  const directory = createSqliteSnapshotStagingDirectorySync(cache);
  // Three payload paths, each held for its first five removal attempts (the full inline backoff) and then
  // released. Unshared waits would total 3 x 620 ms; the per-snapshot budget caps the wait at 620 ms.
  const payload = ["database.sqlite", "database.sqlite-wal", "database.sqlite-shm"].map((name) => {
    const file = path.join(directory, name);
    fs.writeFileSync(file, "held");
    return file;
  });
  const syncRemove = fs.rmSync;
  const attemptsByPath = new Map<string, number>();
  vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    const key = String(target);
    if (payload.includes(key)) {
      const count = (attemptsByPath.get(key) ?? 0) + 1;
      attemptsByPath.set(key, count);
      if (count <= 5) {
        throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      }
    }
    return syncRemove(target, options);
  });
  // The injected sleep records each blocking wait instead of blocking, so the totals are exact on any machine.
  const waitsMs: number[] = [];
  const budget = createSyncRemovalBudget((ms) => {
    waitsMs.push(ms);
  });
  const capMs = budget.remainingMs;
  const retirement = { payload, retire: () => {} } as unknown as Parameters<
    typeof retireSqliteSnapshotPayload
  >[0];
  // One call retires one snapshot's payload, so one budget covers all three paths. The first path spends the
  // whole budget, so the second held path fails at once and the third is never attempted.
  expect(() => retireSqliteSnapshotPayload(retirement, budget)).toThrow("EBUSY");
  const totalWaitMs = waitsMs.reduce((total, wait) => total + wait, 0);
  expect(totalWaitMs).toBeLessThanOrEqual(capMs);
  expect(attemptsByPath.get(payload[2])).toBeUndefined();
});

it("reclaims an orphaned snapshot older than ten minutes but spares one with an active reader", () => {
  const cache = createCache();
  const orphan = createSqliteSnapshotStagingTokenSync(cache);
  writeSnapshot(orphan.directory);
  // The owning process died: nothing holds the token any more.
  orphan.release();
  ageTree(orphan.directory, ORPHAN_AGE_MS);

  const live = createSqliteSnapshotStagingTokenSync(cache);
  writeSnapshot(live.directory);
  live.release();
  ageTree(live.directory, ORPHAN_AGE_MS);
  const releaseReader = acquireSqliteSnapshotReadToken(live.directory);
  try {
    for (const _ of reclaimAbandonedSqliteSnapshots(cache, () => {})) {
      // Drain the generator: each step reclaims at most one directory.
    }
    expect(fs.existsSync(orphan.directory)).toBe(false);
    expect(fs.existsSync(live.directory)).toBe(true);
  } finally {
    releaseReader();
  }
});

it("does not retry removal errors outside the EBUSY, EPERM and ENOTEMPTY set", () => {
  const cache = createCache();
  const directory = createSqliteSnapshotStagingDirectorySync(cache);
  const prepared = adoptPreparedLocation(writeSnapshot(directory), directory);
  const remove = fs.rmSync;
  const failure = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
  const stub = vi.spyOn(fs, "rmSync").mockImplementation((target, options) => {
    if (String(target) === directory) {
      throw failure;
    }
    return remove(target, options);
  });
  try {
    expect(prepared.cleanup()).toBe(false);
    expect(stub.mock.calls.filter(([target]) => String(target) === directory)).toHaveLength(1);
  } finally {
    stub.mockRestore();
  }
  expect(prepared.cleanup()).toBe(true);
});
