import { describe, expect, it } from "vitest";
import { agentCardPreviewText } from "./card-preview.ts";

describe("agentCardPreviewText", () => {
  it.each([
    ["branch-verdict: MERGE head=1dbf548e00ee159a2b3c", "MERGE"],
    ["DONE 8bbcafc44658601a377c89d189e45a43a3", "DONE"],
    ["SELF-CHECK Final head: 45937dcb8ce97643b35", "SELF-CHECK Final head:"],
    ["Running engine 0.4.4-build-1f281090cd3f", "Running engine 0.4.4-build-"],
  ])("removes hashes and review markers from %j", (input, expected) => {
    expect(agentCardPreviewText(input)).toBe(expected);
  });

  it("keeps ordinary words, numbers and short hex-like words", () => {
    expect(agentCardPreviewText("Hourly lead pass: posted the 23:01Z status, added cafe")).toBe(
      "Hourly lead pass: posted the 23:01Z status, added cafe",
    );
  });

  it("returns an empty string for missing previews", () => {
    expect(agentCardPreviewText(undefined)).toBe("");
    expect(agentCardPreviewText(null)).toBe("");
  });
});
