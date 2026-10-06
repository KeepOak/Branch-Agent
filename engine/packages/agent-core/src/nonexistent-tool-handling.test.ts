// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/agent/test_nonexistent_tool_handling.py (atlas AGENT-LOOP-0089). Converted to Vitest using Branch agent events.
import { expect, it } from "vitest";
import { captureAgentLoop, config, createTurnSequenceStream, makeCall, makeTool, user } from "./agent-loop.test-support.js";
import type { Message } from "./llm.js";

async function missing(name: string) {
  const requests: Message[][] = [];
  const run = captureAgentLoop([user()], { systemPrompt: "", messages: [], tools: [makeTool("finish"), makeTool("think")] }, config, undefined,
    createTurnSequenceStream([[makeCall(name, "call_1")], [{ type: "text", text: "Task completed." }]], requests));
  const messages = await run.result;
  const errors = messages.filter((m) => m.role === "toolResult" && m.isError);
  expect(errors).toHaveLength(1);
  const error = errors[0];
  expect(error).toMatchObject({ role: "toolResult", toolCallId: "call_1", toolName: name, isError: true });
  const text = error?.role === "toolResult" ? error.content.map(c => c.type === "text" ? c.text : "").join("") : "";
  return { run, messages, requests, text };
}
it("test_nonexistent_tool_returns_error_and_continues_conversation", async () => {
  const { requests, text } = await missing("nonexistent_tool");
  expect(text).toContain("nonexistent_tool"); expect(text).toContain("not found");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toContainEqual(expect.objectContaining({ role: "toolResult", toolCallId: "call_1" }));
});
it("test_nonexistent_tool_error_includes_available_tools", async () => {
  const { text } = await missing("missing_tool");
  for (const word of ["missing_tool", "not found", "Available:", "finish", "think"]) expect(text).toContain(word);
});
it("test_conversation_continues_after_tool_error", async () => {
  const executed: string[] = []; const requests: Message[][] = [];
  const run = captureAgentLoop([user()], { systemPrompt: "", messages: [], tools: [makeTool("finish", executed)] }, config, undefined,
    createTurnSequenceStream([[makeCall("bad_tool", "call_1")], [makeCall("finish", "finish-call-1")], [{ type: "text", text: "Task completed." }]], requests));
  const messages = await run.result;
  expect(messages.filter(m => m.role === "toolResult" && m.isError)).toHaveLength(1);
  expect(executed).toEqual(["finish"]);
  expect(run.events.filter(e => e.type === "tool_execution_start" && e.toolName === "finish")).toHaveLength(1);
  expect(messages.at(-1)).toMatchObject({ role: "assistant", stopReason: "stop" });
  expect(requests).toHaveLength(3);
});
