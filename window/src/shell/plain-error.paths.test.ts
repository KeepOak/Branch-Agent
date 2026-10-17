// @vitest-environment jsdom
// Relative paths, absolute roots the old check missed, a lead that names a path, and quota text without 429.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { plainError, PLAIN_FAILURE } from "./plain-error";

const RAW = /notes\/plan\.md|\/data\/branch|engine\/dist|\.\.\/old\/file|insufficient_quota|quota exceeded/;

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("plainError paths and quota at Regular", () => {
  it("replaces a relative file path with a next step", () => {
    expect(plainError("failed to read notes/plan.md", true)).not.toMatch(RAW);
    expect(plainError("failed to read notes/plan.md", true)).toBe(PLAIN_FAILURE);
    expect(plainError("failed to read ../old/file.ts", true)).not.toMatch(RAW);
    expect(plainError("failed to read ../old/file.ts", true)).toBe(PLAIN_FAILURE);
  });

  it("replaces an absolute path whose root is not in the old home/tmp list", () => {
    expect(plainError("open /data/branch/config.json failed", true)).not.toMatch(RAW);
    expect(plainError("open /data/branch/config.json failed", true)).toBe(PLAIN_FAILURE);
  });

  it("does not keep a lead that still names a path", () => {
    const said = plainError("Couldn't open notes/plan.md: connect ECONNREFUSED 127.0.0.1:18789", true);
    expect(said).not.toMatch(RAW);
    expect(said).not.toContain("notes/plan.md");
    expect(said).toBe("Branch can’t reach its engine right now. It keeps trying, so try again in a moment.");
  });

  it("maps quota text without 429 to a plan or usage sentence", () => {
    expect(plainError("insufficient_quota", true)).toBe("That plan or usage limit is used up. Check the plan, then try again.");
    expect(plainError("You exceeded your current quota", true)).toBe("That plan or usage limit is used up. Check the plan, then try again.");
    expect(plainError("quota exceeded for this key", true)).toBe("That plan or usage limit is used up. Check the plan, then try again.");
  });

  it.each(["advanced", "technical"] as const)("keeps the exact path and quota words at %s", (level) => {
    localStorage.setItem("branch.level", level);
    expect(plainError("failed to read notes/plan.md")).toBe("failed to read notes/plan.md");
    expect(plainError("insufficient_quota")).toBe("insufficient_quota");
  });
});
