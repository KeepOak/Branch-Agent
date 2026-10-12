import { describe, expect, it } from "vitest";
import { resolveGroveToolPolicyConsent } from "./tool-policy-runtime.js";

describe("resolveGroveToolPolicyConsent", () => {
  it("leaves ordinary non-Grove profiles dynamic", () => {
    const tools = { profile: "coding" };
    expect(
      resolveGroveToolPolicyConsent({
        agentTools: tools,
        agentId: "worker",
        profile: "coding",
        ownsProfile: true,
        hasAgentAllowlist: false,
      }),
    ).toEqual({ frozen: false });
  });

  it("does not treat an inherited global profile as Grove-owned authority", () => {
    expect(
      resolveGroveToolPolicyConsent({
        agentId: "worker",
        profile: "coding",
        ownsProfile: false,
        hasAgentAllowlist: false,
      }),
    ).toEqual({ frozen: false });
  });
});
