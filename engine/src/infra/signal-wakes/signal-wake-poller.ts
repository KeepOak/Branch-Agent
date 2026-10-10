import { failingCheckNames, isFixVerdict, trunkForHeadRef } from "./signal-wake-classify.js";
import { diffPrSignals, type PrSignalState, type SignalDecision } from "./signal-wake-decide.js";
import type { PullSummary, RepoRef, SignalWakeGitHub } from "./signal-wake-github.js";

export const SIGNAL_POLL_INTERVAL_MS = 5 * 60_000;

/** `tick` runs one poll now, or joins the poll already in flight. */
export type SignalPoller = { tick(): Promise<void>; stop(): Promise<void> };

export type SignalPollerOptions = {
  github: SignalWakeGitHub;
  repos: readonly RepoRef[];
  /** Configured Trunk ids on this machine, read on every tick. */
  trunkIds: () => readonly string[];
  notify: (signal: SignalDecision) => void;
  onError?: (message: string) => void;
  intervalMs?: number;
};

type RepoState = { prs: Map<number, PrSignalState> };

type PollContext = {
  options: SignalPollerOptions;
  states: Map<string, RepoState>;
  /** False until a tick lists every repo; that first tick only records state. */
  baselined: boolean;
};

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

function reportError(ctx: PollContext, error: unknown): void {
  ctx.options.onError?.(error instanceof Error ? error.message : String(error));
}

async function tickPr(
  ctx: PollContext,
  repo: RepoRef,
  pull: PullSummary,
  trunkId: string,
  state: RepoState,
): Promise<void> {
  const github = ctx.options.github;
  const checks = await github.listCheckRuns(repo, pull.headSha);
  const comments = await github.listComments(repo, pull.number);
  const diff = diffPrSignals(state.prs.get(pull.number), {
    number: pull.number,
    authorLogin: pull.authorLogin,
    headSha: pull.headSha,
    trunkId,
    failingChecks: failingCheckNames(checks),
    verdicts: comments
      .filter((comment) => isFixVerdict(comment.body))
      .map((comment) => ({ id: comment.id, authorLogin: comment.authorLogin, body: comment.body })),
  });
  state.prs.set(pull.number, diff.next);
  if (ctx.baselined) {
    diff.signals.forEach(ctx.options.notify);
  }
}

function forgetClosedPrs(state: RepoState, pulls: readonly PullSummary[]): void {
  const openNumbers = new Set(pulls.map((pull) => pull.number));
  for (const number of state.prs.keys()) {
    if (!openNumbers.has(number)) {
      state.prs.delete(number);
    }
  }
}

async function tickRepo(ctx: PollContext, repo: RepoRef): Promise<void> {
  const key = repoKey(repo);
  const state = ctx.states.get(key) ?? { prs: new Map<number, PrSignalState>() };
  ctx.states.set(key, state);
  const pulls = await ctx.options.github.listOpenPulls(repo);
  const trunkIds = ctx.options.trunkIds();
  for (const pull of pulls) {
    const trunkId = trunkForHeadRef(pull.headRef, trunkIds);
    if (trunkId !== undefined) {
      await tickPr(ctx, repo, pull, trunkId, state).catch((error: unknown) =>
        reportError(ctx, error),
      );
    }
  }
  forgetClosedPrs(state, pulls);
}

async function runTick(ctx: PollContext): Promise<void> {
  let listed = true;
  for (const repo of ctx.options.repos) {
    await tickRepo(ctx, repo).catch((error: unknown) => {
      listed = false;
      reportError(ctx, error);
    });
  }
  ctx.baselined ||= listed;
}

/** Starts one poller per gateway. Ticks never overlap; the timer is unref'd and stops on request. */
export function startSignalWakePoller(options: SignalPollerOptions): SignalPoller {
  const ctx: PollContext = { options, states: new Map(), baselined: false };
  let inFlight: Promise<void> | undefined;
  const tick = (): Promise<void> => {
    inFlight ??= runTick(ctx).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  const timer = setInterval(() => void tick(), options.intervalMs ?? SIGNAL_POLL_INTERVAL_MS);
  timer.unref();
  void tick();
  return {
    tick,
    async stop() {
      clearInterval(timer);
      await inFlight;
    },
  };
}
