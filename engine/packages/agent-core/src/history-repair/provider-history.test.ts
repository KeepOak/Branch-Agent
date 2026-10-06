// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_tool_call_metadata.py (atlas AGENT-LOOP-0092). Native Branch provider request contracts plus per-call integration for dangling repair.
import { expect, it } from "vitest";
import { buildAnthropicRequest } from "../../../ai/src/transports/anthropic-messages.js";
import { convertResponsesMessages } from "../../../ai/src/transports/openai-responses-replay-messages-internal.js";
import { captureAgentLoop, config, createTurnSequenceStream, makeAssistantMessage, makeCall, model, user } from "../agent-loop.test-support.js";
import type { Message, Model, ToolResultMessage } from "@branch/llm-core";
import { repairProviderHistory } from "./provider-history.js";
const result = (id: string): ToolResultMessage => ({ role: "toolResult", toolCallId: id, toolName: "task", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 1 });
for (const oauth of [false, true]) for (const retained of [0, 2]) {
  it(`test_anthropic_request_pairs_every_tool_use_after_calls_are_${retained ? "truncated" : "cleared"}[${oauth ? "ClaudeChatModel" : "ChatAnthropic"}]`, async () => {
    const calls = Array.from({ length: retained }, (_, i) => makeCall("task", `toolu_${i}`));
    const messages: Message[] = [user("go") as Message, makeAssistantMessage([{ type: "text", text: "stopped" }, ...calls]), ...calls.map(c => result(c.id)), ...(retained ? [] : [user("continue") as Message])];
    const anthropicModel: Model<"anthropic-messages"> = { ...model, id: "claude-sonnet-4-5", api: "anthropic-messages", provider: "anthropic" };
    const { params } = await buildAnthropicRequest(anthropicModel, { messages }, undefined, "provider", oauth, false);
    const turns = params.messages.map(m => [m.role, (Array.isArray(m.content) ? m.content : []).flatMap(b => b.type === "tool_use" ? [b.id] : b.type === "tool_result" ? [b.tool_use_id] : [])]);
    expect(turns).toEqual(retained ? [["user", []], ["assistant", ["toolu_0", "toolu_1"]], ["user", ["toolu_0", "toolu_1"]]] : [["user", []], ["assistant", []], ["user", []]]);
  });
}
it("test_openai_responses_request_drops_function_call_after_calls_are_cleared", () => {
  const responseModel: Model<"openai-responses"> = { ...model, api: "openai-responses", provider: "openai" };
  const input = convertResponsesMessages(responseModel, { messages: [user("hi") as Message, makeAssistantMessage([{ type: "text", text: "stopped" }]), user("continue") as Message] });
  expect(input.filter(m => m.type === "function_call")).toEqual([]);
});
it("repairs the history before every model call without changing stored messages", async () => {
  const orphan = result("orphan"); const pending = makeAssistantMessage([makeCall("task", "pending")]);
  const original: Message[] = [orphan, user("hello") as Message, pending]; const before = structuredClone(original);
  const requests: Message[][] = [];
  const run = captureAgentLoop([user("continue")], { systemPrompt: "", messages: original }, config, undefined,
    createTurnSequenceStream([[makeCall("missing", "new")], [{ type: "text", text: "done" }]], requests));
  await run.result; expect(requests).toHaveLength(2); expect(original).toEqual(before);
  for (const request of requests) {
    expect(request.some(m => m.role === "toolResult" && m.toolCallId === "orphan")).toBe(false);
    expect(request).toContainEqual(expect.objectContaining({ role: "toolResult", toolCallId: "pending", isError: true }));
  }
  expect(requests[1]).toContainEqual(expect.objectContaining({ role: "toolResult", toolCallId: "new", isError: true }));
});
it("preserves valid history by reference", () => {
  const messages: Message[] = [makeAssistantMessage([makeCall("task", "a")]), result("a")];
  expect(repairProviderHistory(messages)).toBe(messages);
});
