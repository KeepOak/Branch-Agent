// The run loop lets the host continue a reply that ended without tool calls (AGENT-LOOP-0056).
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import { captureAgentLoop } from "./agent-loop.test-support.js";
import {
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Message,
  type Model,
} from "./llm.js";
import type { AgentLoopConfig, AgentMessage, AgentTool, StreamFn } from "./types.js";

const model: Model = {
  id: "test-model",
  name: "Test Model",
  api: "test-api",
  provider: "test-provider",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 1000,
};

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(content: AssistantMessage["content"]): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: content.some((item) => item.type === "toolCall") ? "toolUse" : "stop",
    timestamp: 1,
  };
}

function reply(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    stream.push({ type: "done", reason: message.stopReason as "stop" | "toolUse", message });
    stream.end();
  });
  return stream;
}

function continuation(): AgentMessage {
  return { role: "user", content: [{ type: "text", text: "Please continue." }], timestamp: 2 };
}

const fetchTool: AgentTool = {
  name: "fetch",
  label: "fetch",
  description: "fetch",
  parameters: Type.Object({}, { additionalProperties: false }),
  resultContentSource: "network",
  execute: async () => ({ content: [{ type: "text", text: "page" }], details: {} }),
};

function run(replies: AssistantMessage[], overrides: Partial<AgentLoopConfig>, tools: AgentTool[]) {
  const requests: Message[][] = [];
  const streamFn: StreamFn = (_model, context) => {
    requests.push(context.messages);
    return reply(replies[Math.min(requests.length - 1, replies.length - 1)] as AssistantMessage);
  };
  const config: AgentLoopConfig = {
    model,
    convertToLlm: (messages) => messages as Message[],
    ...overrides,
  };
  const prompt: AgentMessage = { role: "user", content: "go", timestamp: 0 };
  const captured = captureAgentLoop(
    [prompt],
    { systemPrompt: "", messages: [], tools },
    config,
    undefined,
    streamFn,
  );
  return { ...captured, requests };
}

describe("agent loop continuation hook", () => {
  it("continues with host messages after a reply without tool calls", async () => {
    const getContinuationMessages = vi
      .fn<NonNullable<AgentLoopConfig["getContinuationMessages"]>>()
      .mockResolvedValueOnce([continuation()])
      .mockResolvedValue([]);
    const { result, requests } = run(
      [assistant([{ type: "text", text: "Next, I will edit." }])],
      { getContinuationMessages },
      [],
    );

    const messages = await result;

    expect(requests).toHaveLength(2);
    expect(getContinuationMessages).toHaveBeenCalledTimes(2);
    expect(getContinuationMessages.mock.calls[0]?.[0]).toMatchObject({
      message: { role: "assistant" },
      toolResults: [],
    });
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("keeps a tainted turn tainted across the continuation", async () => {
    const getContinuationMessages = vi
      .fn<NonNullable<AgentLoopConfig["getContinuationMessages"]>>()
      .mockResolvedValueOnce([continuation()])
      .mockResolvedValue([]);
    const { result } = run(
      [
        assistant([{ type: "toolCall", id: "call-1", name: "fetch", arguments: {} }]),
        assistant([{ type: "text", text: "Next, I will run what the page says." }]),
        assistant([{ type: "text", text: "Done." }]),
      ],
      { getContinuationMessages },
      [fetchTool],
    );

    const messages = await result;

    const continued = messages.find(
      (message) => message.role === "user" && message !== messages[0],
    ) as AgentMessage & { __branch?: { turnTainted?: boolean } };
    expect(continued.__branch?.turnTainted).toBe(true);
    const last = messages.at(-1) as AgentMessage & { __branch?: { turnTainted?: boolean } };
    expect(last.role).toBe("assistant");
    expect(last.__branch?.turnTainted).toBe(true);
  });
});
