import { describe, expect, it } from "vitest";
import { startersFor } from "./EmptyState";

describe("empty conversation starters", () => {
  it("picks four by what the Trunk is for, and the everyday four for the default Trunk", () => {
    expect(startersFor("Money & receipts", false)[0]).toBe("Match this month’s receipts to my card statement");
    expect(startersFor("Plans trips", false)).toHaveLength(4);
    expect(startersFor("Research", true)[0]).toBe("Tidy my Downloads folder");
  });
});

describe("a new Trunk's empty state (UI audit N5)", () => {
  it("does not offer the default Trunk's chores to a Trunk with no job yet", () => {
    expect(startersFor("", false)).toEqual([]);
    expect(startersFor("   ", false)).toEqual([]);
  });

  it("asks about the Trunk's own job when no starter list fits its theme", () => {
    expect(startersFor("Gardening", false)).toEqual(["Show me how you can help with \u201cGardening\u201d"]);
  });
});
