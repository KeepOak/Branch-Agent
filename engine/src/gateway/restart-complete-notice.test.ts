import { describe, expect, it } from "vitest";
import { formatChatRestartComplete } from "./restart-complete-notice.js";

describe("chat restart-complete notice", () => {
  it("includes the elapsed restart duration", () => {
    expect(formatChatRestartComplete(1_000, 3_450)).toBe(
      "♻️ Gateway back online after 2.5s.",
    );
  });

  it("never reports a negative duration after a clock correction", () => {
    expect(formatChatRestartComplete(3_000, 2_000)).toBe(
      "♻️ Gateway back online after 0.0s.",
    );
  });
});
