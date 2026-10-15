import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildWorktreeCleanupResult } from "../agents/build-worktrees/cleanup.js";
import type { BranchConfig } from "../config/types.branch.js";
import {
  createGatewaySchedulerClock,
  createTestGatewayScheduler,
} from "../test-utils/gateway-scheduler-clock.js";
import {
  BUILD_WORKTREE_MERGE_WATCH_MS,
  BUILD_WORKTREE_SWEEP_MS,
  buildWorktreeCleanupStatePath,
  readLastBuildWorktreeCleanup,
  resolveBuildWorktreeRoots,
  startBuildWorktreeCleanup,
} from "./build-worktree-cleanup.js";
import { buildWorktreesHandlers } from "./server-methods/build-worktrees.js";

const temps: string[] = [];
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "build-worktree-owner-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function result(line: string): BuildWorktreeCleanupResult {
  return {
    report: { at: 1, removed: 0, freedBytes: 0, retrying: 0, kept: {}, line },
    repositories: [{ commonDir: "/repo/.git", cwd: "/repo" }],
  };
}

describe("build worktree cleanup owner", () => {
  it("sweeps every 30 minutes and again when a merge moves origin's default branch", async () => {
    const clock = createGatewaySchedulerClock();
    const scheduler = createTestGatewayScheduler(clock.clock);
    const home = tempDir();
    const run = vi.fn(async () => result("freed 0 MB, removed 0 worktrees"));
    const heads = ["aaa", "aaa", "bbb"];
    const info = vi.fn();
    const owner = startBuildWorktreeCleanup({
      scheduler,
      getRuntimeConfig: () => ({}),
      log: { info, error: vi.fn() },
      env: { HOME: home, BRANCH_STATE_DIR: path.join(home, "state") },
      run,
      readRemoteHead: async () => heads.shift() ?? null,
    });
    try {
      await clock.advanceBy(2 * 60_000);
      expect(run).toHaveBeenCalledTimes(1);
      expect(run.mock.calls[0]?.[0].roots).toEqual([path.join(home, "branch-work")]);
      expect(info).toHaveBeenCalledWith("build worktree cleanup: freed 0 MB, removed 0 worktrees");

      await clock.advanceBy(BUILD_WORKTREE_MERGE_WATCH_MS);
      await clock.advanceBy(BUILD_WORKTREE_MERGE_WATCH_MS);
      expect(run).toHaveBeenCalledTimes(1);
      await clock.advanceBy(BUILD_WORKTREE_MERGE_WATCH_MS);
      expect(run).toHaveBeenCalledTimes(2);

      await clock.advanceBy(BUILD_WORKTREE_SWEEP_MS);
      expect(run.mock.calls.length).toBeGreaterThanOrEqual(3);
    } finally {
      await owner.stop();
      await scheduler.stop();
    }
  });

  it("runs one more sweep when asked during a sweep instead of overlapping", async () => {
    const clock = createGatewaySchedulerClock();
    const scheduler = createTestGatewayScheduler(clock.clock);
    let release: () => void = () => {};
    let active = 0;
    let most = 0;
    const run = vi.fn(async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      active -= 1;
      return result("freed 0 MB, removed 0 worktrees");
    });
    const owner = startBuildWorktreeCleanup({
      scheduler,
      getRuntimeConfig: () => ({}),
      log: { info: vi.fn(), error: vi.fn() },
      env: { HOME: tempDir() },
      run,
    });
    try {
      const first = owner.request();
      void owner.request();
      void owner.request();
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
      release();
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
      release();
      await first;
      expect(run).toHaveBeenCalledTimes(2);
      expect(most).toBe(1);
    } finally {
      await owner.stop();
      await scheduler.stop();
    }
  });

  it("uses the person's home for the default root and turns off with an empty list", () => {
    const env = { HOME: "/home/person", BRANCH_HOME: "/home/person/.app-home" };
    expect(resolveBuildWorktreeRoots({}, env)).toEqual([path.resolve("/home/person/branch-work")]);
    const config: BranchConfig = { buildWorktreeRoots: [] };
    expect(resolveBuildWorktreeRoots(config, env)).toEqual([]);
    expect(resolveBuildWorktreeRoots({ buildWorktreeRoots: ["~/builds", "/srv/ci"] }, env)).toEqual(
      [path.resolve("/home/person/builds"), path.resolve("/srv/ci")],
    );
  });

  it("buildWorktrees.status returns the last run's line", async () => {
    const stateDir = tempDir();
    vi.stubEnv("BRANCH_STATE_DIR", stateDir);
    const statePath = buildWorktreeCleanupStatePath();
    const last = {
      at: 1_700_000_000_000,
      removed: 5,
      freedBytes: 6.2 * 1024 ** 3,
      retrying: 0,
      kept: { dirty: 1 },
      line: "freed 6.2 GB, removed 5 worktrees",
    };
    fs.writeFileSync(statePath, JSON.stringify({ version: 1, removing: [], last }));
    expect(await readLastBuildWorktreeCleanup()).toEqual(last);

    const respond = vi.fn();
    await buildWorktreesHandlers["buildWorktrees.status"]?.({
      respond,
      context: { getRuntimeConfig: () => ({}) },
    } as never);
    expect(respond).toHaveBeenCalledWith(true, { enabled: true, last }, undefined);
  });
});
