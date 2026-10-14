// Retires a managed job worktree once its pull request is merged or closed, instead of waiting for the idle
// window. Only a clean worktree whose commits all reached origin qualifies. The idle pass still runs its own
// protection checks (owner activity, live leases, nested repositories) before anything is removed.
import { runGit } from "./git.js";
import type { ManagedWorktreeRecord } from "./types.js";

const GIT_TIMEOUT_MS = 60_000;

export type PullRequestRetirementDeps = {
  pullRequestState: (input: {
    originUrl: string;
    branch: string;
  }) => Promise<{ state: "open" | "merged" | "closed"; headSha: string | null } | null>;
};

async function git(cwd: string, args: string[]): Promise<string | null> {
  const result = await runGit(cwd, args, { timeoutMs: GIT_TIMEOUT_MS }).catch(() => null);
  return result && result.code === 0 ? result.stdout.trim() : null;
}

/**
 * Every commit reachable from HEAD is on origin: either a remote-tracking ref holds it, or the pull request's
 * head commit contains it. The second test covers branches whose remote was deleted after the merge.
 */
async function fullyPushed(
  record: ManagedWorktreeRecord,
  headSha: string | null,
): Promise<boolean> {
  const onRemote = await git(record.path, [
    "rev-list",
    "--count",
    "HEAD",
    "--not",
    "--remotes=origin",
  ]);
  if (onRemote === "0") {
    return true;
  }
  if (!headSha) {
    return false;
  }
  return (await git(record.path, ["rev-list", "--count", "HEAD", "--not", headSha])) === "0";
}

async function isClean(record: ManagedWorktreeRecord): Promise<boolean> {
  // --no-optional-locks keeps status from rewriting the index, which would reset the idle clock.
  const status = await git(record.path, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  return status === "";
}

/**
 * Returns a checker that says whether a managed worktree may be retired early. Origin URLs are read once per
 * pass per repository, and pull request state is asked only for worktrees that are already clean.
 */
export function createPullRequestRetirementCheck(
  deps: PullRequestRetirementDeps,
): (record: ManagedWorktreeRecord) => Promise<boolean> {
  const originUrls = new Map<string, Promise<string | null>>();
  const originOf = (repoRoot: string) => {
    let pending = originUrls.get(repoRoot);
    if (!pending) {
      pending = git(repoRoot, ["config", "--get", "remote.origin.url"]);
      originUrls.set(repoRoot, pending);
    }
    return pending;
  };
  return async (record) => {
    if (!record.branch || !(await isClean(record))) {
      return false;
    }
    const originUrl = await originOf(record.repoRoot);
    if (!originUrl) {
      return false;
    }
    const pr = await deps.pullRequestState({ originUrl, branch: record.branch }).catch(() => null);
    if (!pr || pr.state === "open") {
      return false;
    }
    return await fullyPushed(record, pr.headSha);
  };
}
