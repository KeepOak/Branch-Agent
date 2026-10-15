import { describe, expect, it, vi } from "vitest";
import {
  buildSystemAgentChatResult,
  getSystemAgentChatInputError,
  runSystemAgentChatInput,
} from "./system-agent-chat-turn.js";

function makeEngine() {
  const handle = vi.fn();
  const answerWizard = vi.fn();
  const cancelWizard = vi.fn();
  return {
    answerWizard,
    cancelWizard,
    handle,
    engine: { answerWizard, cancelWizard, handle },
  };
}

describe("system-agent chat input", () => {
  it.each([
    {
      input: {
        sessionId: "s1",
        message: "5",
        wizardAnswer: { stepId: "channel", value: "twitch" },
      },
      error: "Send either message or wizardAnswer, not both.",
    },
    {
      input: {
        sessionId: "s1",
        wizardAnswer: { stepId: "secret", value: "not-forwarded" },
        delegation: { agentId: "main", sessionKey: "agent:main:main" },
      },
      error: "Delegated Branch Agent sessions cannot submit structured wizard answers.",
    },
    {
      input: {
        sessionId: "s1",
        wizardAnswer: { stepId: "channel", value: "twitch" },
        reset: true,
      },
      error: "A wizard answer cannot reset its Branch Agent chat session.",
    },
    {
      input: {
        sessionId: "s1",
        message: "cancel",
        wizardCancel: { stepId: "channel" },
      },
      error: "Send wizardCancel without a message or wizardAnswer.",
    },
    {
      input: {
        sessionId: "s1",
        wizardAnswer: { stepId: "channel", value: "twitch" },
        wizardCancel: { stepId: "channel" },
      },
      error: "Send wizardCancel without a message or wizardAnswer.",
    },
    {
      input: {
        sessionId: "s1",
        wizardCancel: { stepId: "channel" },
        delegation: { agentId: "main", sessionKey: "agent:main:main" },
      },
      error: "Delegated Branch Agent sessions cannot cancel hosted wizards.",
    },
    {
      input: {
        sessionId: "s1",
        wizardCancel: { stepId: "channel" },
        reset: true,
      },
      error: "A wizard cancel cannot reset its Branch Agent chat session.",
    },
  ])("rejects invalid mixed input: $error", ({ input, error }) => {
    expect(getSystemAgentChatInputError(input)).toBe(error);
  });

  it("routes a structured wizard answer through the typed engine seam", async () => {
    const { engine, answerWizard, handle } = makeEngine();
    answerWizard.mockResolvedValue({ text: "Next step.", action: "none" });

    await expect(
      runSystemAgentChatInput({
        engine,
        input: {
          sessionId: "s1",
          wizardAnswer: { stepId: "channel", value: "twitch" },
        },
      }),
    ).resolves.toEqual({ text: "Next step.", action: "none" });

    expect(answerWizard).toHaveBeenCalledWith({ stepId: "channel", value: "twitch" });
    expect(handle).not.toHaveBeenCalled();
  });

  it("routes a structured wizard cancel through the typed engine seam", async () => {
    const { engine, answerWizard, cancelWizard, handle } = makeEngine();
    cancelWizard.mockResolvedValue({ text: "Setup cancelled.", action: "none" });

    await expect(
      runSystemAgentChatInput({
        engine,
        input: {
          sessionId: "s1",
          wizardCancel: { stepId: "channel" },
        },
      }),
    ).resolves.toEqual({ text: "Setup cancelled.", action: "none" });

    expect(cancelWizard).toHaveBeenCalledWith({ stepId: "channel" });
    expect(answerWizard).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it("preserves the enriched wizard step in the gateway result", () => {
    expect(
      buildSystemAgentChatResult({
        sessionId: "s1",
        reply: {
          text: "Choose a channel.",
          action: "none",
          step: {
            id: "channel",
            type: "select",
            message: "Channel",
            options: [{ label: "Twitch", value: "twitch" }],
          },
        },
      }),
    ).toMatchObject({
      sessionId: "s1",
      reply: "Choose a channel.",
      action: "none",
      step: { id: "channel", type: "select" },
    });
  });

  it("projects a personal-account handoff without claiming a mutation or changing action", () => {
    expect(
      buildSystemAgentChatResult({
        sessionId: "s1",
        reply: {
          text: "Open your account controls; nothing has changed.",
          action: "none",
          handoff: { kind: "model-accounts" },
        },
      }),
    ).toEqual({
      sessionId: "s1",
      reply: "Open your account controls; nothing has changed.",
      action: "none",
      handoff: { kind: "model-accounts" },
    });
  });
});

describe("system-agent chat proposal", () => {
  const reply = { text: "Here is my proposal.", action: "none" as const };

  it("returns a staged create-agent request with only the fields the operation holds", () => {
    const result = buildSystemAgentChatResult({
      sessionId: "s1",
      reply,
      pendingProposal: {
        operation: {
          kind: "create-agent",
          agentId: "quill",
          name: "Quill",
          purpose: "Watch renewals",
          role: "researcher",
          workspace: "/tmp/quill",
        },
      },
    });
    expect(result).toEqual({
      sessionId: "s1",
      reply: "Here is my proposal.",
      action: "none",
      needsApproval: true,
      proposal: { kind: "create-agent", agentId: "quill", name: "Quill", job: "Watch renewals", role: "researcher" },
    });
    expect(result.proposal).not.toHaveProperty("workspace");
  });

  it("omits the optional fields a create-agent request does not name", () => {
    const result = buildSystemAgentChatResult({
      sessionId: "s1",
      reply,
      pendingProposal: { operation: { kind: "create-agent", agentId: "quill" } },
    });
    expect(result.proposal).toEqual({ kind: "create-agent", agentId: "quill" });
  });

  it("flags other staged operations for approval without a proposal", () => {
    const result = buildSystemAgentChatResult({
      sessionId: "s1",
      reply,
      pendingProposal: { operation: { kind: "config-unset", path: "agents.list" } },
    });
    expect(result).toEqual({ sessionId: "s1", reply: "Here is my proposal.", action: "none", needsApproval: true });
  });

  it("adds nothing when no operation is staged", () => {
    const result = buildSystemAgentChatResult({ sessionId: "s1", reply, pendingProposal: null });
    expect(result).not.toHaveProperty("needsApproval");
    expect(result).not.toHaveProperty("proposal");
  });
});

