// Behaviour test for atlas TOOLS-0166 (independent tool calls run in parallel,
// observations keep source order). Mirrors openai/codex@cc31e374fc15cd616fca19c07d55f9fa7e6d7e31:
// codex-rs/core/tests/suite/tool_parallelism.rs against the existing agent loop.
import { setImmediate } from "node:timers/promises";
import { createAssistantMessageEventStream } from "@branch/ai/event-stream";
import type { AssistantMessage, Context, Model, ToolCall } from "@branch/llm-core";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { createDeferred, withTestTimeout } from "../../../test/helpers/promise.js";
import { runAgentLoop } from "./agent-loop.js";
import type { AgentEvent, AgentMessage, AgentTool, StreamFn } from "./types.js";

const model: Model = {
  id: "parallel-model",
  name: "Parallel Model",
  api: "test-api",
  provider: "test-provider",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 1000,
};

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
): AssistantMessage {
  return {
    role: "assistant",
    content,
    stopReason,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    timestamp: 1,
  };
}

function call(id: string): ToolCall {
  return { type: "toolCall", name: id, id, arguments: {} };
}

function respond(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  stream.push({
    type: "done",
    reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
    message,
  });
  stream.end();
  return stream;
}

function gatedTool(name: string, started: () => void, gate: Promise<void>): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: Type.Object({}),
    execute: async () => {
      started();
      await gate;
      return { content: [{ type: "text", text: `${name} done` }], details: {} };
    },
  };
}

it.each([undefined, "parallel"] as const)(
  "runs independent tool calls concurrently and keeps observations in source order (toolExecution: %s)",
  async (toolExecution) => {
    const firstStarted = createDeferred();
    const secondStarted = createDeferred();
    const releaseFirst = createDeferred();
    const releaseSecond = createDeferred();
    const calls = [call("first"), call("second")];
    const contexts: Context["messages"][] = [];
    const streamFn: StreamFn = (_model, context) => {
      contexts.push(structuredClone(context.messages));
      return contexts.length === 1
        ? respond(assistant(calls, "toolUse"))
        : respond(assistant([{ type: "text", text: "done" }], "stop"));
    };
    const secondEnded = createDeferred();
    const executionEnds: string[] = [];
    const persisted: AgentMessage[] = [];
    const run = runAgentLoop(
      [{ role: "user", content: "run both", timestamp: 0 }],
      {
        systemPrompt: "",
        messages: [],
        tools: [
          gatedTool("first", () => firstStarted.resolve(), releaseFirst.promise),
          gatedTool("second", () => secondStarted.resolve(), releaseSecond.promise),
        ],
      },
      {
        model,
        ...(toolExecution ? { toolExecution } : {}),
        convertToLlm: (messages) => messages as Context["messages"],
      },
      (event: AgentEvent) => {
        if (event.type === "tool_execution_end") {
          executionEnds.push(event.toolCallId);
          if (event.toolCallId === "second") {
            secondEnded.resolve();
          }
        }
        if (event.type === "message_end") {
          persisted.push(event.message);
        }
      },
      undefined,
      streamFn,
    );
    try {
      // Both calls are running while the first one is still blocked.
      await withTestTimeout(firstStarted.promise, 1_000, "First tool did not start");
      await withTestTimeout(secondStarted.promise, 1_000, "Second tool did not start in parallel");
      releaseSecond.resolve();
      await withTestTimeout(secondEnded.promise, 1_000, "Second tool did not finish");
      expect(executionEnds).toEqual(["second"]);
      expect(persisted.some((message) => message.role === "toolResult")).toBe(false);
      releaseFirst.resolve();
      await run;
    } finally {
      releaseFirst.resolve();
      releaseSecond.resolve();
      await run;
    }
    // Completion order is second then first; the transcript keeps the model's order.
    expect(executionEnds).toEqual(["second", "first"]);
    const results = persisted.filter((message) => message.role === "toolResult");
    expect(results.map((message) => message.toolCallId)).toEqual(["first", "second"]);
    expect(
      contexts[1]?.filter((message) => message.role === "toolResult").map((m) => m.toolCallId),
    ).toEqual(["first", "second"]);
  },
);

it("runs the same calls one at a time in sequential mode", async () => {
  const started: string[] = [];
  const releaseFirst = createDeferred();
  const calls = [call("first"), call("second")];
  let requests = 0;
  const streamFn: StreamFn = () =>
    ++requests === 1
      ? respond(assistant(calls, "toolUse"))
      : respond(assistant([{ type: "text", text: "done" }], "stop"));
  const firstStarted = createDeferred();
  const run = runAgentLoop(
    [{ role: "user", content: "run both", timestamp: 0 }],
    {
      systemPrompt: "",
      messages: [],
      tools: [
        gatedTool(
          "first",
          () => {
            started.push("first");
            firstStarted.resolve();
          },
          releaseFirst.promise,
        ),
        gatedTool("second", () => started.push("second"), Promise.resolve()),
      ],
    },
    {
      model,
      toolExecution: "sequential",
      convertToLlm: (messages) => messages as Context["messages"],
    },
    () => {},
    undefined,
    streamFn,
  );
  try {
    await withTestTimeout(firstStarted.promise, 1_000, "First tool did not start");
    await setImmediate();
    expect(started).toEqual(["first"]);
  } finally {
    releaseFirst.resolve();
    await run;
  }
  expect(started).toEqual(["first", "second"]);
});
