// Launchd label tests keep lifecycle, handoff, update, and discovery resolution aligned.
import { describe, expect, it } from "vitest";
import { resolveLaunchAgentLabel } from "./launchd-label.js";

describe("resolveLaunchAgentLabel", () => {
  it("resolves default, profile, and explicit labels", () => {
    expect(resolveLaunchAgentLabel()).toBe("ai.branch.gateway");
    expect(resolveLaunchAgentLabel({ BRANCH_PROFILE: "work" })).toBe("ai.branch.work");
    expect(
      resolveLaunchAgentLabel({
        BRANCH_PROFILE: "work",
        BRANCH_LAUNCHD_LABEL: "com.example.gateway",
      }),
    ).toBe("com.example.gateway");
  });

  it("rejects labels that cannot be passed safely to launchd", () => {
    expect(() =>
      resolveLaunchAgentLabel({ BRANCH_LAUNCHD_LABEL: "ai.branch.$(echo injected)" }),
    ).toThrow("Invalid launchd label");
  });
});
