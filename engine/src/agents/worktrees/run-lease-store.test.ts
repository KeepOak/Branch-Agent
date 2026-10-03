import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import {
  closeBranchStateDatabaseAsync,
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../../state/branch-state-db.js";
import { captureBranchStateWorkerContext } from "../../state/branch-state-worker-context.js";
import { observeMainThreadSql } from "../../test-utils/main-thread-sql-spies.test-support.js";
import { insertRegistryWorktree } from "./registry.js";
import {
  admitWorktreeRunLeaseRowAsync,
  releaseWorktreeRunLeaseRowAsync,
} from "./run-lease-store.js";

const dirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(async () => {
  vi.restoreAllMocks();
  await closeBranchStateDatabaseAsync();
});

it("settles exact lease deletions without host SQL or fsync and refuses a retired store", async () => {
  const env = { ...process.env, BRANCH_STATE_DIR: dirs.make("worktree-release-worker-") };
  const database = openBranchStateDatabase({ env });
  insertRegistryWorktree(env, {
    id: "synthetic",
    name: "synthetic",
    repoFingerprint: "0123456789abcdef",
    repoRoot: env.BRANCH_STATE_DIR,
    path: env.BRANCH_STATE_DIR,
    branch: "synthetic",
    baseRef: "HEAD",
    ownerKind: "session",
    createdAt: 1,
    lastActiveAt: 1,
  });
  runBranchStateWriteTransaction(
    ({ db }) => {
      const insert = db.prepare(
        "INSERT INTO state_leases (scope, lease_key, owner, created_at, updated_at) VALUES (?, ?, ?, 1, 1)",
      );
      for (let index = 0; index < 100; index++) {
        insert.run("worktree-run:synthetic", `run-${index}`, "synthetic-owner");
      }
      insert.run("worktree-run:synthetic", "successor", "synthetic-owner");
      insert.run("worktree-run:other", "run-0", "synthetic-owner");
    },
    { database, env },
  );
  const context = captureBranchStateWorkerContext({ env });
  const sql = observeMainThreadSql();
  const sync = vi.spyOn(fs, "fsyncSync");
  try {
    for (let index = 0; index < 100; index++) {
      await releaseWorktreeRunLeaseRowAsync(env, "synthetic", `run-${index}`, context);
    }
    sql.expectIdle();
    expect(sync).not.toHaveBeenCalled();
  } finally {
    sql.restore();
    sync.mockRestore();
  }
  expect(
    database.db
      .prepare("SELECT scope, lease_key FROM state_leases ORDER BY scope, lease_key")
      .all(),
  ).toEqual([
    { scope: "worktree-run:other", lease_key: "run-0" },
    { scope: "worktree-run:synthetic", lease_key: "successor" },
  ]);
  await closeBranchStateDatabaseAsync();
  await expect(
    releaseWorktreeRunLeaseRowAsync(env, "synthetic", "successor", context),
  ).rejects.toThrow();
  const settlement = vi.fn();
  await expect(
    admitWorktreeRunLeaseRowAsync(
      context,
      {
        worktreeId: "synthetic",
        token: "retired-admission",
        pid: process.pid,
        startTime: null,
        now: 1,
      },
      settlement,
    ),
  ).rejects.toThrow();
  expect(settlement).toHaveBeenCalledExactlyOnceWith("not-entered");
  expect(
    openBranchStateDatabase({ env })
      .db.prepare("SELECT COUNT(*) AS count FROM state_leases")
      .get(),
  ).toMatchObject({ count: 2 });
});
