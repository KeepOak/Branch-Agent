// Gardener inputs built from the PR 2 poller's observations and the shared GitHub client. No second reader: the
// observations come from the poller's own reads, and the two extra reads go through the same ETag cache.
import type { GardenerInputs } from "./gardener-pass.js";
import type { FixVerdictRecord, MainCheckFailure } from "./gardener-signals.js";
import { failingCheckNames } from "./signal-wakes/signal-wake-classify.js";
import type { RepoRef, SignalWakeGitHubReads } from "./signal-wakes/signal-wake-github.js";
import type { PrObservation } from "./signal-wakes/signal-wake-poller.js";

/** The poller ticks every 5 minutes. Three intervals of silence means the PR is closed or no longer polled. */
const OBSERVATION_FRESH_MS = 15 * 60_000;
const MAIN_BRANCH = "main";
const VERDICT = /^\s*(FIX|PASS|MERGE)\b/;

export type ObservationStore = {
  record(observation: PrObservation, seenAt: number): void;
  fresh(now: number): PrObservation[];
};

export function createObservationStore(): ObservationStore {
  const latest = new Map<string, { observation: PrObservation; seenAt: number }>();
  return {
    record(observation, seenAt) {
      const key = `${observation.repo.owner}/${observation.repo.name}#${observation.pullNumber}`;
      latest.set(key, { observation, seenAt });
    },
    fresh(now) {
      return [...latest.values()]
        .filter((entry) => now - entry.seenAt <= OBSERVATION_FRESH_MS)
        .map((entry) => entry.observation);
    },
  };
}

type Verdict = { kind: string; at: number };

/** The latest FIX, PASS or MERGE from a reviewer other than the PR author. Undated comments cannot be timed, so skip them. */
function latestVerdict(observation: PrObservation): Verdict | undefined {
  let latest: Verdict | undefined;
  for (const comment of observation.comments) {
    const match = VERDICT.exec(comment.body);
    const at = comment.createdAt === undefined ? Number.NaN : Date.parse(comment.createdAt);
    if (!match || Number.isNaN(at) || comment.authorLogin === observation.authorLogin) {
      continue;
    }
    if (latest === undefined || at > latest.at) {
      latest = { kind: match[1] ?? "", at };
    }
  }
  return latest;
}

async function readMainCheckFailures(
  reads: SignalWakeGitHubReads,
  repo: RepoRef,
): Promise<MainCheckFailure[]> {
  const headSha = await reads.getBranchSha(repo, MAIN_BRANCH);
  if (headSha === undefined) {
    return [];
  }
  const checks = await reads.listCheckRuns(repo, headSha);
  return failingCheckNames(checks).map((checkName) => ({ checkName, headSha }));
}

/** FIX verdicts that are still open. Only a verdict older than the stall window reads the head commit time. */
async function readStalledFixes(
  reads: SignalWakeGitHubReads,
  observations: readonly PrObservation[],
  now: number,
  stallMs: number,
): Promise<FixVerdictRecord[]> {
  const records: FixVerdictRecord[] = [];
  for (const observation of observations) {
    const verdict = latestVerdict(observation);
    if (verdict?.kind !== "FIX" || now - verdict.at < stallMs) {
      continue;
    }
    const lastPushAt = await reads.getCommitTime(observation.repo, observation.headSha);
    if (lastPushAt === undefined) {
      continue;
    }
    records.push({
      repo: `${observation.repo.owner}/${observation.repo.name}`,
      pr: observation.pullNumber,
      headSha: observation.headSha,
      verdictAt: verdict.at,
      lastPushAt,
    });
  }
  return records;
}

/** Inputs for one pass. Stale claims are read from the queue inside the pass, so they are not part of this. */
export async function readGardenerInputs(params: {
  reads: SignalWakeGitHubReads;
  repo: RepoRef;
  observations: readonly PrObservation[];
  now: number;
  fixStallMs: number;
}): Promise<GardenerInputs> {
  return {
    mainCheckFailures: await readMainCheckFailures(params.reads, params.repo),
    fixVerdicts: await readStalledFixes(
      params.reads,
      params.observations,
      params.now,
      params.fixStallMs,
    ),
  };
}
