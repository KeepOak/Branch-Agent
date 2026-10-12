// Removes build worktrees made by hand (git worktree add) under the build checkout roots once losing them
// loses nothing: the PR merged or closed, the branch is gone from origin, or nobody touched it for 48 hours;
// and it is clean, fully pushed, not a parent repo and not in use. Branch's own managed worktrees stay with
// the managed worktree cleanup (agents/worktrees), which keeps a registry and snapshots for them.
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { buildWorktreeGitArgs, toLongPathSafe } from "./long-path.js";

export const BUILD_WORKTREE_IDLE_MS = 48 * 60 * 60 * 1000;
/** Under low disk, node_modules goes first from worktrees nobody touched for this long. */
export const NODE_MODULES_IDLE_MS = 2 * 60 * 60 * 1000;
export const LOW_DISK_FREE_RATIO = 0.15;
/** Folders the owner keeps on purpose; nothing at or below them is touched. */
export const PROTECTED_FOLDER_NAMES: readonly string[] = ["delete-me-junk", "moved-to-nas"];
/** A detached worktree waits under this name until every file is gone. */
export const REMOVING_PREFIX = ".branch-removing-";
const NODE_MODULES_SEARCH_DEPTH = 3;
const LOCK_ERROR_CODES = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY", "EMFILE", "ENFILE"]);

export type GitRun = (
  cwd: string,
  args: string[],
) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export type PullRequestState = "open" | "merged" | "closed";

export type BuildWorktreeCleanupDeps = {
  platform: NodeJS.Platform;
  now: () => number;
  git: GitRun;
  /** Working folders of running processes, or null where they cannot be listed. */
  processDirectories: () => Promise<string[] | null>;
  pullRequestState: (input: {
    originUrl: string;
    branch: string;
  }) => Promise<PullRequestState | null>;
  diskSpace: (target: string) => { availableBytes: number; totalBytes: number | null } | null;
  measureBytes: (target: string) => Promise<number>;
  rename: (from: string, to: string) => Promise<void>;
  removeTree: (target: string) => Promise<void>;
};

export type BuildWorktreeKeepReason =
  | "dirty"
  | "unpushed"
  | "in-use"
  | "active"
  | "locked"
  | "unreadable";

export type BuildWorktreeCleanupReport = {
  at: number;
  removed: number;
  freedBytes: number;
  /** Detached worktrees whose files are still held open; retried on the next run. */
  retrying: number;
  kept: Partial<Record<BuildWorktreeKeepReason, number>>;
  line: string;
};

type RemovingEntry = { path: string; bytes: number; since: number };
export type BuildWorktreeCleanupState = {
  version: 1;
  removing: RemovingEntry[];
  last?: BuildWorktreeCleanupReport;
};

type ListedWorktree = {
  path: string;
  head?: string;
  branch?: string;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
};

type Repository = { commonDir: string; cwd: string; worktrees: ListedWorktree[] };

export function formatFreedBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) {
    return gb.toFixed(1) + " GB";
  }
  return Math.round(bytes / 1024 ** 2) + " MB";
}

/** The one line each run reports, e.g. "freed 6.2 GB, removed 5 worktrees". */
export function formatBuildWorktreeCleanupLine(report: {
  removed: number;
  freedBytes: number;
  retrying: number;
}): string {
  const parts = [
    "freed " + formatFreedBytes(report.freedBytes),
    "removed " + report.removed + (report.removed === 1 ? " worktree" : " worktrees"),
  ];
  if (report.retrying > 0) {
    parts.push(report.retrying + " still deleting, retried later");
  }
  return parts.join(", ");
}

export async function readBuildWorktreeCleanupState(
  statePath: string,
): Promise<BuildWorktreeCleanupState> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(statePath, "utf8"),
    ) as Partial<BuildWorktreeCleanupState>;
    const removing = Array.isArray(parsed.removing)
      ? parsed.removing.filter(
          (entry): entry is RemovingEntry =>
            Boolean(entry) && typeof entry.path === "string" && typeof entry.bytes === "number",
        )
      : [];
    return { version: 1, removing, last: parsed.last };
  } catch {
    return { version: 1, removing: [] };
  }
}

async function writeState(statePath: string, state: BuildWorktreeCleanupState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temp = statePath + "." + process.pid + ".tmp";
  await fs.writeFile(temp, JSON.stringify(state, null, 2));
  await fs.rename(temp, statePath);
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isStrictlyInside(child: string, parent: string): boolean {
  return child !== parent && isInside(child, parent);
}

function hasProtectedSegment(target: string, root: string): boolean {
  return path
    .relative(root, target)
    .split(/[\\/]/)
    .some((segment) => PROTECTED_FOLDER_NAMES.includes(segment.toLowerCase()));
}

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}

async function realpathOrNull(target: string): Promise<string | null> {
  try {
    return await fs.realpath(target);
  } catch {
    return null;
  }
}

async function lstatOrNull(target: string) {
  try {
    return await fs.lstat(target);
  } catch {
    return null;
  }
}

export function parseWorktreeList(porcelain: string): ListedWorktree[] {
  const worktrees: ListedWorktree[] = [];
  let current: ListedWorktree | undefined;
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice(9), bare: false, locked: false, prunable: false };
      worktrees.push(current);
    } else if (!current) {
      continue;
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice(5);
    } else if (line.startsWith("branch refs/heads/")) {
      current.branch = line.slice(18);
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "locked" || line.startsWith("locked ")) {
      current.locked = true;
    } else if (line === "prunable" || line.startsWith("prunable ")) {
      current.prunable = true;
    }
  }
  return worktrees;
}

class BuildWorktreeCleanup {
  private readonly kept: Partial<Record<BuildWorktreeKeepReason, number>> = {};
  private removed = 0;
  private freedBytes = 0;
  private readonly remoteHeads = new Map<string, Promise<Map<string, string> | null>>();
  private readonly originUrls = new Map<string, Promise<string | null>>();

  constructor(
    private readonly deps: BuildWorktreeCleanupDeps,
    private readonly state: BuildWorktreeCleanupState,
    private readonly statePath: string,
  ) {}

  private git(cwd: string, args: string[]) {
    return this.deps.git(cwd, buildWorktreeGitArgs(args, this.deps.platform));
  }

  private keep(reason: BuildWorktreeKeepReason): void {
    this.kept[reason] = (this.kept[reason] ?? 0) + 1;
  }

  /** Finishes deleting worktrees an earlier run detached but could not empty (a file was open). */
  async finishRemoving(roots: readonly string[]): Promise<void> {
    const remaining: RemovingEntry[] = [];
    for (const entry of this.state.removing) {
      const ours =
        path.basename(entry.path).startsWith(REMOVING_PREFIX) &&
        roots.some((root) => isStrictlyInside(entry.path, root));
      if (!ours) {
        continue;
      }
      if (!(await lstatOrNull(entry.path))) {
        continue;
      }
      try {
        await this.deps.removeTree(toLongPathSafe(entry.path, this.deps.platform));
        this.freedBytes += entry.bytes;
      } catch {
        remaining.push(entry);
      }
    }
    this.state.removing = remaining;
  }

  async discover(roots: readonly string[]): Promise<Repository[]> {
    const byCommonDir = new Map<string, string>();
    for (const root of roots) {
      let entries: Dirent[];
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(REMOVING_PREFIX)) {
          continue;
        }
        if (PROTECTED_FOLDER_NAMES.includes(entry.name.toLowerCase())) {
          continue;
        }
        const folder = path.join(root, entry.name);
        if (!(await lstatOrNull(path.join(folder, ".git")))) {
          continue;
        }
        const common = await this.git(folder, [
          "rev-parse",
          "--path-format=absolute",
          "--git-common-dir",
        ]);
        const commonDir = common.code === 0 ? await realpathOrNull(common.stdout.trim()) : null;
        if (commonDir && !byCommonDir.has(commonDir)) {
          byCommonDir.set(commonDir, folder);
        }
      }
    }
    const repositories: Repository[] = [];
    for (const [commonDir, cwd] of byCommonDir) {
      const listed = await this.git(cwd, ["worktree", "list", "--porcelain"]);
      if (listed.code === 0) {
        // Repository-wide commands run in the Git dir itself: the folder that led here may be a worktree
        // this run removes, and git worktree prune from inside a removed folder would fail.
        repositories.push({
          commonDir,
          cwd: commonDir,
          worktrees: parseWorktreeList(listed.stdout),
        });
      }
    }
    return repositories;
  }

  private async originUrl(cwd: string, commonDir: string): Promise<string | null> {
    let pending = this.originUrls.get(commonDir);
    if (!pending) {
      pending = this.git(cwd, ["config", "--get", "remote.origin.url"]).then((result) =>
        result.code === 0 ? result.stdout.trim() || null : null,
      );
      this.originUrls.set(commonDir, pending);
    }
    return await pending;
  }

  /** Branch heads on a remote, read without writing any local ref. */
  private async remoteBranches(
    cwd: string,
    commonDir: string,
    remote: string,
  ): Promise<Map<string, string> | null> {
    const key = commonDir + "\u0000" + remote;
    let pending = this.remoteHeads.get(key);
    if (!pending) {
      pending = this.git(cwd, ["ls-remote", "--heads", remote]).then((result) => {
        if (result.code !== 0) {
          return null;
        }
        const heads = new Map<string, string>();
        for (const line of result.stdout.split(/\r?\n/)) {
          const [sha, ref] = line.split("\t");
          if (sha && ref) {
            heads.set(ref.trim(), sha.trim());
          }
        }
        return heads;
      });
      this.remoteHeads.set(key, pending);
    }
    return await pending;
  }

  private async lastTouched(worktreePath: string): Promise<number | null> {
    const gitDir = await this.git(worktreePath, ["rev-parse", "--absolute-git-dir"]);
    if (gitDir.code !== 0) {
      return null;
    }
    const dir = gitDir.stdout.trim();
    let latest = 0;
    for (const target of [
      path.join(dir, "HEAD"),
      path.join(dir, "index"),
      path.join(dir, "logs", "HEAD"),
      worktreePath,
    ]) {
      const stat = await lstatOrNull(target);
      if (stat) {
        latest = Math.max(latest, stat.mtimeMs);
      }
    }
    return latest || null;
  }

  private async isClean(worktreePath: string): Promise<boolean | null> {
    // --no-optional-locks keeps status from rewriting the index, which would reset the idle clock.
    const status = await this.git(worktreePath, [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]);
    return status.code === 0 ? status.stdout.trim() === "" : null;
  }

  private async isPushed(
    worktree: ListedWorktree,
    repository: Repository,
  ): Promise<boolean | null> {
    const local = await this.git(worktree.path, [
      "rev-list",
      "--count",
      "HEAD",
      "--not",
      "--remotes",
    ]);
    if (local.code !== 0) {
      return null;
    }
    if (Number(local.stdout.trim()) === 0) {
      return true;
    }
    // Local remote-tracking refs may be stale; the remote itself can still hold this exact commit.
    const heads = await this.remoteBranches(repository.cwd, repository.commonDir, "origin");
    return Boolean(worktree.head && heads && [...heads.values()].includes(worktree.head));
  }

  private async branchGoneFromRemote(
    worktree: ListedWorktree,
    repository: Repository,
  ): Promise<boolean> {
    if (!worktree.branch) {
      return false;
    }
    const remote = await this.git(worktree.path, [
      "config",
      "--get",
      "branch." + worktree.branch + ".remote",
    ]);
    const merge = await this.git(worktree.path, [
      "config",
      "--get",
      "branch." + worktree.branch + ".merge",
    ]);
    const remoteName = remote.code === 0 ? remote.stdout.trim() : "";
    const mergeRef = merge.code === 0 ? merge.stdout.trim() : "";
    if (!remoteName || remoteName === "." || !mergeRef.startsWith("refs/heads/")) {
      return false;
    }
    const heads = await this.remoteBranches(repository.cwd, repository.commonDir, remoteName);
    return heads !== null && !heads.has(mergeRef);
  }

  private async staleReason(
    worktree: ListedWorktree,
    repository: Repository,
    touched: number | null,
  ): Promise<string | null> {
    if (await this.branchGoneFromRemote(worktree, repository)) {
      return "branch gone from origin";
    }
    if (touched !== null && this.deps.now() - touched >= BUILD_WORKTREE_IDLE_MS) {
      return "untouched for 48 hours";
    }
    const originUrl = await this.originUrl(repository.cwd, repository.commonDir);
    if (worktree.branch && originUrl) {
      const state = await this.deps
        .pullRequestState({ originUrl, branch: worktree.branch })
        .catch(() => null);
      if (state === "merged" || state === "closed") {
        return "pull request " + state;
      }
    }
    return null;
  }

  private async findNodeModules(start: string, depth: number, found: string[]): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(start, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === ".git") {
        continue;
      }
      const child = path.join(start, entry.name);
      if (entry.name === "node_modules") {
        found.push(child);
      } else if (depth > 1) {
        await this.findNodeModules(child, depth - 1, found);
      }
    }
  }

  /** node_modules is ignored by Git and comes back with an install, so clearing it loses no work. */
  private async clearNodeModules(worktreePath: string): Promise<void> {
    const found: string[] = [];
    await this.findNodeModules(worktreePath, NODE_MODULES_SEARCH_DEPTH, found);
    for (const folder of found) {
      const bytes = await this.deps.measureBytes(folder).catch(() => 0);
      try {
        await this.deps.removeTree(toLongPathSafe(folder, this.deps.platform));
        this.freedBytes += bytes;
      } catch {
        // A held file keeps the rest for the next run; nothing is forced closed.
      }
    }
  }

  /**
   * Detaches the worktree by moving it aside (on Windows the move fails while any file in it is open, so a
   * busy worktree is simply kept), lets Git forget it, then deletes the moved folder. A file that is still
   * locked leaves the moved folder for the next run.
   */
  private async remove(worktree: ListedWorktree, repository: Repository): Promise<boolean> {
    const bytes = await this.deps.measureBytes(worktree.path).catch(() => 0);
    const aside = path.join(
      path.dirname(worktree.path),
      REMOVING_PREFIX + path.basename(worktree.path) + "-" + this.deps.now(),
    );
    try {
      await this.deps.rename(
        toLongPathSafe(worktree.path, this.deps.platform),
        toLongPathSafe(aside, this.deps.platform),
      );
    } catch (error) {
      this.keep(LOCK_ERROR_CODES.has(errorCode(error)) ? "in-use" : "unreadable");
      return false;
    }
    this.removed += 1;
    this.state.removing.push({ path: aside, bytes, since: this.deps.now() });
    await writeState(this.statePath, this.state);
    await this.git(repository.cwd, ["worktree", "prune"]);
    try {
      await this.deps.removeTree(toLongPathSafe(aside, this.deps.platform));
      this.state.removing = this.state.removing.filter((entry) => entry.path !== aside);
      this.freedBytes += bytes;
    } catch {
      // Retried on the next run; the moved folder is no longer a worktree.
    }
    return true;
  }

  async sweep(params: {
    repositories: readonly Repository[];
    roots: readonly string[];
    excludeDirs: readonly string[];
    signal?: AbortSignal;
  }): Promise<void> {
    const { repositories } = params;
    const processDirs = await this.deps.processDirectories().catch(() => null);
    const lowDiskRoots = new Set(
      params.roots.filter((root) => {
        const space = this.deps.diskSpace(root);
        return Boolean(
          space?.totalBytes && space.availableBytes / space.totalBytes < LOW_DISK_FREE_RATIO,
        );
      }),
    );
    for (const repository of repositories) {
      let pruneNeeded = false;
      // The first entry is the parent checkout itself.
      for (const listed of repository.worktrees.slice(1)) {
        params.signal?.throwIfAborted();
        if (listed.bare) {
          continue;
        }
        if (listed.prunable) {
          pruneNeeded = true;
          continue;
        }
        const real = await realpathOrNull(listed.path);
        if (!real) {
          continue;
        }
        const root = params.roots.find((candidate) => isStrictlyInside(real, candidate));
        if (!root || hasProtectedSegment(real, root)) {
          continue;
        }
        if (params.excludeDirs.some((excluded) => isInside(real, excluded))) {
          continue;
        }
        // A parent repo has a .git folder (and .git/worktrees); a linked worktree has a .git file.
        const dotGit = await lstatOrNull(path.join(real, ".git"));
        if (!dotGit?.isFile()) {
          continue;
        }
        const worktree = { ...listed, path: real };
        await this.consider(worktree, repository, {
          lowDisk: lowDiskRoots.has(root),
          processDirs,
        });
      }
      if (pruneNeeded) {
        await this.git(repository.cwd, ["worktree", "prune"]);
      }
    }
  }

  private async consider(
    worktree: ListedWorktree,
    repository: Repository,
    context: { lowDisk: boolean; processDirs: string[] | null },
  ): Promise<void> {
    if (worktree.locked) {
      this.keep("locked");
      return;
    }
    const inUse = context.processDirs
      ? context.processDirs.some((dir) => isInside(dir, worktree.path))
      : // Without a process list only Windows can still tell: its move-aside fails on open files.
        this.deps.platform !== "win32";
    const touched = await this.lastTouched(worktree.path);
    if (
      context.lowDisk &&
      !inUse &&
      touched !== null &&
      this.deps.now() - touched >= NODE_MODULES_IDLE_MS
    ) {
      await this.clearNodeModules(worktree.path);
    }
    if (inUse) {
      this.keep("in-use");
      return;
    }
    const clean = await this.isClean(worktree.path);
    if (clean === null) {
      this.keep("unreadable");
      return;
    }
    if (!clean) {
      this.keep("dirty");
      return;
    }
    const pushed = await this.isPushed(worktree, repository);
    if (pushed === null) {
      this.keep("unreadable");
      return;
    }
    if (!pushed) {
      this.keep("unpushed");
      return;
    }
    if (!(await this.staleReason(worktree, repository, touched))) {
      this.keep("active");
      return;
    }
    await this.remove(worktree, repository);
  }

  report(): BuildWorktreeCleanupReport {
    const retrying = this.state.removing.length;
    const counts = { removed: this.removed, freedBytes: this.freedBytes, retrying };
    return {
      at: this.deps.now(),
      ...counts,
      kept: { ...this.kept },
      line: formatBuildWorktreeCleanupLine(counts),
    };
  }
}

export type BuildWorktreeCleanupResult = {
  report: BuildWorktreeCleanupReport;
  /** Git common dirs of the parent repos seen this run, for the merge watch. */
  repositories: { commonDir: string; cwd: string }[];
};

/** One cleanup run over the build checkout roots. Roots must be absolute; missing roots are skipped. */
export async function runBuildWorktreeCleanup(params: {
  roots: readonly string[];
  excludeDirs?: readonly string[];
  statePath: string;
  deps: BuildWorktreeCleanupDeps;
  signal?: AbortSignal;
}): Promise<BuildWorktreeCleanupResult> {
  const roots: string[] = [];
  for (const root of params.roots) {
    const real = await realpathOrNull(root);
    if (real && !roots.includes(real)) {
      roots.push(real);
    }
  }
  const excludeDirs: string[] = [];
  for (const excluded of params.excludeDirs ?? []) {
    excludeDirs.push((await realpathOrNull(excluded)) ?? path.resolve(excluded));
  }
  const state = await readBuildWorktreeCleanupState(params.statePath);
  const run = new BuildWorktreeCleanup(params.deps, state, params.statePath);
  await run.finishRemoving(roots);
  const repositories = await run.discover(roots);
  await run.sweep({ repositories, roots, excludeDirs, signal: params.signal });
  const report = run.report();
  state.last = report;
  await writeState(params.statePath, state);
  return {
    report,
    repositories: repositories.map(({ commonDir, cwd }) => ({ commonDir, cwd })),
  };
}
