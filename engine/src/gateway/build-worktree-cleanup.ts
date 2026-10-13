// Gateway owner for the build worktree cleanup: a sweep every 30 minutes, plus one after every merge (the
// default branch tip on origin moving), each reporting one line that Settings › Computer & browser shows.
import path from "node:path";
import {
  readBuildWorktreeCleanupState,
  runBuildWorktreeCleanup,
  type BuildWorktreeCleanupReport,
  type BuildWorktreeCleanupResult,
} from "../agents/build-worktrees/cleanup.js";
import { resolveStateDir } from "../config/state-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import { formatErrorMessage } from "../infra/errors.js";
import type { GatewayScheduler } from "../infra/gateway-scheduler.js";
import { resolveOsHomeRelativePath } from "../infra/home-dir.js";

export const BUILD_WORKTREE_SWEEP_MS = 30 * 60_000;
export const BUILD_WORKTREE_MERGE_WATCH_MS = 5 * 60_000;
const FIRST_SWEEP_DELAY_MS = 2 * 60_000;
/** Where build checkouts live unless buildWorktreeRoots says otherwise. */
export const DEFAULT_BUILD_WORKTREE_ROOTS: readonly string[] = ["~/branch-work"];

export function resolveBuildWorktreeRoots(
  config: BranchConfig,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = config.buildWorktreeRoots ?? DEFAULT_BUILD_WORKTREE_ROOTS;
  // Build checkouts sit under the person's own home, not Branch's home override.
  return configured
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => resolveOsHomeRelativePath(root, { env }));
}

export function buildWorktreeCleanupStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "build-worktree-cleanup.json");
}

/** Branch's own folders are never build checkouts: managed worktrees keep their own cleanup. */
function excludedDirectories(config: BranchConfig, env: NodeJS.ProcessEnv): string[] {
  const stateDir = resolveStateDir(env);
  const managedRoot = config.worktreeRoot
    ? resolveOsHomeRelativePath(config.worktreeRoot, { env })
    : path.join(stateDir, "worktrees");
  return [stateDir, managedRoot];
}

export async function readLastBuildWorktreeCleanup(
  env: NodeJS.ProcessEnv = process.env,
): Promise<BuildWorktreeCleanupReport | null> {
  return (await readBuildWorktreeCleanupState(buildWorktreeCleanupStatePath(env))).last ?? null;
}

type RemoteHeadReader = (repository: { commonDir: string; cwd: string }) => Promise<string | null>;

export type BuildWorktreeCleanupOwner = {
  /** Runs a sweep now, or once more after the one in flight. */
  request: () => Promise<void>;
  /** Sweeps when origin's default branch moved since the last look (a merge landed). */
  checkForMerges: () => Promise<void>;
  stop: () => Promise<void>;
};

export function startBuildWorktreeCleanup(params: {
  scheduler: GatewayScheduler;
  getRuntimeConfig: () => BranchConfig;
  log: { info: (message: string) => void; error: (message: string) => void };
  env?: NodeJS.ProcessEnv;
  run?: (input: {
    roots: string[];
    excludeDirs: string[];
    statePath: string;
    signal: AbortSignal;
  }) => Promise<BuildWorktreeCleanupResult>;
  readRemoteHead?: RemoteHeadReader;
}): BuildWorktreeCleanupOwner {
  const env = params.env ?? process.env;
  const scheduler = params.scheduler.scope();
  const remoteHeads = new Map<string, string>();
  let repositories: { commonDir: string; cwd: string }[] = [];
  let inFlight: Promise<void> | undefined;
  let again = false;

  const sweepOnce = async () => {
    const config = params.getRuntimeConfig();
    const roots = resolveBuildWorktreeRoots(config, env);
    if (roots.length === 0) {
      return;
    }
    const input = {
      roots,
      excludeDirs: excludedDirectories(config, env),
      statePath: buildWorktreeCleanupStatePath(env),
      signal: scheduler.signal,
    };
    const result = params.run
      ? await params.run(input)
      : await runBuildWorktreeCleanup({
          ...input,
          deps: (
            await import("../agents/build-worktrees/cleanup.runtime.js")
          ).createBuildWorktreeCleanupDeps(),
        });
    repositories = result.repositories;
    params.log.info("build worktree cleanup: " + result.report.line);
  };

  const request = (): Promise<void> => {
    if (scheduler.signal.aborted) {
      return Promise.resolve();
    }
    if (inFlight) {
      again = true;
      return inFlight;
    }
    inFlight = (async () => {
      try {
        do {
          again = false;
          await sweepOnce().catch((error: unknown) => {
            if (!scheduler.signal.aborted) {
              params.log.error("build worktree cleanup failed: " + formatErrorMessage(error));
            }
          });
        } while (again && !scheduler.signal.aborted);
      } finally {
        inFlight = undefined;
      }
    })();
    return inFlight;
  };

  const readRemoteHead: RemoteHeadReader =
    params.readRemoteHead ??
    (async (repository) => {
      const { runGit } = await import("../agents/worktrees/git.js");
      const result = await runGit(repository.cwd, ["ls-remote", "origin", "HEAD"], {
        timeoutMs: 30_000,
        env: { ...env, GIT_TERMINAL_PROMPT: "0" },
      });
      return result.code === 0 ? result.stdout.split(/\s/)[0] || null : null;
    });

  const checkForMerges = async () => {
    let moved = false;
    for (const repository of repositories) {
      const head = await readRemoteHead(repository).catch(() => null);
      if (!head) {
        continue;
      }
      const previous = remoteHeads.get(repository.commonDir);
      remoteHeads.set(repository.commonDir, head);
      if (previous && previous !== head) {
        moved = true;
      }
    }
    if (moved) {
      await request();
    }
  };

  scheduler.schedule({
    id: "maintenance:build-worktrees",
    delayMs: FIRST_SWEEP_DELAY_MS,
    everyMs: BUILD_WORKTREE_SWEEP_MS,
    run: () => request(),
  });
  scheduler.schedule({
    id: "maintenance:build-worktrees:merge-watch",
    delayMs: BUILD_WORKTREE_MERGE_WATCH_MS,
    everyMs: BUILD_WORKTREE_MERGE_WATCH_MS,
    run: () => checkForMerges(),
  });

  return {
    request,
    checkForMerges,
    stop: async () => {
      await scheduler.stop();
      await inFlight;
    },
  };
}
