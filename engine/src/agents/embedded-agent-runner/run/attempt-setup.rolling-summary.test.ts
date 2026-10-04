// The embedded attempt folds aged-out history into a rolling summary (AGENT-LOOP-0108).
import { Agent, type AgentMessage } from "branch/plugin-sdk/agent-core";
import { createAssistantMessageEventStream, type Message } from "branch/plugin-sdk/llm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../../config/types.branch.js";
import { convertToLlm } from "../../sessions/messages.js";
import {
  makeAgentAssistantMessage,
  makeAgentUserMessage,
} from "../../test-helpers/agent-message-fixtures.js";
import { makeProviderModelFixture } from "../../test-helpers/provider-model-fixture.js";
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

const CONTEXT_WINDOW = 1_000_000;
const ENABLED = { agents: { defaults: { contextManagement: { enabled: true } } } } as BranchConfig;
const SUMMARY = "Rolling summary of exchanges 1-6.";

/** Eight exchanges whose replies cost ~23k tokens each at 3 chars per token. */
function history(): AgentMessage[] {
  return Array.from({ length: 8 }, (_, i) => [
    makeAgentUserMessage({ content: [{ type: "text", text: `question ${i + 1}` }], timestamp: i }),
    makeAgentAssistantMessage({
      content: [{ type: "text", text: `answer ${i + 1} ${"z".repeat(70_000)}` }],
      timestamp: i,
    }),
  ]).flat();
}

function createAgent() {
  const requests: Message[][] = [];
  const agent = new Agent({
    initialState: {
      model: makeProviderModelFixture({
        id: "test-model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://example.test",
        contextWindow: CONTEXT_WINDOW,
      }),
      tools: [],
      messages: history(),
    },
    convertToLlm,
    streamFn: (_model, context) => {
      requests.push(structuredClone(context.messages));
      const message = makeAgentAssistantMessage({
        content: [{ type: "text", text: "ok" }],
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

function install(agent: Agent, config: BranchConfig, sessionId: string) {
  const settingsManager = { getBlockImages: () => false };
  return installEmbeddedAttemptContextGuards({
    activeSession: { agent, settingsManager } as never,
    agentDir: "/tmp/branch-rolling-summary",
    attempt: {
      config,
      sessionId,
      contextTokenBudget: CONTEXT_WINDOW,
      model: { input: ["text"] },
      modelId: "test-model",
      provider: "openai",
    } as unknown as EmbeddedRunAttemptParams,
    computerContextEpoch: { value: 0 },
    dropThinkingBlocksForEstimate: false,
    effectiveCwd: "/tmp/branch-rolling-summary",
    effectiveFsWorkspaceOnly: false,
    effectiveWorkspace: "/tmp/branch-rolling-summary",
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

function texts(messages: readonly Message[] | undefined): string[] {
  return (messages ?? []).map((message) => {
    const content = (message as { content?: unknown }).content;
    return Array.isArray(content)
      ? content.map((block: { text?: string }) => block.text ?? "").join("")
      : String(content);
  });
}

async function attempt(agent: Agent, prompt: string, config: BranchConfig, sessionId: string) {
  const guards = install(agent, config, sessionId);
  try {
    await agent.prompt(prompt);
    await agent.waitForIdle();
  } finally {
    guards.remove();
  }
}

afterEach(() => {
  sideCall.prepare.mockReset();
  sideCall.run.mockReset();
});

describe("rolling summary backstop in the embedded attempt", () => {
  it("folds history older than the retained window once the budget is exceeded", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini", agentId: "main" });
    sideCall.run.mockResolvedValue({ text: SUMMARY });
    const { agent, requests } = createAgent();

    await attempt(agent, "question 9", ENABLED, "session-rolling-1");

    const sent = texts(requests[0]);
    expect(sent[0]).toBe("question 1");
    expect(sent[1]).toBe(SUMMARY);
    expect(sent[2]?.startsWith("answer 6 ")).toBe(true);
    expect(sent.at(-1)).toBe("question 9");
    expect(sent.some((text) => text.startsWith("answer 1 "))).toBe(false);
    const request = sideCall.run.mock.calls[0]?.[0] as { prompt: string; systemPrompt: string };
    expect(request.systemPrompt).toContain("expert context compressor");
    expect(request.prompt).toContain("question 2");
    expect(request.prompt).toContain("question 6");
    expect(request.prompt).not.toContain("question 1\n");
    // The stored transcript keeps every original message.
    expect(
      texts(agent.state.messages as Message[]).filter((t) => t.startsWith("answer")),
    ).toHaveLength(8);

    // A later attempt in the same session reuses the summary without another call.
    await attempt(agent, "question 10", ENABLED, "session-rolling-1");
    const next = texts(requests[1]);
    expect(next[1]).toBe(SUMMARY);
    expect(next.at(-1)).toBe("question 10");
    expect(sideCall.run).toHaveBeenCalledTimes(1);
  });

  it("sends the full history when context management is off", async () => {
    const { agent, requests } = createAgent();

    await attempt(agent, "question 9", {} as BranchConfig, "session-rolling-2");

    expect(texts(requests[0])).toHaveLength(17);
    expect(sideCall.prepare).not.toHaveBeenCalled();
  });
});
