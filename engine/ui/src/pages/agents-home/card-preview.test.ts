import { describe, expect, it } from "vitest";
import { agentCardPreviewText } from "./card-preview.ts";

describe("agentCardPreviewText", () => {
  it.each([
    ["branch-verdict: MERGE head=1dbf548e00ee159a2b3c", "MERGE"],
    ["DONE 8bbcafc44658601a377c89d189e45a43a3", "DONE"],
    ["SELF-CHECK Final head: 45937dcb8ce97643b35", "SELF-CHECK"],
    ["Running engine 0.4.4-build-1f281090cd3f", "Running engine 0.4.4"],
    ["Pushed sha:1f281090cd3f to the branch", "Pushed to the branch"],
    ["Fixed the login bug in commit 1f281090cd3f", "Fixed the login bug"],
    ["Release ready (8bbcafc44658), tests green", "Release ready, tests green"],
    ["Deployed rev 45937dcb8ce9: all green", "Deployed: all green"],
    ["Checksum sha256=8bbcafc44658601a ok", "Checksum ok"],
  ])("removes hashes, their labels and review markers from %j", (input, expected) => {
    expect(agentCardPreviewText(input)).toBe(expected);
  });

  it("keeps ordinary words, numbers and short hex-like words", () => {
    expect(agentCardPreviewText("Hourly lead pass: posted the 23:01Z status, added cafe")).toBe(
      "Hourly lead pass: posted the 23:01Z status, added cafe",
    );
  });

  it("keeps all-digit runs such as order numbers", () => {
    expect(agentCardPreviewText("Refund sent for order 202610190001234")).toBe(
      "Refund sent for order 202610190001234",
    );
    expect(agentCardPreviewText("order=123456789012 shipped")).toBe("order=123456789012 shipped");
    expect(agentCardPreviewText("Build 202610190001 passed, head count 12")).toBe(
      "Build 202610190001 passed, head count 12",
    );
    expect(agentCardPreviewText("Running engine 0.4.4-build-202610190001")).toBe(
      "Running engine 0.4.4-build-202610190001",
    );
  });

  it("returns an empty string for missing previews", () => {
    expect(agentCardPreviewText(undefined)).toBe("");
    expect(agentCardPreviewText(null)).toBe("");
  });
});
