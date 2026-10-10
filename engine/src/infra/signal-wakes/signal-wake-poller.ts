import { failingCheckNames, latestBranchVerdict, trunkForHeadRef } from "./signal-wake-classify.js";
import { diffPrSignals, type PrSignalState, type SignalDecision } from "./signal-wake-decide.js";
import type {
  CommentSummary,
  PullSummary,
  RepoRef,
  SignalWakeGitHub,
} from "./signal-wake-github.js";
import type { SignalStateMap, SignalStateStore } from "./signal-wake-state.js";

export const SIGNAL_POLL_INTERVAL_MS = 5 * 60_000;

/** `tick` runs one poll now, or joins the poll already in flight. */
export type SignalPoller = { tick(): Promise<void>; stop(): Promise<void> };

/** What one poll read for one Trunk-authored PR. Handed to `observe`; nothing is re-read for it. */
export type PrObservation = {
  repo: RepoRef;
  pullNumber: number;
  authorLogin: string;
  headSha: string;
  trunkId: string;
  comments: readonly CommentSummary[];
};

export type SignalPollerOptions = {
  github: SignalWakeGitHub;
  repos: readonly RepoRef[];
  /** Configured Trunk ids on this machine, read on every tick. */
  trunkIds: () => readonly string[];
  notify: (signal: SignalDecision) => void;
  /** Optional read-only tap on each PR the poll reads. Used by the Gardener; no extra GitHub call. */
  observe?: (observation: PrObservation) => void;
  store: SignalStateStore;
  onError?: (message: string) => void;
  intervalMs?: number;
};

type PollContext = {
  options: SignalPollerOptions;
  /** Committed state. Loaded from the store on the first tick, then advanced only after a durable write. */
  states?: SignalStateMap;
  /** True until the first tick after a record-only load completes. Such a tick never wakes. */
  recordOnly: boolean;
};

function repoKey(repo: RepoRef): string {
  return `${repo.owner}/${repo.name}`;
}

function reportError(ctx: PollContext, error: unknown): void {
  ctx.options.onError?.(error instanceof Error ? error.message : String(error));
}

/** The observe tap is best-effort: a throw is reported and never stops the PR's wake decisions. */
function observeSafely(ctx: PollContext, observation: PrObservation): void {
  try {
    ctx.options.observe?.(observation);
  } catch (error: unknown) {
    reportError(ctx, error);
  }
}

async function tickPr(
  ctx: PollContext,
  repo: RepoRef,
  pull: PullSummary,
  trunkId: string,
  prs: Map<number, PrSignalState>,
  pending: SignalDecision[],
): Promise<void> {
  const github = ctx.options.github;
  const checks = await github.listCheckRuns(repo, pull.headSha);
  const comments = await github.listComments(repo, pull.number);
  observeSafely(ctx, {
    repo,
    pullNumber: pull.number,
    authorLogin: pull.authorLogin,
    headSha: pull.headSha,
    trunkId,
    comments,
  });
  const diff = diffPrSignals(prs.get(pull.number), {
    number: pull.number,
    trunkId,
    headSha: pull.headSha,
    failingChecks: failingCheckNames(checks),
    latestVerdict: latestBranchVerdict(comments),
  });
  prs.set(pull.number, diff.next);
  pending.push(...diff.signals);
}

function forgetClosedPrs(prs: Map<number, PrSignalState>, pulls: readonly PullSummary[]): void {
  const openNumbers = new Set(pulls.map((pull) => pull.number));
  for (const number of prs.keys()) {
    if (!openNumbers.has(number)) {
      prs.delete(number);
    }
  }
}

async function tickRepo(
  ctx: PollContext,
  repo: RepoRef,
  states: SignalStateMap,
  pending: SignalDecision[],
): Promise<void> {
  const key = repoKey(repo);
  const prs = states.get(key) ?? new Map<number, PrSignalState>();
  states.set(key, prs);
  const pulls = await ctx.options.github.listOpenPulls(repo);
  const trunkIds = ctx.options.trunkIds();
  for (const pull of pulls) {
    const trunkId = trunkForHeadRef(pull.headRef, trunkIds);
    if (trunkId !== undefined) {
      await tickPr(ctx, repo, pull, trunkId, prs, pending).catch((error: unknown) =>
        reportError(ctx, error),
      );
    }
  }
  forgetClosedPrs(prs, pulls);
}

async function loadStates(ctx: PollContext): Promise<SignalStateMap | undefined> {
  if (ctx.states === undefined) {
    try {
      const load = await ctx.options.store.read();
      ctx.states = load.states;
      ctx.recordOnly = load.recordOnly;
      if (load.warning !== undefined) {
        ctx.options.onError?.(load.warning);
      }
    } catch (error: unknown) {
      // Without the persisted state a tick could re-wake old signals, so it does nothing.
      reportError(ctx, error);
      return undefined;
    }
  }
  return ctx.states;
}

/** Sends each signal. A failed send is reported; its state is already durable, so it is not replayed. */
function sendSignals(ctx: PollContext, signals: readonly SignalDecision[]): void {
  for (const signal of signals) {
    try {
      ctx.options.notify(signal);
    } catch (error: unknown) {
      reportError(ctx, error);
    }
  }
}

/**
 * One tick works on a copy. It records the new state durably first, then sends the wakes. A crash
 * between the two cannot replay a wake, and a failed write sends nothing and is retried next tick.
 */
async function runTick(ctx: PollContext): Promise<void> {
  const loaded = await loadStates(ctx);
  if (loaded === undefined) {
    return;
  }
  const next: SignalStateMap = structuredClone(loaded);
  const pending: SignalDecision[] = [];
  for (const repo of ctx.options.repos) {
    await tickRepo(ctx, repo, next, pending).catch((error: unknown) => reportError(ctx, error));
  }
  try {
    await ctx.options.store.write(next);
  } catch (error: unknown) {
    reportError(ctx, error);
    return;
  }
  ctx.states = next;
  const recordOnly = ctx.recordOnly;
  ctx.recordOnly = false;
  if (!recordOnly) {
    sendSignals(ctx, pending);
  }
}

/** Starts one poller per gateway. Ticks never overlap; the timer is unref'd and stops on request. */
export function startSignalWakePoller(options: SignalPollerOptions): SignalPoller {
  const ctx: PollContext = { options, recordOnly: false };
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
