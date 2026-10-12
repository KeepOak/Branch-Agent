// From aaif-goose/goose@bab8ff641039c9cd3331121cd84a5c6045f365ca:crates/goose-context-management/src/summarize.rs (atlas AGENT-LOOP-0100). Both source tests ported; successful middle-out retry and cancellation assertions added.
import { expect, it, vi } from "vitest";
import type { AgentMessage } from "./runtime/index.js";
import {
  filterSummaryToolResponses,
  summarizeWithToolResponseRemoval,
  SUMMARY_REMOVAL_PERCENTAGES,
} from "./structured-summary-retry.js";
const user: AgentMessage = { role: "user", content: "oversized conversation", timestamp: 0 };
const tool: AgentMessage = {
  role: "toolResult",
  toolCallId: "tool_0",
  toolName: "read",
  content: [{ type: "text", text: "contents" }],
  isError: false,
  timestamp: 1,
};
it("summarize_without_tool_responses_fails_fast", async () => {
  const complete = vi.fn().mockRejectedValue(Error("context length exceeded"));
  const error = await summarizeWithToolResponseRemoval([user], complete).catch((e) => e as Error);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(String(error)).toContain("there are no tool responses to remove");
  expect(String(error)).not.toContain("even after removing all tool responses");
  for (const text of ["larger usable context", "disable some extensions", "start a new session"])
    expect(String(error)).toContain(text);
});
it("summarize_with_tool_responses_preserves_exhausted_removal_error", async () => {
  const complete = vi.fn().mockRejectedValue(Error("context length exceeded"));
  await expect(summarizeWithToolResponseRemoval([user, tool], complete)).rejects.toThrow(
    "Failed to compact: context limit exceeded even after removing all tool responses",
  );
  expect(complete).toHaveBeenCalledTimes(SUMMARY_REMOVAL_PERCENTAGES.length);
});
it("removes middle tool results and succeeds without changing source history", async () => {
  const messages = [
    user,
    tool,
    { ...tool, toolCallId: "tool_1" },
    { ...tool, toolCallId: "tool_2" },
    { ...tool, toolCallId: "tool_3" },
  ];
  const calls: AgentMessage[][] = [];
  const summary = await summarizeWithToolResponseRemoval(messages, async (input) => {
    calls.push(input);
    if (calls.length === 1) throw Error("context length exceeded");
    return "structured summary";
  });
  expect(summary).toBe("structured summary");
  expect(calls[0]).toBe(messages);
  expect(calls[1].map((m) => (m.role === "toolResult" ? m.toolCallId : "user"))).toEqual([
    "user",
    "tool_0",
    "tool_2",
    "tool_3",
  ]);
  expect(messages).toHaveLength(5);
  expect(filterSummaryToolResponses(messages, 100)).toEqual([user]);
});
it("does not retry cancellation or non-overflow errors", async () => {
  const complete = vi.fn().mockRejectedValue(Error("caller aborted"));
  await expect(summarizeWithToolResponseRemoval([user, tool], complete)).rejects.toThrow(
    "caller aborted",
  );
  expect(complete).toHaveBeenCalledTimes(1);
});
