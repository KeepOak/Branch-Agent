// The run loop enforces cline's consecutive-mistake cap (AGENT-LOOP-0064).
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
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

function tool(name: string, fail: () => boolean): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async () => {
      if (fail()) {
        throw new Error(`${name} failed`);
      }
      return { content: [{ type: "text", text: `${name} ok` }], details: {} };
    },
  };
}

function run(options: {
  turns: number;
  failOnTurn: (turn: number) => boolean;
  overrides?: Partial<AgentLoopConfig>;
}) {
  let requests = 0;
  const streamFn: StreamFn = () => {
    requests += 1;
    if (requests > options.turns) {
      return reply(assistant([{ type: "text", text: "done" }]));
    }
    return reply(assistant([{ type: "toolCall", id: `call-${requests}`, name: "exec", arguments: {} }]));
  };
  const config: AgentLoopConfig = {
    model,
    convertToLlm: (messages) => messages as Message[],
    ...options.overrides,
  };
  const user: AgentMessage = { role: "user", content: "go", timestamp: 1 };
  const capture = captureAgentLoop(
    [user],
    { systemPrompt: "", messages: [], tools: [tool("exec", () => options.failOnTurn(requests))] },
    config,
    undefined,
    streamFn,
  );
  return { capture, requests: () => requests };
}

function lastAssistantText(messages: AgentMessage[]): string {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") {
    return "";
  }
  return last.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

describe("consecutive mistake cap in the run loop", () => {
  it("stops after six all-failed tool turns by default", async () => {
    const { capture, requests } = run({ turns: 20, failOnTurn: () => true });
    const messages = await capture.result;
    expect(requests()).toBe(6);
    expect(lastAssistantText(messages)).toMatch(
      /^Stopped after 6\/6 consecutive mistakes \(tool_execution_failed\) at iteration 6\./,
    );
    expect(capture.events.at(-1)?.type).toBe("agent_end");
  });

  it("resets the count when a turn has a successful tool call", async () => {
    const { capture, requests } = run({
      turns: 9,
      failOnTurn: (turn) => turn !== 5,
      overrides: { maxConsecutiveMistakes: 5 },
    });
    const messages = await capture.result;
    expect(requests()).toBe(10);
    expect(lastAssistantText(messages)).toBe("done");
  });

  it("never stops when the cap is disabled", async () => {
    const { capture, requests } = run({
      turns: 12,
      failOnTurn: () => true,
      overrides: { maxConsecutiveMistakes: 0 },
    });
    const messages = await capture.result;
    expect(requests()).toBe(13);
    expect(lastAssistantText(messages)).toBe("done");
  });

  it("adds limit-handler guidance as a user notice and keeps going", async () => {
    const { capture, requests } = run({
      turns: 3,
      failOnTurn: () => true,
      overrides: {
        maxConsecutiveMistakes: 2,
        onConsecutiveMistakeLimitReached: () => ({ action: "continue", guidance: "try another way" }),
      },
    });
    const messages = await capture.result;
    expect(requests()).toBe(4);
    expect(messages).toContainEqual(
      expect.objectContaining({ role: "user", content: [{ type: "text", text: "try another way" }] }),
    );
  });
});
