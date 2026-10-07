// From NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:tests/agent/test_proactive_tool_result_pruning.py (atlas AGENT-LOOP-0102). Canonical Branch fixture adaptation.
import type { AgentMessage } from "./runtime/index.js";
import { makeAgentAssistantMessage } from "./test-helpers/agent-message-fixtures.js";
export function assistantCall(id: string): AgentMessage {
  return makeAgentAssistantMessage({
    content: [{ type: "toolCall", id, name: "terminal", arguments: { cmd: "ls" } }],
  });
}
export function toolMessage(id: string, content: string): AgentMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "terminal",
    content: [{ type: "text", text: content }],
    isError: false,
    timestamp: 1,
  };
}
export function buildHistory(pairs = 8, bigIndices = [0, 1, 2], bigChars = 9000): AgentMessage[] {
  return [
    { role: "user", content: "sys", timestamp: 0 },
    ...Array.from({ length: pairs }, (_, i) => [
      assistantCall(`call_${i}`),
      toolMessage(
        `call_${i}`,
        bigIndices.includes(i) ? String.fromCharCode(65 + (i % 26)).repeat(bigChars) : "ok",
      ),
    ]).flat(),
  ];
}
export function toolText(messages: AgentMessage[], id: string): string {
  const message = messages.find((m) => m.role === "toolResult" && m.toolCallId === id);
  if (message?.role !== "toolResult" || typeof message.content === "string")
    throw Error("Missing tool result");
  return message.content
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}
