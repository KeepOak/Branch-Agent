// Behaviour tests for atlas SAFETY-0199 (R-1703, R-1723, G-1687, G-1705).
import { describe, expect, it } from "vitest";
import { buildDefaultToolPolicyPipelineSteps } from "../agents/tool-policy-pipeline.js";
import { filterToolsByPolicy } from "../agents/tool-policy-match.js";
import {
  capStartMode,
  outsideStartedToolPolicyStep,
  resolveVoiceTurnPolicy,
  skipsApprovalPrompts,
} from "./outside-work-cap.js";

const tools = ["exec", "write", "web_search", "web_fetch", "session_status", "memory_search", "message"].map((name) => ({ name }));

describe("R-1703 start mode for outside-started work", () => {
  it("R-1703: a conversation started from a chat app, trigger or schedule starts at most on Ask first", () => {
    for (const origin of ["chat-app", "trigger", "schedule", "group", "paired-sender"] as const) {
      expect(capStartMode({ origin, configured: "full", ownerMode: "full", household: false, lockdownOn: false })).toBe("guarded");
      expect(capStartMode({ origin, configured: "read-only", ownerMode: "full", household: false, lockdownOn: false })).toBe("read-only");
    }
  });

  it("R-1703: household members never start looser than the owner, Lockdown wins, and the owner's DMs keep full tools", () => {
    expect(capStartMode({ origin: "window", configured: "full", ownerMode: "guarded", household: true, lockdownOn: false })).toBe("guarded");
    expect(capStartMode({ origin: "owner-direct-chat", configured: "full", ownerMode: "full", household: false, lockdownOn: true })).toBe("read-only");
    expect(capStartMode({ origin: "owner-direct-chat", configured: "full", ownerMode: "full", household: false, lockdownOn: false })).toBe("full");
    expect(capStartMode({ origin: "window", configured: "full", ownerMode: "full", household: false, lockdownOn: false })).toBe("full");
  });
});

describe("R-1723 approval prompts", () => {
  it("R-1723: Full access removes prompts only for the owner; procedures, trusted folders, chat commands and USB keep asking", () => {
    for (const origin of ["self-starting-procedure", "trusted-folder", "chat-app", "usb"] as const) {
      expect(skipsApprovalPrompts({ origin, ownerFullAccess: true })).toBe(false);
    }
    expect(skipsApprovalPrompts({ origin: "window", ownerFullAccess: true })).toBe(true);
    expect(skipsApprovalPrompts({ origin: "owner-direct-chat", ownerFullAccess: true })).toBe(true);
  });
});

describe("G-1687 restricted tools for outside-started tasks", () => {
  it("G-1687: paired senders, groups and outside sources run with the restricted safe list", () => {
    const step = outsideStartedToolPolicyStep("paired-sender");
    expect(step).toBeDefined();
    expect(filterToolsByPolicy(tools, step?.policy).map((tool) => tool.name)).toEqual([
      "web_search",
      "web_fetch",
      "session_status",
    ]);
    const steps = buildDefaultToolPolicyPipelineSteps({ outsideStartedStep: step });
    expect(steps.at(-1)?.label).toBe("outside-started cap (paired-sender)");
  });

  it("G-1687: only the owner's verified direct chat (and the window) is an exception", () => {
    expect(outsideStartedToolPolicyStep("owner-direct-chat")).toBeUndefined();
    expect(outsideStartedToolPolicyStep("window")).toBeUndefined();
    expect(buildDefaultToolPolicyPipelineSteps({})).toHaveLength(8);
  });
});

describe("G-1705 voice and phone callers", () => {
  it("G-1705: remote voice callers get a bounded, tool-free isolated turn with no owner reach", () => {
    expect(filterToolsByPolicy(tools, outsideStartedToolPolicyStep("voice")?.policy)).toEqual([]);
    expect(resolveVoiceTurnPolicy({ callerNumber: "+1 555 0100", ownerNumber: "+15550199", pin: "1234", expectedPin: "1234" })).toMatchObject({
      kind: "isolated",
      tools: [],
      ownerMemory: false,
      ownerContext: false,
    });
  });

  it("G-1705: inbound owner slots require the exact owner number plus the PIN", () => {
    expect(resolveVoiceTurnPolicy({ callerNumber: "+1 555 0199", ownerNumber: "+15550199", pin: "1234", expectedPin: "1234" })).toEqual({ kind: "owner" });
    expect(resolveVoiceTurnPolicy({ callerNumber: "+15550199", ownerNumber: "+15550199", pin: "0000", expectedPin: "1234" }).kind).toBe("isolated");
    expect(resolveVoiceTurnPolicy({ callerNumber: "+15550199", ownerNumber: "+15550199", pin: undefined, expectedPin: undefined }).kind).toBe("isolated");
  });
});
