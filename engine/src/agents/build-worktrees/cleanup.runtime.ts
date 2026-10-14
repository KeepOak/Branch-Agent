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

/** lsof -F n output: one "n<path>" line per open file, working folders and executables included. */
export function parseLsofWorkingDirectories(output: string): string[] {
  return output
    .split(/\r?\n/)
    .filter((line) => line.startsWith("n/"))
    .map((line) => line.slice(1));
}

/** Every open file of every process, not just working folders: an editor or a log tail holds a worktree too. */
export const LSOF_OPEN_FILES_ARGV: readonly string[] = ["lsof", "-w", "-n", "-P", "-F", "n"];
const LSOF_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

type RunCommand = typeof runCommandWithTimeout;

/** Working folders and open files of each process under a /proc tree (Linux). */
export async function readProcOpenPaths(procRoot = "/proc"): Promise<string[] | null> {
  let pids: string[];
  try {
    pids = (await fs.readdir(procRoot)).filter((name) => /^\d+$/.test(name));
  } catch {
    return null;
  }
  const paths: string[] = [];
  for (const pid of pids) {
    try {
      paths.push(await fs.readlink(path.join(procRoot, pid, "cwd")));
    } catch {
      // Processes owned by other users or already gone.
    }
    let fds: string[];
    try {
      fds = await fs.readdir(path.join(procRoot, pid, "fd"));
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        const target = await fs.readlink(path.join(procRoot, pid, "fd", fd));
        // Sockets, pipes and anon inodes read as "socket:[123]" and the like.
        if (target.startsWith("/")) {
          paths.push(target.replace(/ \(deleted\)$/, ""));
        }
      } catch {
        // Closed while reading.
      }
    }
  }
  return paths;
}

export async function lsofOpenPaths(
  run: RunCommand = runCommandWithTimeout,
): Promise<string[] | null> {
  try {
    const result = await run([...LSOF_OPEN_FILES_ARGV], {
      timeoutMs: PROCESS_LIST_TIMEOUT_MS,
      maxOutputBytes: LSOF_MAX_OUTPUT_BYTES,
    });
    // A cut-off or timed-out list could miss a holder; treat it as no list, which keeps every worktree.
    if (result.outputLimitExceeded || result.stdoutTruncatedBytes || result.termination !== "exit") {
      return null;
    }
    // lsof exits 1 when some processes could not be read but still prints the rest.
    return result.stdout ? parseLsofWorkingDirectories(result.stdout) : null;
  } catch {
    return null;
  }
}

/**
 * Folders and files that running processes hold open (working folders included). Windows has no cheap list;
 * its move-aside fails while any file is open, which covers it.
 */
export async function listProcessWorkingDirectories(
  platform: NodeJS.Platform = process.platform,
): Promise<string[] | null> {
  if (platform === "win32") {
    return null;
  }
  if (platform === "linux") {
    return (await readProcOpenPaths()) ?? (await lsofOpenPaths());
  }
  return await lsofOpenPaths();
}

export type PullRequestHead = { state: PullRequestState; headSha: string | null };

/**
 * The branch's pull request state through the gh CLI, with the head commit of the PR that state came from.
 * Open wins over merged, which wins over closed. Null when gh is missing, signed out, or nothing matches.
 */
export async function readPullRequestHeadWithGh(input: {
  originUrl: string;
  branch: string;
}): Promise<PullRequestHead | null> {
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
        "state,headRefOid",
      ],
      { timeoutMs: GH_TIMEOUT_MS, env: { ...process.env, GH_PROMPT_DISABLED: "1" } },
    );
    if (result.code !== 0) {
      return null;
    }
    const pulls = (JSON.parse(result.stdout) as { state?: string; headRefOid?: string }[]).map(
      (pr) => ({
        state: String(pr.state ?? "").toLowerCase(),
        headSha: pr.headRefOid ? pr.headRefOid : null,
      }),
    );
    for (const state of ["open", "merged", "closed"] as const) {
      const match = pulls.find((pr) => pr.state === state);
      if (match) {
        return { state, headSha: match.headSha };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Merged, closed or open through the gh CLI when it is installed and signed in; null otherwise. */
export async function readPullRequestStateWithGh(input: {
  originUrl: string;
  branch: string;
}): Promise<PullRequestState | null> {
  return (await readPullRequestHeadWithGh(input))?.state ?? null;
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
