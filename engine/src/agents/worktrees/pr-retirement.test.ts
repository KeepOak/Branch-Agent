import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPullRequestRetirementCheck } from "./pr-retirement.js";
import type { ManagedWorktreeRecord } from "./types.js";

type PrFixture = { state: "open" | "merged" | "closed"; headSha?: string };

function git(cwd: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

let temp: string;
let repo: string;

function commitIn(folder: string, name: string): void {
  fs.writeFileSync(path.join(folder, name + ".txt"), name);
  git(folder, "add", ".");
  git(folder, "commit", "-m", name);
}

/** A managed-style worktree on its own branch, pushed to origin unless told otherwise. */
function addWorktree(name: string, pushed = true): string {
  const target = path.join(temp, "managed", name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  git(repo, "worktree", "add", "-b", name, target, "origin/main");
  commitIn(target, name);
  if (pushed) {
    git(target, "push", "-u", "origin", name);
  }
  return target;
}

function recordFor(name: string, worktreePath: string): ManagedWorktreeRecord {
  return { id: name, branch: name, path: worktreePath, repoRoot: repo } as ManagedWorktreeRecord;
}

/** Runs the check for one worktree whose branch has the given pull request fixture (or none). */
async function retiredWith(name: string, pr: PrFixture | undefined): Promise<boolean> {
  const worktree = path.join(temp, "managed", name);
  const check = createPullRequestRetirementCheck({
    pullRequestState: async ({ branch }) =>
      branch === name && pr ? { state: pr.state, headSha: pr.headSha ?? null } : null,
  });
  return await check(recordFor(name, worktree));
}

beforeEach(() => {
  temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pr-retirement-")));
  const origin = path.join(temp, "origin.git");
  git(temp, "init", "--bare", "-b", "main", origin);
  repo = path.join(temp, "Parent");
  git(temp, "clone", origin, repo);
  git(repo, "checkout", "-b", "main");
  commitIn(repo, "readme");
  git(repo, "push", "-u", "origin", "main");
});

afterEach(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

describe("pull request retirement for managed worktrees", () => {
  it("retires a clean, pushed worktree whose pull request merged", async () => {
    const worktree = addWorktree("job-merged");

    expect(await retiredWith("job-merged", { state: "merged" })).toBe(true);
    expect(fs.existsSync(worktree)).toBe(true);
  });

  it("retires a clean, pushed worktree whose pull request was closed", async () => {
    addWorktree("job-closed");

    expect(await retiredWith("job-closed", { state: "closed" })).toBe(true);
  });

  it("keeps a worktree whose pull request is still open", async () => {
    addWorktree("job-open");

    expect(await retiredWith("job-open", { state: "open" })).toBe(false);
  });

  it("keeps a worktree with no pull request on record", async () => {
    addWorktree("job-none");

    expect(await retiredWith("job-none", undefined)).toBe(false);
  });

  it("keeps a dirty worktree even when its pull request merged", async () => {
    const worktree = addWorktree("job-dirty");
    fs.writeFileSync(path.join(worktree, "scratch.txt"), "not committed");

    expect(await retiredWith("job-dirty", { state: "merged" })).toBe(false);
  });

  it("keeps a worktree that has a commit no remote holds", async () => {
    const worktree = addWorktree("job-unpushed");
    const pushedHead = git(worktree, "rev-parse", "HEAD");
    commitIn(worktree, "local-only");

    expect(await retiredWith("job-unpushed", { state: "merged", headSha: pushedHead })).toBe(false);
  });

  it("retires a worktree whose remote branch was deleted after merge", async () => {
    const worktree = addWorktree("job-deleted-remote");
    git(worktree, "push", "origin", "--delete", "job-deleted-remote");
    const head = git(worktree, "rev-parse", "HEAD");

    expect(await retiredWith("job-deleted-remote", { state: "merged", headSha: head })).toBe(true);
  });
});
