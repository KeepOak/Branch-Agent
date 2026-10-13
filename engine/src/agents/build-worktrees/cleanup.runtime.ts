// Real filesystem, Git, process and GitHub access for the build worktree cleanup.
import fs from "node:fs/promises";
import path from "node:path";
import { tryReadDiskSpace } from "../../infra/disk-space.js";
import { runCommandWithTimeout } from "../../process/exec-runner.js";
import { measureDirectoryTreeBytes } from "../worktrees/capacity.runtime.js";
import { runGit } from "../worktrees/git.js";
import type { BuildWorktreeCleanupDeps, PullRequestState } from "./cleanup.js";

const GIT_TIMEOUT_MS = 60_000;
const PROCESS_LIST_TIMEOUT_MS = 20_000;
const GH_TIMEOUT_MS = 20_000;

/** owner/name for a github.com remote, in https or ssh form. */
export function parseGitHubRepository(originUrl: string): string | null {
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(originUrl.trim());
  return match ? match[1] + "/" + match[2] : null;
}

/** lsof -F n output: one "n<path>" line per process working folder. */
export function parseLsofWorkingDirectories(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("n/"))
    .map((line) => line.slice(1));
}

async function linuxWorkingDirectories(): Promise<string[] | null> {
  let pids: string[];
  try {
    pids = (await fs.readdir("/proc")).filter((name) => /^\d+$/.test(name));
  } catch {
    return null;
  }
  const dirs: string[] = [];
  for (const pid of pids) {
    try {
      dirs.push(await fs.readlink(path.join("/proc", pid, "cwd")));
    } catch {
      // Processes owned by other users or already gone.
    }
  }
  return dirs;
}

async function lsofWorkingDirectories(): Promise<string[] | null> {
  try {
    const result = await runCommandWithTimeout(
      ["lsof", "-w", "-n", "-P", "-a", "-d", "cwd", "-F", "n"],
      {
        timeoutMs: PROCESS_LIST_TIMEOUT_MS,
      },
    );
    // lsof exits 1 when some processes could not be read but still prints the rest.
    return result.stdout ? parseLsofWorkingDirectories(result.stdout) : null;
  } catch {
    return null;
  }
}

/** Working folders of running processes. Windows has no cheap list; its locked move-aside covers it. */
export async function listProcessWorkingDirectories(
  platform: NodeJS.Platform = process.platform,
): Promise<string[] | null> {
  if (platform === "win32") {
    return null;
  }
  if (platform === "linux") {
    return (await linuxWorkingDirectories()) ?? (await lsofWorkingDirectories());
  }
  return await lsofWorkingDirectories();
}

/** Merged or closed through the gh CLI when it is installed and signed in; null otherwise. */
export async function readPullRequestStateWithGh(input: {
  originUrl: string;
  branch: string;
}): Promise<PullRequestState | null> {
  const repository = parseGitHubRepository(input.originUrl);
  if (!repository) {
    return null;
  }
  try {
    const result = await runCommandWithTimeout(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        repository,
        "--head",
        input.branch,
        "--state",
        "all",
        "--limit",
        "5",
        "--json",
        "state",
      ],
      { timeoutMs: GH_TIMEOUT_MS, env: { ...process.env, GH_PROMPT_DISABLED: "1" } },
    );
    if (result.code !== 0) {
      return null;
    }
    const states = new Set(
      (JSON.parse(result.stdout) as { state?: string }[]).map((pr) =>
        String(pr.state ?? "").toLowerCase(),
      ),
    );
    if (states.has("open")) {
      return "open";
    }
    if (states.has("merged")) {
      return "merged";
    }
    return states.has("closed") ? "closed" : null;
  } catch {
    return null;
  }
}

export function createBuildWorktreeCleanupDeps(): BuildWorktreeCleanupDeps {
  return {
    platform: process.platform,
    now: Date.now,
    git: async (cwd, args) => {
      const result = await runGit(cwd, args, {
        timeoutMs: GIT_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      return { code: result.code, stdout: result.stdout, stderr: result.stderr };
    },
    processDirectories: () => listProcessWorkingDirectories(),
    pullRequestState: readPullRequestStateWithGh,
    diskSpace: (target) => tryReadDiskSpace(target),
    measureBytes: (target) => measureDirectoryTreeBytes(target),
    rename: (from, to) => fs.rename(from, to),
    // No force and no retries: a locked file fails this run and is retried on the next one.
    removeTree: (target) => fs.rm(target, { recursive: true, force: false, maxRetries: 0 }),
  };
}
