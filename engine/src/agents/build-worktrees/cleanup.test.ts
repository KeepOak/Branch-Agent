import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatBuildWorktreeCleanupLine,
  parseWorktreeList,
  REMOVING_PREFIX,
  runBuildWorktreeCleanup,
  type BuildWorktreeCleanupDeps,
  type PullRequestState,
} from "./cleanup.js";
import { createBuildWorktreeCleanupDeps } from "./cleanup.runtime.js";
import { buildWorktreeGitArgs, toLongPathSafe } from "./long-path.js";

const HOUR = 60 * 60 * 1000;

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
let root: string;
let repo: string;
let statePath: string;

function addWorktree(name: string, options: { push?: boolean; under?: string } = {}): string {
  const target = path.join(options.under ?? root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  git(repo, "worktree", "add", "-b", name, target, "origin/main");
  fs.writeFileSync(path.join(target, name + ".txt"), name);
  git(target, "add", ".");
  git(target, "commit", "-m", name);
  if (options.push !== false) {
    git(target, "push", "-u", "origin", name);
  }
  return fs.realpathSync.native(target);
}

/** Native realpath expands Windows 8.3 short names (RUNNER~1) the way Git and the cleanup see them. */
function canonical(target: string): string {
  try {
    return fs.realpathSync.native(target);
  } catch {
    return path.resolve(target);
  }
}

function listedWorktrees(): string[] {
  return parseWorktreeList(git(repo, "worktree", "list", "--porcelain")).map((w) =>
    canonical(w.path),
  );
}

function deps(overrides: Partial<BuildWorktreeCleanupDeps> = {}, merged: string[] = []) {
  return {
    ...createBuildWorktreeCleanupDeps(),
    processDirectories: async () => [],
    pullRequestState: async ({ branch }: { branch: string }): Promise<PullRequestState | null> =>
      merged.includes(branch) ? "merged" : "open",
    diskSpace: () => ({ availableBytes: 900, totalBytes: 1000 }),
    ...overrides,
  } satisfies BuildWorktreeCleanupDeps;
}

async function run(d: BuildWorktreeCleanupDeps, roots = [root]) {
  return await runBuildWorktreeCleanup({ roots, statePath, deps: d });
}

beforeEach(() => {
  temp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "build-worktrees-")));
  root = path.join(temp, "builds");
  fs.mkdirSync(root);
  statePath = path.join(temp, "state", "build-worktree-cleanup.json");
  const origin = path.join(temp, "origin.git");
  git(temp, "init", "--bare", "-b", "main", origin);
  repo = path.join(root, "Product");
  git(temp, "clone", origin, repo);
  git(repo, "checkout", "-b", "main");
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
  fs.writeFileSync(path.join(repo, "README.md"), "fixture\n");
  git(repo, "add", ".");
  git(repo, "commit", "-m", "initial");
  git(repo, "push", "-u", "origin", "main");
});

afterEach(() => {
  fs.rmSync(temp, { recursive: true, force: true });
});

describe("build worktree cleanup", () => {
  it("removes a merged-PR worktree and reports one line", async () => {
    const merged = addWorktree("card-merged");
    const active = addWorktree("card-active");

    const { report } = await run(deps({}, ["card-merged"]));

    expect(fs.existsSync(merged)).toBe(false);
    expect(fs.existsSync(active)).toBe(true);
    expect(listedWorktrees()).not.toContain(merged);
    expect(report.removed).toBe(1);
    expect(report.freedBytes).toBeGreaterThan(0);
    expect(report.kept.active).toBe(1);
    expect(report.line).toMatch(/^freed \d+ MB, removed 1 worktree$/);
    expect(JSON.parse(fs.readFileSync(statePath, "utf8")).last.line).toBe(report.line);
  });

  it("keeps dirty, unpushed and parent checkouts even when their PR merged", async () => {
    const dirty = addWorktree("card-dirty");
    fs.writeFileSync(path.join(dirty, "notes.txt"), "unsaved");
    const unpushed = addWorktree("card-unpushed");
    fs.writeFileSync(path.join(unpushed, "more.txt"), "more");
    git(unpushed, "add", ".");
    git(unpushed, "commit", "-m", "not pushed yet");
    const neverPushed = addWorktree("card-local", { push: false });

    const { report } = await run(deps({}, ["card-dirty", "card-unpushed", "card-local", "main"]));

    for (const kept of [dirty, unpushed, neverPushed, repo]) {
      expect(fs.existsSync(kept)).toBe(true);
    }
    expect(fs.existsSync(path.join(repo, ".git", "worktrees"))).toBe(true);
    expect(report.removed).toBe(0);
    expect(report.kept).toMatchObject({ dirty: 1, unpushed: 2 });
  });

  it("removes a worktree whose branch is gone from origin, or that sat untouched for 48 hours", async () => {
    const gone = addWorktree("card-gone");
    // GitHub deletes the head branch on merge; the local remote-tracking ref lingers until a pruning fetch.
    git(temp, "--git-dir", path.join(temp, "origin.git"), "branch", "-D", "card-gone");
    const idle = addWorktree("card-idle");

    const first = await run(deps());
    expect(fs.existsSync(gone)).toBe(false);
    expect(fs.existsSync(idle)).toBe(true);
    expect(first.report.removed).toBe(1);

    const later = await run(deps({ now: () => Date.now() + 49 * HOUR }));
    expect(fs.existsSync(idle)).toBe(false);
    expect(later.report.removed).toBe(1);
  });

  it("removes a merged worktree when its parent repo lives outside the build roots", async () => {
    const outsideRoot = path.join(temp, "parents");
    fs.mkdirSync(outsideRoot);
    const parent = path.join(outsideRoot, "Product");
    fs.renameSync(repo, parent);
    repo = parent;
    git(repo, "worktree", "repair");
    const merged = addWorktree("card-alone");

    const { report } = await run(deps({}, ["card-alone"]));

    expect(report.removed).toBe(1);
    expect(fs.existsSync(merged)).toBe(false);
    expect(listedWorktrees()).not.toContain(merged);
    expect(fs.existsSync(repo)).toBe(true);
  });

  it("keeps a worktree a process is working in", async () => {
    const busy = addWorktree("card-busy");
    const { report } = await run(
      deps({ processDirectories: async () => [path.join(busy, "engine")] }, ["card-busy"]),
    );
    expect(fs.existsSync(busy)).toBe(true);
    expect(report.kept["in-use"]).toBe(1);
  });

  it("never touches protected folders or worktrees outside the build roots", async () => {
    const junk = addWorktree("card-junk", { under: path.join(root, "DELETE-ME-junk") });
    const nas = addWorktree("card-nas", { under: path.join(root, "moved-to-nas") });
    const outside = addWorktree("card-outside", { under: path.join(temp, "elsewhere") });
    const managed = addWorktree("card-managed", { under: path.join(root, "managed") });

    const { report } = await runBuildWorktreeCleanup({
      roots: [root],
      excludeDirs: [path.join(root, "managed")],
      statePath,
      deps: deps({}, ["card-junk", "card-nas", "card-outside", "card-managed"]),
    });

    for (const kept of [junk, nas, outside, managed]) {
      expect(fs.existsSync(kept)).toBe(true);
    }
    expect(report.removed).toBe(0);
  });

  it("retries a locked file on the next run instead of forcing it", async () => {
    const locked = addWorktree("card-locked");
    const real = createBuildWorktreeCleanupDeps();
    let held = true;
    const removeTree = async (target: string) => {
      if (held) {
        throw Object.assign(new Error("resource busy or locked"), { code: "EBUSY" });
      }
      await real.removeTree(target);
    };

    const first = await run(deps({ removeTree }, ["card-locked"]));
    expect(first.report).toMatchObject({ removed: 1, retrying: 1, freedBytes: 0 });
    expect(first.report.line).toContain("still deleting, retried later");
    expect(fs.existsSync(locked)).toBe(false);
    expect(listedWorktrees()).not.toContain(locked);
    const aside = fs.readdirSync(root).filter((name) => name.startsWith(REMOVING_PREFIX));
    expect(aside).toHaveLength(1);

    held = false;
    const second = await run(deps({ removeTree }, ["card-locked"]));
    expect(fs.readdirSync(root).filter((name) => name.startsWith(REMOVING_PREFIX))).toEqual([]);
    expect(second.report).toMatchObject({ removed: 0, retrying: 0 });
    expect(second.report.freedBytes).toBeGreaterThan(0);
  });

  it("keeps a worktree whose files Windows holds open and retries it next run", async () => {
    const open = addWorktree("card-open");
    const rename = async () => {
      throw Object.assign(new Error("operation not permitted"), { code: "EPERM" });
    };
    const { report } = await run(deps({ rename }, ["card-open"]));
    expect(fs.existsSync(open)).toBe(true);
    expect(listedWorktrees()).toContain(open);
    expect(report.kept["in-use"]).toBe(1);
  });

  it("on Windows deletes through long-path-safe paths and runs Git with core.longpaths", async () => {
    const windows = addWorktree("card-windows");
    const gitArgs: string[][] = [];
    const real = createBuildWorktreeCleanupDeps();
    const renamed: string[] = [];
    await run(
      deps(
        {
          platform: "win32",
          processDirectories: async () => null,
          git: async (cwd, args) => {
            gitArgs.push(args);
            return await real.git(cwd, args);
          },
          rename: async (from, to) => {
            renamed.push(from, to);
          },
          removeTree: async (target) => {
            renamed.push(target);
          },
        },
        ["card-windows"],
      ),
    );
    expect(renamed[0]).toBe(toLongPathSafe(windows, "win32"));
    expect(renamed).toHaveLength(3);
    expect(renamed[2]).toBe(renamed[1]);
    expect(path.win32.basename(renamed[1] ?? "").startsWith(REMOVING_PREFIX)).toBe(true);
    expect(gitArgs.length).toBeGreaterThan(0);
    expect(gitArgs.every((args) => args[0] === "-c" && args[1] === "core.longpaths=true")).toBe(
      true,
    );
  });

  it("clears node_modules from idle worktrees first when disk is under 15% free", async () => {
    const idle = addWorktree("card-modules");
    fs.mkdirSync(path.join(idle, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(idle, "node_modules", "pkg", "index.js"), "x".repeat(4096));
    fs.mkdirSync(path.join(idle, "engine", "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(idle, "engine", "node_modules", "a.js"), "y".repeat(4096));
    const busy = addWorktree("card-modules-busy");
    fs.mkdirSync(path.join(busy, "node_modules"), { recursive: true });

    const { report } = await run(
      deps({
        now: () => Date.now() + 3 * HOUR,
        diskSpace: () => ({ availableBytes: 100, totalBytes: 1000 }),
        processDirectories: async () => [busy],
      }),
    );

    expect(fs.existsSync(idle)).toBe(true);
    expect(fs.existsSync(path.join(idle, "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(idle, "engine", "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(idle, "card-modules.txt"))).toBe(true);
    expect(fs.existsSync(path.join(busy, "node_modules"))).toBe(true);
    expect(report.freedBytes).toBeGreaterThanOrEqual(8192);
    expect(report.removed).toBe(0);
  });
});

describe("build worktree cleanup helpers", () => {
  it("formats the report line", () => {
    expect(
      formatBuildWorktreeCleanupLine({ removed: 5, freedBytes: 6.2 * 1024 ** 3, retrying: 0 }),
    ).toBe("freed 6.2 GB, removed 5 worktrees");
  });

  it("makes Windows paths long-path safe and leaves others alone", () => {
    expect(toLongPathSafe("C:\\work\\wt\\node_modules", "win32")).toBe(
      "\\\\?\\C:\\work\\wt\\node_modules",
    );
    expect(toLongPathSafe("\\\\server\\share\\wt", "win32")).toBe("\\\\?\\UNC\\server\\share\\wt");
    expect(toLongPathSafe("/work/wt", "darwin")).toBe("/work/wt");
    expect(buildWorktreeGitArgs(["status"], "win32")).toEqual([
      "-c",
      "core.longpaths=true",
      "status",
    ]);
    expect(buildWorktreeGitArgs(["status"], "linux")).toEqual(["status"]);
  });
});
