// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildBranchToolFallbackText } from "./prompt-surface.js";

describe("buildBranchToolFallbackText", () => {
  it("does not invent tool names when the structured list is unavailable", () => {
    const text = buildBranchToolFallbackText({
      surface: "branch_main",
    });

    expect(text).toContain("Use only exposed tools");
    expect(text).not.toMatch(/\b[a-z]+_[a-z_]+\b/);
  });
});
