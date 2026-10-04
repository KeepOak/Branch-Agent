// The embedded attempt distills large tool outputs and oversized requests (AGENT-LOOP-0127).
import { readFile, rm } from "node:fs/promises";
import { Agent } from "branch/plugin-sdk/agent-core";
import { createAssistantMessageEventStream, type Message } from "branch/plugin-sdk/llm";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../../../config/types.branch.js";
import { convertToLlm } from "../../sessions/messages.js";
import { makeAgentAssistantMessage } from "../../test-helpers/agent-message-fixtures.js";
import { makeProviderModelFixture } from "../../test-helpers/provider-model-fixture.js";
import { TOOL_TRUNCATION_PREFIX } from "../../tool-output-distillation.js";
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

function createAgent(toolOutput: string) {
  const requests: Message[][] = [];
  const execute = vi.fn(async () => ({
    content: [{ type: "text" as const, text: toolOutput }],
    details: {},
  }));
  const agent = new Agent({
    initialState: {
      model: makeProviderModelFixture({
        id: "test-model",
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://example.test",
        contextWindow: CONTEXT_WINDOW,
      }),
      tools: [
        {
          name: "exec",
          label: "Exec",
          description: "Run a command",
          parameters: Type.Object({}),
          execute,
        },
      ],
    },
    convertToLlm,
    streamFn: (_model, context) => {
      requests.push(structuredClone(context.messages));
      const first = requests.length === 1;
      const message = makeAgentAssistantMessage({
        content: first
          ? [{ type: "toolCall", id: "call_exec", name: "exec", arguments: {} }]
          : [{ type: "text", text: "Build finished." }],
        stopReason: first ? "toolUse" : "stop",
      });
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: first ? "toolUse" : "stop", message });
      stream.end();
      return stream;
    },
  });
  return { agent, requests, execute };
}

function install(agent: Agent, config: BranchConfig) {
  const settingsManager = { getBlockImages: () => false };
  return installEmbeddedAttemptContextGuards({
    activeSession: { agent, settingsManager } as never,
    agentDir: "/tmp/branch-context-management",
    attempt: {
      config,
      contextTokenBudget: CONTEXT_WINDOW,
      model: { input: ["text"] },
      modelId: "test-model",
      provider: "openai",
    } as unknown as EmbeddedRunAttemptParams,
    computerContextEpoch: { value: 0 },
    dropThinkingBlocksForEstimate: false,
    effectiveCwd: "/tmp/branch-context-management",
    effectiveFsWorkspaceOnly: false,
    effectiveWorkspace: "/tmp/branch-context-management",
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

function textOf(message: Message | undefined): string {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") {
    return content;
  }
  return Array.isArray(content)
    ? content.map((block: { type?: string; text?: string }) => block.text ?? "").join("")
    : "";
}

async function runPrompt(agent: Agent, prompt: string, config: BranchConfig) {
  const guards = install(agent, config);
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

describe("context management in the embedded attempt", () => {
  it("saves, truncates and summarizes an oversized tool output", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini", agentId: "main" });
    sideCall.run.mockResolvedValue({ text: 'Exit code 1: "TypeError at src/app.ts:42"' });
    const output = Array.from({ length: 6_000 }, (_, i) => `build line ${i}`).join("\n");
    expect(output.length).toBeGreaterThan(80_000);
    const { agent, requests } = createAgent(output);

    await runPrompt(agent, "Run the build.", ENABLED);

    expect(requests).toHaveLength(2);
    const toolResult = requests[1]?.find((message) => message.role === "toolResult");
    const sent = textOf(toolResult);
    expect(sent.startsWith(TOOL_TRUNCATION_PREFIX)).toBe(true);
    expect(sent).toContain("--- Strategic Significance of Truncated Content ---");
    expect(sent).toContain("TypeError at src/app.ts:42");
    expect(sent.length).toBeLessThan(40_000 + 1_000);
    const savedPath = /Full output saved to: (\S+)/.exec(sent)?.[1];
    expect(savedPath).toBeDefined();
    try {
      expect(await readFile(savedPath ?? "", "utf8")).toContain("build line 5999");
    } finally {
      await rm(savedPath ?? "", { force: true });
    }
    const summaryRequest = sideCall.run.mock.calls[0]?.[0] as {
      prompt: string;
      timeoutMs: number;
    };
    expect(summaryRequest.prompt).toContain("The following output from the tool 'exec'");
    expect(summaryRequest.timeoutMs).toBe(15_000);
  });

  it("distills an oversized new request before it is sent", async () => {
    sideCall.prepare.mockResolvedValue({ provider: "openai", model: "mini" });
    sideCall.run.mockImplementation(async (request: { systemPrompt: string }) => ({
      text: request.systemPrompt.includes("USER_PROMPT") ? "Short distilled request." : "",
    }));
    const { agent, requests } = createAgent("ok");
    const prompt = `Please review this log:\n${"x".repeat(46_000)}`;

    await runPrompt(agent, prompt, ENABLED);

    const firstUser = requests[0]?.find((message) => message.role === "user");
    expect(textOf(firstUser)).toBe("Short distilled request.");
    // The stored transcript keeps the original request.
    const stored = agent.state.messages.find((message) => message.role === "user");
    expect(textOf(stored as Message)).toBe(prompt);
    // Later requests reuse the distilled replacement without another side call.
    const secondUser = requests[1]?.find((message) => message.role === "user");
    expect(textOf(secondUser)).toBe("Short distilled request.");
    expect(sideCall.run).toHaveBeenCalledTimes(1);
  });

  it("is off by default (upstream contextManagement.enabled = false)", async () => {
    const output = "y".repeat(50_000);
    const { agent, requests } = createAgent(output);

    await runPrompt(agent, "Run the build.", {} as BranchConfig);

    const toolResult = requests[1]?.find((message) => message.role === "toolResult");
    expect(textOf(toolResult)).not.toContain("Full output saved to");
    expect(sideCall.prepare).not.toHaveBeenCalled();
  });
});
