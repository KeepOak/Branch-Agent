import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { adoptPreparedLocation } from "./sqlite-readonly-location-cleanup.js";
import {
  acquireSqliteSnapshotReadToken,
  createSqliteSnapshotStagingDirectorySync,
  createSqliteSnapshotStagingTokenSync,
  reclaimAbandonedSqliteSnapshots,
} from "./sqlite-snapshot-staging.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) => {
  afterEach(() => {
    vi.restoreAllMocks();
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
