import { describe, expect, it } from "vitest";
import { pastAsks, snippetText } from "./HistorySearch";

describe("Ctrl R: search what you've asked", () => {
  it("lists this conversation's asks first, then other conversations', without commands or repeats", () => {
    expect(pastAsks(["Plan my week", "/goal ship it", "Plan my week"], ["Find a flight", "Plan my week"], "")).toEqual(["Plan my week", "Find a flight"]);
  });
  it("keeps only asks that contain the words typed, at most eight", () => {
    const many = Array.from({ length: 12 }, (_, i) => `flight ${i}`);
    expect(pastAsks(["Plan my week", ...many], [], "FLIGHT")).toHaveLength(8);
    expect(pastAsks(["Plan my week"], [], "flight")).toEqual([]);
  });
  it("drops the search's cut marks from a transcript match", () => {
    expect(snippetText(" … cheap refundable flight to Lisbon … ")).toBe("cheap refundable flight to Lisbon");
  });
});
