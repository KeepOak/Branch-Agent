// Gardener signals: pure functions over injected inputs. Each returns a stable fingerprint and a short job draft.
// Nothing here reads the network or the disk. Fingerprints carry no timestamps, run ids or counts, so one
// unchanged problem keeps one fingerprint and the pass can de-duplicate it.
import { STALE_CLAIM_MS, type TrunkQueueItem } from "../agents/trunk-queue.js";

const HOUR = 60 * 60_000;

export type GardenerJobDraft = { title: string; brief_text: string; priority: number };
export type GardenerSignal = { fingerprint: string; job: GardenerJobDraft };

/** A check run that failed on main's current head. Read through the shared client's branch-sha and check-run calls. */
export type MainCheckFailure = { checkName: string; headSha: string };
/** One failstats occurrence. The lane-failstats producer maps its own rows into this shape. */
export type FailstatsEvent = { cause: string; at: number };
export type FailstatsOptions = { windowMs: number; threshold: number };
/** An open FIX verdict on a PR, with the time of its head commit. Built from the PR 2 poll's observations. */
export type FixVerdictRecord = {
  repo: string;
  pr: number;
  headSha: string;
  verdictAt: number;
  /** Committer time of the head commit. A value after verdictAt means the branch was pushed since the verdict. */
  lastPushAt: number;
};
export type ParityGapRecord = { key: string; summary: string };

const PRIORITY = { ci: 90, fix: 70, failstats: 60, claim: 50, parity: 40 } as const;

/** A check that is failing on main. The fingerprint is the check name, so a new red sha keeps the same job. */
export function failingMainCheckSignals(failures: readonly MainCheckFailure[]): GardenerSignal[] {
  const byName = new Map<string, MainCheckFailure>();
  for (const failure of failures) {
    byName.set(failure.checkName, failure);
  }
  return [...byName.values()].map((failure) => ({
    fingerprint: `ci-main:${failure.checkName}`,
    job: {
      title: `Fix failing check on main: ${failure.checkName}`,
      brief_text: `The check "${failure.checkName}" fails on main at ${failure.headSha.slice(0, 7)}. Find the cause, fix it on a branch and open a PR.`,
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
      (verdict) => now - verdict.verdictAt >= stallMs && verdict.lastPushAt <= verdict.verdictAt,
    )
    .map((verdict) => ({
      fingerprint: `fix-stale:${verdict.repo}#${verdict.pr}:${verdict.headSha}`,
      job: {
        title: `Push the FIX for ${verdict.repo} PR #${verdict.pr}`,
        brief_text: `PR #${verdict.pr} in ${verdict.repo} has had a FIX verdict and no push for ${hours}h. Make the requested changes and push, or ask for a new review.`,
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
