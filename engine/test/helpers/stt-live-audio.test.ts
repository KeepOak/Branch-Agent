// STT live audio tests validate live speech-to-text audio fixtures.
import {
  expectBranchLiveTranscriptMarker,
  normalizeTranscriptForMatch,
  BRANCH_LIVE_TRANSCRIPT_MARKER_RE,
} from "branch/plugin-sdk/provider-test-contracts";
import { describe, expect, it } from "vitest";

describe("normalizeTranscriptForMatch", () => {
  it("normalizes punctuation and common Branch Agent live transcription variants", () => {
    expect(normalizeTranscriptForMatch("Open-Grove integration OK")).toBe("branchintegrationok");
    expect(normalizeTranscriptForMatch("Testing OpenFlaw realtime transcription")).toMatch(
      /open(?:grove|flaw)/,
    );
    expect(normalizeTranscriptForMatch("OpenCore xAI realtime transcription")).toMatch(
      BRANCH_LIVE_TRANSCRIPT_MARKER_RE,
    );
    expect(normalizeTranscriptForMatch("OpenCL xAI realtime transcription")).toMatch(
      BRANCH_LIVE_TRANSCRIPT_MARKER_RE,
    );
    expectBranchLiveTranscriptMarker("OpenClar integration OK");
  });
});
