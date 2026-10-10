import { describe, expect, it, vi } from "vitest";
import { createObservationStore, readGardenerInputs } from "./gardener-inputs.js";
import { stalledFixSignals } from "./gardener-signals.js";
import type { CheckRunSummary } from "./signal-wakes/signal-wake-classify.js";
import type {
  CommentSummary,
  RepoRef,
  SignalWakeGitHubReads,
} from "./signal-wakes/signal-wake-github.js";
import type { PrObservation } from "./signal-wakes/signal-wake-poller.js";

const HOUR = 60 * 60_000;
const NOW = Date.parse("2026-10-10T12:00:00Z");
const STALL = 2 * HOUR;
const REPO: RepoRef = { owner: "example-owner", name: "example-repo" };
const MAIN_SHA = "0123456789abcdef0123456789abcdef01234567";

function fakeReads(overrides: {
  mainSha?: string | undefined;
  checks?: CheckRunSummary[];
  commitTime?: number | undefined;
}): SignalWakeGitHubReads & { getCommitTime: ReturnType<typeof vi.fn> } {
  return {
    listOpenPulls: async () => [],
    listComments: async () => [],
    listCheckRuns: async () => overrides.checks ?? [],
    getBranchSha: async () => ("mainSha" in overrides ? overrides.mainSha : MAIN_SHA),
    getCommitTime: vi.fn(async () =>
      "commitTime" in overrides ? overrides.commitTime : NOW - 3 * HOUR,
    ),
  };
}

function observation(comments: CommentSummary[], headSha = "head1"): PrObservation {
  return {
    repo: REPO,
    pullNumber: 12,
    authorLogin: "builder-author",
    headSha,
    trunkId: "builder-1",
    comments,
  };
}

const comment = (
  id: number,
  body: string,
  createdAt: string | undefined,
  authorLogin = "reviewer",
) => ({
  id,
  authorLogin,
  body,
  ...(createdAt === undefined ? {} : { createdAt }),
});

const twoHoursAgo = new Date(NOW - STALL).toISOString();

describe("createObservationStore", () => {
  it("keeps the latest observation per PR and drops ones older than the freshness window", () => {
    const store = createObservationStore();
    store.record(observation([]), NOW);
    expect(store.fresh(NOW + 14 * 60_000)).toHaveLength(1);
    expect(store.fresh(NOW + 16 * 60_000)).toEqual([]);
  });
});

describe("readGardenerInputs: main CI", () => {
  it("lists the failing check names on main's head sha", async () => {
    const reads = fakeReads({
      checks: [
        { name: "engine-tests", status: "completed", conclusion: "failure" },
        { name: "lint", status: "completed", conclusion: "success" },
      ],
    });
    const inputs = await readGardenerInputs({
      reads,
      repo: REPO,
      observations: [],
      now: NOW,
      fixStallMs: STALL,
    });
    expect(inputs.mainCheckFailures).toEqual([{ checkName: "engine-tests", headSha: MAIN_SHA }]);
  });

  it("reads nothing when main has no ref", async () => {
    const reads = fakeReads({ mainSha: undefined });
    const inputs = await readGardenerInputs({
      reads,
      repo: REPO,
      observations: [],
      now: NOW,
      fixStallMs: STALL,
    });
    expect(inputs.mainCheckFailures).toEqual([]);
  });
});

describe("readGardenerInputs: stalled FIX", () => {
  it("reports an open FIX from a reviewer, older than two hours, with no push since", async () => {
    const reads = fakeReads({ commitTime: NOW - 3 * HOUR });
    const obs = observation([comment(1, "FIX\n- add the test", twoHoursAgo)]);
    const inputs = await readGardenerInputs({
      reads,
      repo: REPO,
      observations: [obs],
      now: NOW,
      fixStallMs: STALL,
    });
    expect(inputs.fixVerdicts).toEqual([
      {
        repo: "example-owner/example-repo",
        pr: 12,
        headSha: "head1",
        verdictAt: NOW - STALL,
        lastPushAt: NOW - 3 * HOUR,
      },
    ]);
  });

  it("ignores a FIX written by the PR author", async () => {
    const reads = fakeReads({});
    const obs = observation([comment(1, "FIX\n- x", twoHoursAgo, "builder-author")]);
    const inputs = await readGardenerInputs({
      reads,
      repo: REPO,
      observations: [obs],
      now: NOW,
      fixStallMs: STALL,
    });
    expect(inputs.fixVerdicts).toEqual([]);
  });

  it("is closed by a later PASS from a reviewer", async () => {
    const reads = fakeReads({});
    const later = new Date(NOW - HOUR).toISOString();
    const obs = observation([
      comment(1, "FIX\n- x", twoHoursAgo),
      comment(2, "PASS", later, "other-reviewer"),
    ]);
    const inputs = await readGardenerInputs({
      reads,
      repo: REPO,
      observations: [obs],
      now: NOW,
      fixStallMs: STALL,
    });
    expect(inputs.fixVerdicts).toEqual([]);
  });

  it("does not read the head commit for a FIX younger than the stall window", async () => {
    const reads = fakeReads({});
    const recent = new Date(NOW - HOUR).toISOString();
    const obs = observation([comment(1, "FIX\n- x", recent)]);
    await readGardenerInputs({
      reads,
      repo: REPO,
      observations: [obs],
      now: NOW,
      fixStallMs: STALL,
    });
    expect(reads.getCommitTime).not.toHaveBeenCalled();
  });

  it("reports the push time, and the signal stage drops a FIX whose branch was pushed after it", async () => {
    const reads = fakeReads({ commitTime: NOW - HOUR });
    const obs = observation([comment(1, "FIX\n- x", twoHoursAgo)]);
    const inputs = await readGardenerInputs({
      reads,
      repo: REPO,
      observations: [obs],
      now: NOW,
      fixStallMs: STALL,
    });
    expect(inputs.fixVerdicts?.[0]?.lastPushAt).toBe(NOW - HOUR);
    expect(stalledFixSignals(inputs.fixVerdicts ?? [], NOW, STALL)).toEqual([]);
  });

  it("skips an undated comment, since its age cannot be known", async () => {
    const reads = fakeReads({});
    const obs = observation([comment(1, "FIX\n- x", undefined)]);
    const inputs = await readGardenerInputs({
      reads,
      repo: REPO,
      observations: [obs],
      now: NOW,
      fixStallMs: STALL,
    });
    expect(inputs.fixVerdicts).toEqual([]);
  });
});
