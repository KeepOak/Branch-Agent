// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_tool_call_args.py (atlas AGENT-LOOP-0097). Provider serializer probes converted to Branch's real request builders and canonical toolCall surface.
import type { AssistantMessage, Model, Api } from "@branch/llm-core";
import { describe, expect, it } from "vitest";
import { convertMessages } from "../../packages/ai/src/openai-completions-messages.js";
import { buildAnthropicRequest } from "../../packages/ai/src/transports/anthropic-messages.js";
import { resolveOpenAICompletionsCompat } from "../../packages/ai/src/transports/openai-completions-compat.js";
import { buildOpenAIResponsesReasoningReplayMetadata } from "../../packages/ai/src/transports/openai-responses-compaction-replay.js";
import { convertResponsesMessages } from "../../packages/ai/src/transports/openai-responses-replay-messages-internal.js";
import { createFakeStream } from "./embedded-agent-runner/run/attempt-stream.test-helpers.js";
import { wrapStreamFnSanitizeMalformedToolCalls } from "./embedded-agent-runner/run/attempt-tool-call-replay-sanitization.js";
import { rewriteToolCallArgs, rewriteMessagesToolCallArgs } from "./historical-tool-call-args.js";
const ARGS = { path: "/mnt/user-data/outputs/report.md", content: "x".repeat(50) };
const NEW_ARGS = { ...ARGS, content: "[elided]" };
function model<T extends Api>(api: T): Model<T> {
  return {
    id: "fixture-model",
    name: "fixture",
    api,
    provider: api === "anthropic-messages" ? "anthropic" : "openai",
    baseUrl:
      api === "anthropic-messages" ? "https://api.anthropic.com" : "https://api.openai.com/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}
function message(api: Api = "openai-responses"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-1|fc_1", name: "write_file", arguments: ARGS }],
    api,
    provider: api === "anthropic-messages" ? "anthropic" : "openai",
    model: "fixture-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "toolUse",
    timestamp: 0,
  };
}
const rewritten = (m: AssistantMessage) =>
  rewriteToolCallArgs(m, new Map([["call-1|fc_1", NEW_ARGS]]));
function responses(m: AssistantMessage) {
  return convertResponsesMessages(
    model("openai-responses"),
    { messages: [m] },
    new Set(["openai"]),
  );
}
function functionCalls(m: AssistantMessage) {
  const items = responses(m);
  expect(JSON.stringify(items)).not.toContain(ARGS.content);
  return items.filter((item) => item.type === "function_call");
}
describe("TestProviderSerializers", () => {
  it.each([
    "test_responses_v1_content_sends_rewritten_arguments_once",
    "test_v1_content_sends_rewritten_arguments_once",
    "test_v0_responses_message_sends_rewritten_arguments_with_item_id",
  ])("%s", () => {
    const calls = functionCalls(rewritten(message()));
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].arguments)).toEqual(NEW_ARGS);
    expect(calls[0].call_id).toBe("call-1");
    expect(calls[0].id).toBe("fc_1");
  });
  it("test_unrewritten_responses_message_still_carries_payload", () => {
    expect(JSON.stringify(responses(message()))).toContain(ARGS.content);
  });
  it("test_chat_completions_payload_uses_rewritten_arguments", () => {
    const target = model("openai-completions");
    const payload = convertMessages(
      target,
      { messages: [rewritten(message(target.api))] },
      resolveOpenAICompletionsCompat(target),
    );
    const assistant = payload.find((m) => m.role === "assistant");
    expect(assistant?.tool_calls).toHaveLength(1);
    const tc = assistant?.tool_calls?.[0];
    expect(tc?.type).toBe("function");
    if (tc?.type !== "function") throw Error("missing function");
    expect(JSON.parse(tc.function.arguments)).toEqual(NEW_ARGS);
    expect(JSON.stringify(payload)).not.toContain(ARGS.content);
  });
  it.each([
    "test_anthropic_native_tool_use_payload_uses_rewritten_input",
    "test_anthropic_v1_content_payload_uses_rewritten_input",
  ])("%s", async () => {
    const target = model("anthropic-messages");
    const payload = await buildAnthropicRequest(
      target,
      { messages: [rewritten(message(target.api))] },
      undefined,
      "provider",
      false,
      false,
    );
    const content = payload.params.messages[0].content;
    if (!Array.isArray(content)) throw Error("missing content");
    const calls = content.filter((b) => b.type === "tool_use");
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toEqual(NEW_ARGS);
    expect(JSON.stringify(payload)).not.toContain(ARGS.content);
  });
});
it("the production replay wrapper synchronizes every mirror before a provider sees it", () => {
  const m = message();
  m.content[0] = { type: "toolCall", id: "call-1|fc_1", name: "write_file", arguments: NEW_ARGS };
  const mirrored = {
    ...m,
    tool_calls: [{ id: "call-1|fc_1", name: "write_file", args: ARGS }],
    additional_kwargs: {
      tool_calls: [
        { id: "call-1|fc_1", function: { name: "write_file", arguments: JSON.stringify(ARGS) } },
      ],
    },
  };
  let seen: unknown;
  const wrapped = wrapStreamFnSanitizeMalformedToolCalls((_m, c) => {
    seen = c.messages;
    return createFakeStream({ events: [], resultMessage: m }) as ReturnType<
      import("./runtime/index.js").StreamFn
    >;
  });
  wrapped(model("openai-responses"), { messages: [mirrored] });
  expect(JSON.stringify(seen)).not.toContain(ARGS.content);
  expect(JSON.stringify(mirrored)).toContain(ARGS.content);
});
it("test_rewritten_history_is_replayed_with_rewritten_arguments", () => {
  const m = {
    ...message(),
    response_metadata: { id: "resp_b" },
    providerReplay: { type: "openai-responses-retained-compaction", encryptedContent: "stale" },
  };
  const tool = {
    role: "toolResult" as const,
    toolCallId: "call-1|fc_1",
    toolName: "write_file",
    content: [{ type: "text" as const, text: "ok" }],
    isError: false,
    timestamp: 1,
  };
  const history = [m, tool];
  const n = rewriteMessagesToolCallArgs(history, () => NEW_ARGS)!;
  expect(n[1]).toBe(tool);
  expect(n[0]).not.toHaveProperty("response_metadata.id");
  expect(n[0]).toHaveProperty("providerReplay", undefined);
  const input = convertResponsesMessages(
    model("openai-responses"),
    { messages: n as (AssistantMessage | typeof tool)[] },
    new Set(["openai"]),
  );
  expect(input.filter((i) => i.type === "function_call")).toHaveLength(1);
  expect(input.some((i) => i.type === "function_call_output")).toBe(true);
  expect(JSON.stringify(input)).not.toContain(ARGS.content);
});

it("test_unrewritten_history_chains_and_never_sends_the_call", () => {
  const target = model("openai-responses"),
    identity = { sessionId: "session-a", authProfileId: "profile-a" };
  const metadata = buildOpenAIResponsesReasoningReplayMetadata(target, identity);
  const m = message();
  m.content.push({ type: "text", text: "checkpoint tail" });
  m.providerReplay = {
    v: 1,
    type: "openai-responses-compaction",
    id: "cmp_1",
    data: "opaque-original-history",
    replayIndex: 1,
    provider: metadata.provider,
    api: metadata.api,
    model: metadata.model,
    baseUrlHash: metadata.baseUrlHash!,
    sessionHash: metadata.sessionHash,
    authProfileHash: metadata.authProfileHash,
  };
  const tool = {
    role: "toolResult" as const,
    toolCallId: "call-1|fc_1",
    toolName: "write_file",
    content: [{ type: "text" as const, text: "blocked" }],
    isError: true,
    timestamp: 1,
  };
  const input = convertResponsesMessages(
    target,
    { messages: [m, tool] },
    new Set(["openai"]),
    identity,
  );
  expect(input.some((i) => i.type === "compaction")).toBe(true);
  expect(input.filter((i) => i.type === "function_call")).toHaveLength(0);
  expect(input.filter((i) => i.type === "function_call_output")).toHaveLength(1);
});
