import { describe, expect, it } from "vitest";
import {
  failingCheckNames,
  latestBranchVerdict,
  parseBranchVerdict,
  trunkForHeadRef,
} from "./signal-wake-classify.js";

const SHA = "f".repeat(40);

describe("trunkForHeadRef", () => {
  it("maps trunk/<id>-<rest> to a configured Trunk", () => {
    expect(trunkForHeadRef("trunk/builder-1-signal-wakes", ["builder-1", "builder-2"])).toBe(
      "builder-1",
    );
  });

  it("prefers the longest configured id when two ids share a prefix", () => {
    expect(trunkForHeadRef("trunk/builder-1-x", ["builder", "builder-1"])).toBe("builder-1");
    expect(trunkForHeadRef("trunk/builder-2-x", ["builder", "builder-1"])).toBe("builder");
  });

  it("ignores branches without the trunk prefix, unknown ids, and bare ids", () => {
    expect(trunkForHeadRef("feature/builder-1-x", ["builder-1"])).toBeUndefined();
    expect(trunkForHeadRef("trunk/unknown-1-x", ["builder-1"])).toBeUndefined();
    expect(trunkForHeadRef("trunk/builder-1", ["builder-1"])).toBeUndefined();
  });
});

describe("parseBranchVerdict", () => {
  it("reads MERGE and FIX with a full head sha on the first line", () => {
    expect(parseBranchVerdict(`branch-verdict: FIX head=${SHA}\n- problem`)).toEqual({
      verdict: "FIX",
      headSha: SHA,
    });
    expect(parseBranchVerdict(`branch-verdict: MERGE head=${SHA}`)).toEqual({
      verdict: "MERGE",
      headSha: SHA,
    });
  });

  it("rejects a verdict-looking line that is not the first line, a short sha, or a PASS word", () => {
    expect(parseBranchVerdict(`Review\nbranch-verdict: FIX head=${SHA}`)).toBeUndefined();
    expect(parseBranchVerdict("branch-verdict: FIX head=abc1234")).toBeUndefined();
    expect(parseBranchVerdict("FIX\n- missing test")).toBeUndefined();
    expect(parseBranchVerdict("PASS")).toBeUndefined();
  });
});

describe("latestBranchVerdict", () => {
  it("returns the verdict on the highest comment id, ignoring other comments", () => {
    const latest = latestBranchVerdict([
      { id: 5, body: `branch-verdict: FIX head=${SHA}` },
      { id: 9, body: "thanks" },
      { id: 7, body: `branch-verdict: MERGE head=${SHA}` },
    ]);
    expect(latest).toEqual({ id: 7, verdict: "MERGE", headSha: SHA });
  });

  it("returns undefined when no comment is a verdict", () => {
    expect(latestBranchVerdict([{ id: 1, body: "hello" }])).toBeUndefined();
  });
});

describe("failingCheckNames", () => {
  it("returns completed runs with a failing conclusion only", () => {
    expect(
      failingCheckNames([
        { name: "build", status: "completed", conclusion: "failure" },
        { name: "lint", status: "completed", conclusion: "success" },
        { name: "test", status: "in_progress", conclusion: null },
        { name: "e2e", status: "completed", conclusion: "timed_out" },
      ]),
    ).toEqual(["build", "e2e"]);
  });
});
