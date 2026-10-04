// The embedded attempt continues a reply that stopped mid-task (AGENT-LOOP-0056).
import { Agent, type AgentMessage } from "branch/plugin-sdk/agent-core";
import { createAssistantMessageEventStream, type Message } from "branch/plugin-sdk/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../../config/types.branch.js";
import { convertToLlm } from "../../sessions/messages.js";
import { makeAgentAssistantMessage } from "../../test-helpers/agent-message-fixtures.js";
import { makeProviderModelFixture } from "../../test-helpers/provider-model-fixture.js";
import { NEXT_SPEAKER_MAX_TURNS } from "../next-speaker-continuation.js";
import { createToolResultPromptProjectionState } from "../session-prompt-state.js";
import { installEmbeddedAttemptContextGuards } from "./attempt-setup.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

const sideCall = vi.hoisted(() => ({ prepare: vi.fn(), run: vi.fn() }));

vi.mock("../../utility-completion.js", () => ({
  prepareUtilityCompletionForAgent: sideCall.prepare,
}));
vi.mock("../../isolated-completion.js", () => ({
  runIsolatedCompletion: sideCall.run,
}));

const model = makeProviderModelFixture({
  id: "test-model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.test",
  contextWindow: 32_000,
});

function verdict(nextSpeaker: "user" | "model") {
  return { text: JSON.stringify({ reasoning: "fixture", next_speaker: nextSpeaker }) };
}

function createAgent(replies: string[]) {
  const requests: Message[][] = [];
  const agent = new Agent({
    initialState: { model, tools: [] },
    convertToLlm,
    streamFn: (_model, context) => {
      requests.push(structuredClone(context.messages));
      const text = replies[Math.min(requests.length - 1, replies.length - 1)] ?? "Done.";
      const message = makeAgentAssistantMessage({
        content: [{ type: "text", text }],
        stopReason: "stop",
      });
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      stream.end();
      return stream;
    },
  });
  return { agent, requests };
}

function install(agent: Agent, config: BranchConfig) {
  const settingsManager = { getBlockImages: () => false };
  return installEmbeddedAttemptContextGuards({
    activeSession: { agent, settingsManager } as never,
    agentDir: "/tmp/branch-next-speaker",
    attempt: {
      config,
      contextTokenBudget: 32_000,
      model: { input: ["text"] },
      modelId: "test-model",
      provider: "openai",
    } as unknown as EmbeddedRunAttemptParams,
    computerContextEpoch: { value: 0 },
    dropThinkingBlocksForEstimate: false,
    effectiveCwd: "/tmp/branch-next-speaker",
    effectiveFsWorkspaceOnly: false,
    effectiveWorkspace: "/tmp/branch-next-speaker",
    getPrePromptMessageCount: () => 0,
    getPromptCache: () => undefined,
    getPromptCacheRetention: () => undefined,
    getCompactionReplayEnabled: () => false,
    getServerToolClearingEnabled: () => false,
    toolResultPromptProjectionState: createToolResultPromptProjectionState(),
    getSystemPrompt: () => "",
    isOpenAIResponsesApi: false,
    repairToolUseResultPairing: false,
    sessionAgentId: "main",
    sessionManager: {} as never,
    settingsManager: settingsManager as never,
  });
}

function userTexts(messages: readonly AgentMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === "user" && Array.isArray(message.content)
      ? message.content.flatMap((block) => (block.type === "text" ? [block.text] : []))
      : [],
  );
}

const ENABLED = { agents: { defaults: { skipNextSpeakerCheck: false } } } as BranchConfig;

afterEach(() => {
  sideCall.prepare.mockReset();
  sideCall.run.mockReset();
});

describe("next-speaker continuation in the embedded attempt", () => {
  it("sends 'Please continue.' when the utility model says the model speaks next", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini", agentId: "main" });
    sideCall.run.mockResolvedValueOnce(verdict("model")).mockResolvedValueOnce(verdict("user"));
    const { agent, requests } = createAgent([
      "Next, I will update the config file.",
      "Updated the config file.",
    ]);
    const guards = install(agent, ENABLED);
    try {
      await agent.prompt("Fix the config.");
      await agent.waitForIdle();
    } finally {
      guards.remove();
    }

    expect(requests).toHaveLength(2);
    expect(userTexts(agent.state.messages)).toEqual(["Fix the config.", "Please continue."]);
    expect(sideCall.run).toHaveBeenCalledTimes(2);
    const request = sideCall.run.mock.calls[0]?.[0] as { prompt: string; config: unknown };
    expect(request.prompt).toContain("Next, I will update the config file.");
    expect(request.config).toBe(ENABLED);
    expect(sideCall.prepare).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "main", useUtilityModel: true }),
    );
  });

  it("ends the run when the utility model hands the turn to the user", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini" });
    sideCall.run.mockResolvedValue(verdict("user"));
    const { agent, requests } = createAgent(["Which file should I change?"]);
    const guards = install(agent, ENABLED);
    try {
      await agent.prompt("Fix the config.");
      await agent.waitForIdle();
    } finally {
      guards.remove();
    }

    expect(requests).toHaveLength(1);
    expect(sideCall.run).toHaveBeenCalledTimes(1);
  });

  it("is off by default (upstream skipNextSpeakerCheck = true)", async () => {
    const { agent, requests } = createAgent(["Next, I will update the config file."]);
    const guards = install(agent, {} as BranchConfig);
    try {
      await agent.prompt("Fix the config.");
      await agent.waitForIdle();
    } finally {
      guards.remove();
    }

    expect(requests).toHaveLength(1);
    expect(sideCall.prepare).not.toHaveBeenCalled();
    expect(agent.getContinuationMessages).toBeUndefined();
  });

  it("stops after the upstream turn bound when the check keeps saying 'model'", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini" });
    sideCall.run.mockResolvedValue(verdict("model"));
    const { agent, requests } = createAgent(["Next, I will keep going."]);
    const guards = install(agent, ENABLED);
    try {
      await agent.prompt("Loop.");
      await agent.waitForIdle();
    } finally {
      guards.remove();
    }

    expect(requests).toHaveLength(NEXT_SPEAKER_MAX_TURNS + 1);
  });

  it("restores the agent hook when the attempt ends", () => {
    const { agent } = createAgent([]);
    const guards = install(agent, ENABLED);
    expect(agent.getContinuationMessages).toBeTypeOf("function");
    guards.remove();
    expect(agent.getContinuationMessages).toBeUndefined();
  });
});
