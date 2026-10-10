// Gardener signals: pure functions over injected inputs. Each returns a stable fingerprint and a short job draft.
// Nothing here reads the network or the disk. Fingerprints carry no timestamps, run ids or counts, so one
// unchanged problem keeps one fingerprint and the pass can de-duplicate it.
import { STALE_CLAIM_MS, type TrunkQueueItem } from "../agents/trunk-queue.js";

const HOUR = 60 * 60_000;

export type GardenerJobDraft = { title: string; brief_text: string; priority: number };
export type GardenerSignal = { fingerprint: string; job: GardenerJobDraft };

/** One Actions run, in the field names the CI read uses (gateway/github-actions-read.ts). */
export type CiRunRecord = {
  workflow_id: number;
  name: string | null;
  head_branch: string | null;
  conclusion: string | null;
  created_at: string;
  html_url: string;
};
/** One failstats occurrence. The lane-failstats producer maps its own rows into this shape. */
export type FailstatsEvent = { cause: string; at: number };
export type FailstatsOptions = { windowMs: number; threshold: number };
/** An open FIX verdict on a PR, and the last push to that PR branch if there was one. Supplied by the verdict poller. */
export type FixVerdictRecord = {
  pr: number;
  headSha: string;
  verdictAt: number;
  lastPushAt?: number;
};
export type ParityGapRecord = { key: string; summary: string };

const PRIORITY = { ci: 90, fix: 70, failstats: 60, claim: 50, parity: 40 } as const;

/** The newest main-branch run per workflow. Runs on other branches never count. */
function latestMainRunPerWorkflow(runs: readonly CiRunRecord[]): CiRunRecord[] {
  const latest = new Map<number, CiRunRecord>();
  for (const run of runs) {
    if (run.head_branch !== "main") {
      continue;
    }
    const seen = latest.get(run.workflow_id);
    if (!seen || Date.parse(run.created_at) > Date.parse(seen.created_at)) {
      latest.set(run.workflow_id, run);
    }
  }
  return [...latest.values()];
}

/** A workflow whose newest main run failed. The fingerprint is the workflow, so each new red run keeps the same job. */
export function failingMainSignals(runs: readonly CiRunRecord[]): GardenerSignal[] {
  return latestMainRunPerWorkflow(runs)
    .filter((run) => run.conclusion === "failure")
    .map((run) => ({
      fingerprint: `ci-main:${run.workflow_id}`,
      job: {
        title: `Fix failing main workflow ${run.name ?? run.workflow_id}`,
        brief_text: `The newest main run failed: ${run.html_url}. Find the cause, fix it on a branch and open a PR.`,
        priority: PRIORITY.ci,
      },
    }));
}

/** A failure cause that reaches the threshold inside the window. Events outside the window do not count. */
export function recurringFailstatsSignals(
  events: readonly FailstatsEvent[],
  now: number,
  options: FailstatsOptions,
): GardenerSignal[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.at < now - options.windowMs || event.at > now) {
      continue;
    }
    counts.set(event.cause, (counts.get(event.cause) ?? 0) + 1);
  }
  const hours = Math.round(options.windowMs / HOUR);
  return [...counts]
    .filter(([, count]) => count >= options.threshold)
    .map(([cause, count]) => ({
      fingerprint: `failstats:${cause}`,
      job: {
        title: `Investigate recurring failure: ${cause}`,
        brief_text: `"${cause}" occurred ${count} times in the last ${hours}h. Find the root cause and fix it.`,
        priority: PRIORITY.failstats,
      },
    }));
}

/** A FIX verdict with no push after it for stallMs or longer. The fingerprint pins the PR and its head. */
export function stalledFixSignals(
  verdicts: readonly FixVerdictRecord[],
  now: number,
  stallMs: number,
): GardenerSignal[] {
  const hours = Math.round(stallMs / HOUR);
  return verdicts
    .filter(
      (verdict) =>
        now - verdict.verdictAt >= stallMs &&
        (verdict.lastPushAt === undefined || verdict.lastPushAt <= verdict.verdictAt),
    )
    .map((verdict) => ({
      fingerprint: `fix-stale:${verdict.pr}:${verdict.headSha}`,
      job: {
        title: `Push the FIX for PR #${verdict.pr}`,
        brief_text: `PR #${verdict.pr} has had a FIX verdict and no push for ${hours}h. Make the requested changes and push, or ask for a new review.`,
        priority: PRIORITY.fix,
      },
    }));
}

function isStaleClaim(item: TrunkQueueItem, now: number): boolean {
  if (!item.claimed_by || item.done_at) {
    return false;
  }
  return now - (item.active_at ?? item.claimed_at ?? now) >= STALE_CLAIM_MS;
}

/** A queue claim with no run activity for STALE_CLAIM_MS. The fingerprint pins the claim attempt, not just the job. */
export function staleClaimSignals(items: readonly TrunkQueueItem[], now: number): GardenerSignal[] {
  const signals: GardenerSignal[] = [];
  for (const item of items) {
    if (item.claim_id === undefined || !isStaleClaim(item, now)) {
      continue;
    }
    signals.push({
      fingerprint: `stale-claim:${item.id}:${item.claim_id}`,
      job: {
        title: `Check stale queue claim: ${item.title}`,
        brief_text: `"${item.title}" is claimed by ${item.claimed_by} with no run activity for ${Math.round(STALE_CLAIM_MS / HOUR)}h. Confirm the Trunk is alive, or release the job.`,
        priority: PRIORITY.claim,
      },
    });
  }
  return signals;
}

/** One signal per injected parity gap. Producing the gaps is out of scope here. */
export function parityGapSignals(gaps: readonly ParityGapRecord[]): GardenerSignal[] {
  return gaps.map((gap) => ({
    fingerprint: `parity:${gap.key}`,
    job: {
      title: `Close parity gap: ${gap.summary}`,
      brief_text: `Parity gap "${gap.key}": ${gap.summary}. Bring the behaviour in line with the reference and add a test.`,
      priority: PRIORITY.parity,
    },
  }));
}
