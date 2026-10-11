import { describe, expect, it } from "vitest";
import {
  classifyMergeRecord,
  latestBranchVerdict,
  missingGates,
  parseArgs,
  runReviewedMerge,
} from "../../scripts/merge-reviewed-pr.mjs";

const HEAD = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD_HEAD = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const REPO = "KeepOak/Branch-Agent";

type Fixture = {
  pull?: Record<string, unknown>;
  comments?: Array<{ id: number; body: string; author_association: string }>;
  checkRuns?: Array<{ id: number; name: string; status: string; conclusion: string | null }>;
};

function fakeGh(fixture: Fixture = {}) {
  const calls: Array<{ args: string[]; input?: string }> = [];
  const pull = {
    state: "open",
    merged: false,
    draft: false,
    head: { sha: HEAD },
    title: "fix: thing",
    ...fixture.pull,
  };
  const comments = fixture.comments ?? [
    { id: 10, body: `branch-verdict: MERGE head=${HEAD}\n\n- ok`, author_association: "OWNER" },
  ];
  const checkRuns = fixture.checkRuns ?? [
    { id: 1, name: "merge-gate", status: "completed", conclusion: "success" },
    { id: 2, name: "merge-gate-trusted", status: "completed", conclusion: "success" },
  ];
  const runGh = (args: string[], options: { input?: string } = {}) => {
    calls.push({ args, input: options.input });
    const path = args.find((arg) => arg.startsWith("repos/") || arg === "user") ?? "";
    if (args.includes("PUT")) {
      return JSON.stringify({ merged: true, sha: "c".repeat(40) });
    }
    if (path === "user") {
      return "stabrea\n";
    }
    if (path.includes("/comments")) {
      return comments.map((comment) => JSON.stringify(comment)).join("\n");
    }
    if (path.includes("/check-runs")) {
      return checkRuns.map((run) => JSON.stringify(run)).join("\n");
    }
    return JSON.stringify(pull);
  };
  return { calls, runGh };
}

function args(extra: string[] = ["--agent", "builder-elm"]) {
  return parseArgs(["1085", "--head", HEAD, "--apply", ...extra], {});
}

function mergeInput(calls: Array<{ args: string[]; input?: string }>) {
  const put = calls.find((call) => call.args.includes("PUT"));
  return put?.input ? JSON.parse(put.input) : undefined;
}

describe("merge reviewed PR", () => {
  it("records the merging Trunk in a merge commit pinned to the reviewed head", () => {
    const gh = fakeGh();
    runReviewedMerge(args(), gh.runGh, () => {});
    const put = gh.calls.find((call) => call.args.includes("PUT"));
    expect(put?.args).toEqual([
      "api",
      "-X",
      "PUT",
      `repos/${REPO}/pulls/1085/merge`,
      "--input",
      "-",
    ]);
    const request = mergeInput(gh.calls);
    expect(request).toMatchObject({ merge_method: "merge", sha: HEAD });
    expect(request.commit_title).toBe("Merge pull request #1085: fix: thing");
    expect(request.commit_message).toBe(
      `Reviewed head ${HEAD}; merge-gate green; merge-gate-trusted green; independent review branch-verdict: MERGE.\n\nMerged-by: agent:builder-elm via GitHub @stabrea`,
    );
    expect(classifyMergeRecord(request.commit_message)).toEqual({
      merger: "agent",
      agentId: "builder-elm",
    });
  });

  it("makes a merge by a person visibly different from a Trunk merge", () => {
    const gh = fakeGh();
    runReviewedMerge(args(["--person"]), gh.runGh, () => {});
    const message = mergeInput(gh.calls).commit_message;
    expect(message).toContain("Merged-by: person via GitHub @stabrea");
    expect(classifyMergeRecord(message)).toEqual({ merger: "person" });
    // A merge pressed in the GitHub UI carries no agent trailer either.
    expect(classifyMergeRecord("Merge pull request #1208 from KeepOak/trunk/x\n\nfix: y")).toEqual({
      merger: "person",
    });
    // The agent trailer only counts as its own trailer line, not quoted in prose.
    expect(classifyMergeRecord("Body says Merged-by: agent:builder-elm inline")).toEqual({
      merger: "person",
    });
  });

  it("refuses when the head moved after review", () => {
    const gh = fakeGh({ pull: { head: { sha: OLD_HEAD } } });
    expect(() => runReviewedMerge(args(), gh.runGh, () => {})).toThrow("head moved");
    expect(mergeInput(gh.calls)).toBeUndefined();
  });

  it("refuses a stale, superseded or untrusted verdict", () => {
    const stale = fakeGh({
      comments: [
        { id: 3, body: `branch-verdict: MERGE head=${OLD_HEAD}`, author_association: "OWNER" },
      ],
    });
    expect(() => runReviewedMerge(args(), stale.runGh, () => {})).toThrow(
      "no current branch-verdict",
    );
    const superseded = fakeGh({
      comments: [
        { id: 3, body: `branch-verdict: MERGE head=${HEAD}`, author_association: "OWNER" },
        { id: 4, body: `branch-verdict: FIX head=${HEAD}`, author_association: "MEMBER" },
      ],
    });
    expect(() => runReviewedMerge(args(), superseded.runGh, () => {})).toThrow("FIX head=");
    expect(
      latestBranchVerdict([
        { id: 5, body: `branch-verdict: MERGE head=${HEAD}`, author_association: "NONE" },
      ]),
    ).toBeUndefined();
  });

  it("refuses unless the newest merge-gate and merge-gate-trusted runs are green", () => {
    expect(
      missingGates([
        { id: 1, name: "merge-gate", status: "completed", conclusion: "success" },
        { id: 5, name: "merge-gate", status: "completed", conclusion: "failure" },
        { id: 2, name: "merge-gate-trusted", status: "in_progress", conclusion: null },
      ]),
    ).toEqual(["merge-gate", "merge-gate-trusted"]);
    const gh = fakeGh({
      checkRuns: [{ id: 1, name: "merge-gate", status: "completed", conclusion: "success" }],
    });
    expect(() => runReviewedMerge(args(), gh.runGh, () => {})).toThrow("merge-gate-trusted");
  });

  it("dry-run prints the merge record without merging", () => {
    const gh = fakeGh();
    const lines: string[] = [];
    runReviewedMerge({ ...args(), apply: false }, gh.runGh, (line: string) => lines.push(line));
    expect(mergeInput(gh.calls)).toBeUndefined();
    expect(lines.join("\n")).toContain("Merged-by: agent:builder-elm");
  });

  it("requires a full reviewed sha and exactly one merger identity", () => {
    expect(() => parseArgs(["1", "--head", "abc123", "--agent", "builder-elm"], {})).toThrow(
      "40-character",
    );
    expect(() => parseArgs(["1", "--head", HEAD], {})).toThrow("Name who is merging");
    expect(() =>
      parseArgs(["1", "--head", HEAD, "--agent", "builder-elm", "--person"], {}),
    ).toThrow("Name who is merging");
    expect(() => parseArgs(["1", "--head", HEAD, "--agent", "../x"], {})).toThrow(
      "Invalid agent id",
    );
    expect(parseArgs(["#7", "--head", HEAD, "--agent", "Builder-Elm"], {})).toMatchObject({
      pr: 7,
      agentId: "builder-elm",
      apply: false,
      repo: REPO,
    });
  });
});
