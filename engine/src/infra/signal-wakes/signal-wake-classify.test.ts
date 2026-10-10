import { describe, expect, it } from "vitest";
import {
  commentExcerpt,
  failingCheckNames,
  isFixVerdict,
  trunkForHeadRef,
} from "./signal-wake-classify.js";

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

describe("isFixVerdict", () => {
  it("accepts a body whose first word is FIX", () => {
    expect(isFixVerdict("FIX\n- missing test")).toBe(true);
    expect(isFixVerdict("  FIX: rename the helper")).toBe(true);
  });

  it("rejects PASS, lowercase fix, and words that only start with FIX", () => {
    expect(isFixVerdict("PASS")).toBe(false);
    expect(isFixVerdict("fix the typo")).toBe(false);
    expect(isFixVerdict("FIXED in the next push")).toBe(false);
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

describe("commentExcerpt", () => {
  it("keeps the first line and caps its length", () => {
    expect(commentExcerpt("FIX\nsecond line")).toBe("FIX");
    expect(commentExcerpt("x".repeat(400)).length).toBe(160);
  });
});
