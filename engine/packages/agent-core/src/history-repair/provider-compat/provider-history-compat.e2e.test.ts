// From mastra-ai/mastra@486d3b7f35edfeaeab47b1230b56880e672cc421:packages/core/src/processors/provider-history-compat.e2e.test.ts (atlas AGENT-LOOP-0095). Replays the pinned real provider responses through native SDKs, Branch's agent-loop boundary and Anthropic request builder; source assertions preserved.
import Anthropic from "@anthropic-ai/sdk";
import type { Message, Model, AssistantMessage } from "@branch/llm-core";
import OpenAI from "openai";
import { expect, it } from "vitest";
import { buildAnthropicRequest } from "../../../../ai/src/transports/anthropic-messages.js";
import {
  captureAgentLoop,
  config,
  makeAssistantMessage,
  model,
  user,
  reply,
} from "../../agent-loop.test-support.js";
import {
  foreignFirst,
  foreignReply,
  nativeFirst,
  nativeReply,
} from "./provider-history-compat.fixtures.js";
const anthropicModel: Model<"anthropic-messages"> = {
  ...model,
  api: "anthropic-messages",
  provider: "anthropic",
  id: "claude-haiku-4-5-20251001",
};
async function replayLaterRequest(messages: Message[], body: unknown, thinking = false) {
  let request: Anthropic.MessageCreateParamsNonStreaming | undefined;
  const client = new Anthropic({
    apiKey: "recording-key",
    maxRetries: 0,
    fetch: async (_input, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const run = captureAgentLoop(
    [user("Reply with only: OK")],
    { systemPrompt: "Reply exactly as requested.", messages },
    { ...config, model: anthropicModel },
    undefined,
    async (activeModel, context) => {
      const { params } = await buildAnthropicRequest(
        activeModel as Model<"anthropic-messages">,
        context,
        thinking
          ? { thinkingEnabled: true, thinkingBudgetTokens: 1024, maxTokens: 1200 }
          : undefined,
        "provider",
        false,
        false,
      );
      const result = await client.messages.create({ ...params, stream: false });
      return reply({
        ...makeAssistantMessage(
          result.content.flatMap((p) =>
            p.type === "text" ? [{ type: "text" as const, text: p.text }] : [],
          ),
        ),
        api: anthropicModel.api,
        provider: anthropicModel.provider,
        model: anthropicModel.id,
      });
    },
  );
  const result = await run.result;
  const final = result.at(-1);
  return { request, text: final?.role === "assistant" ? final.content : [] };
}
it("strips real foreign reasoning history before a real native Anthropic request", async () => {
  const client = new OpenAI({
    apiKey: "recording-key",
    baseURL: "https://openrouter.ai/api/v1",
    maxRetries: 0,
    fetch: async () =>
      new Response(JSON.stringify(foreignFirst), {
        headers: { "content-type": "application/json" },
      }),
  });
  const firstUserMessage = user("What is 19 * 23? Reply with one sentence.") as Message;
  const firstResult = await client.chat.completions.create({
    model: "minimax/minimax-m2.5",
    messages: [{ role: "user", content: "What is 19 * 23? Reply with one sentence." }],
  });
  const firstMessage = firstResult.choices[0]?.message;
  expect(firstMessage).toBeDefined();
  expect(JSON.stringify(firstMessage)).toContain("reasoning");
  const assistantMessage = {
    ...makeAssistantMessage([
      { type: "thinking" as const, thinking: foreignFirst.choices[0].message.reasoning },
      { type: "text" as const, text: firstMessage!.content! },
    ]),
    api: "openai-completions",
    provider: "openrouter",
    model: "minimax/minimax-m2.5",
  };
  const { request, text } = await replayLaterRequest(
    [firstUserMessage, assistantMessage],
    foreignReply,
  );
  const anthropicAssistantMessage = request?.messages.find((m) => m.role === "assistant");
  expect(anthropicAssistantMessage).toEqual(
    expect.objectContaining({
      role: "assistant",
      content: [{ type: "text", text: firstMessage!.content }],
    }),
  );
  expect(anthropicAssistantMessage!.content).not.toEqual(
    expect.arrayContaining([expect.objectContaining({ type: "thinking" })]),
  );
  expect(anthropicAssistantMessage).not.toHaveProperty("reasoning");
  expect(JSON.stringify(text).trim()).toBeTruthy();
  expect(text).toContainEqual({ type: "text", text: "OK" });
});
it("retains real Anthropic reasoning history before a later native Anthropic request", async () => {
  const firstUserMessage = user("What is 17 * 29? Reply with one sentence.") as Message;
  const client = new Anthropic({
    apiKey: "recording-key",
    maxRetries: 0,
    fetch: async () =>
      new Response(JSON.stringify(nativeFirst), {
        headers: { "content-type": "application/json" },
      }),
  });
  const firstResult = await client.messages.create({
    model: anthropicModel.id,
    max_tokens: 1200,
    thinking: { type: "enabled", budget_tokens: 1024 },
    messages: [{ role: "user", content: "What is 17 * 29? Reply with one sentence." }],
  });
  const content = firstResult.content.flatMap((p): AssistantMessage["content"] =>
    p.type === "thinking"
      ? [{ type: "thinking" as const, thinking: p.thinking, thinkingSignature: p.signature }]
      : p.type === "text"
        ? [{ type: "text" as const, text: p.text }]
        : [],
  );
  const assistantMessage = {
    ...makeAssistantMessage(content),
    api: anthropicModel.api,
    provider: anthropicModel.provider,
    model: anthropicModel.id,
  };
  expect(assistantMessage).toBeDefined();
  expect(JSON.stringify(content)).toContain("thinking");
  expect(assistantMessage.provider).toBe("anthropic");
  const { request, text } = await replayLaterRequest(
    [firstUserMessage, assistantMessage],
    nativeReply,
    true,
  );
  const retained = request?.messages.find((m) => m.role === "assistant");
  const firstText = firstResult.content.find((p) => p.type === "text");
  expect(retained?.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "thinking" }),
      expect.objectContaining({ type: "text", text: firstText?.text }),
    ]),
  );
  expect(retained?.content).toContainEqual(nativeFirst.content[0]);
  expect(JSON.stringify(text).trim()).toBeTruthy();
  expect(text).toContainEqual({ type: "text", text: "OK" });
});
