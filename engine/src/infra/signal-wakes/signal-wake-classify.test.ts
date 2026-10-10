import { describe, expect, it } from "vitest";
import {
  failingCheckNames,
  isTrustedAssociation,
  latestBranchVerdict,
  parseBranchVerdict,
  sanitizeCheckName,
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
  it("returns the verdict on the highest trusted comment id, ignoring other comments", () => {
    const latest = latestBranchVerdict([
      { id: 5, body: `branch-verdict: FIX head=${SHA}`, authorAssociation: "OWNER" },
      { id: 9, body: "thanks", authorAssociation: "OWNER" },
      { id: 7, body: `branch-verdict: MERGE head=${SHA}`, authorAssociation: "MEMBER" },
    ]);
    expect(latest).toEqual({ id: 7, verdict: "MERGE", headSha: SHA });
  });

  it("ignores verdicts from untrusted associations, even when they are the newest", () => {
    const latest = latestBranchVerdict([
      { id: 5, body: `branch-verdict: MERGE head=${SHA}`, authorAssociation: "OWNER" },
      { id: 9, body: `branch-verdict: FIX head=${SHA}`, authorAssociation: "CONTRIBUTOR" },
      { id: 10, body: `branch-verdict: FIX head=${SHA}`, authorAssociation: "NONE" },
    ]);
    expect(latest).toEqual({ id: 5, verdict: "MERGE", headSha: SHA });
  });

  it("returns undefined when no trusted comment is a verdict", () => {
    expect(
      latestBranchVerdict([{ id: 1, body: "hello", authorAssociation: "OWNER" }]),
    ).toBeUndefined();
    expect(
      latestBranchVerdict([{ id: 2, body: `branch-verdict: FIX head=${SHA}` }]),
    ).toBeUndefined();
  });
});

describe("isTrustedAssociation", () => {
  it("trusts OWNER, MEMBER and COLLABORATOR only", () => {
    expect(["OWNER", "MEMBER", "COLLABORATOR"].map(isTrustedAssociation)).toEqual([
      true,
      true,
      true,
    ]);
    expect(
      ["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "NONE", undefined].map(isTrustedAssociation),
    ).toEqual([false, false, false, false]);
  });
});

describe("sanitizeCheckName", () => {
  it("strips control characters, neutralises quotes, and caps the length", () => {
    const clean = sanitizeCheckName(`a\nb\u0007"c" ${"z".repeat(200)}`);
    expect(Array.from(clean).some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)).toBe(
      false,
    );
    expect(clean).not.toContain('"');
    expect(clean.startsWith("a b 'c' ")).toBe(true);
    expect(clean.length).toBeLessThanOrEqual(80);
  });
});

describe("failingCheckNames", () => {
  it("returns completed runs with a failing conclusion only, sanitized", () => {
    expect(
      failingCheckNames([
        { name: "build", status: "completed", conclusion: "failure" },
        { name: "lint", status: "completed", conclusion: "success" },
        { name: "test", status: "in_progress", conclusion: null },
        { name: "e2e\nx", status: "completed", conclusion: "timed_out" },
      ]),
    ).toEqual(["build", "e2e x"]);
  });
});
