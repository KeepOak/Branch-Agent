// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/dangling_tool_call_middleware.py (atlas AGENT-LOOP-0092). Branch production message projection for the ported repair; preserves private result provenance and compaction replay ownership.
import { replaceCompactionReplayOwnerContent } from "@branch/ai/transports";
import type { Message, AssistantMessage, ToolResultMessage } from "@branch/llm-core";
import { copyInternalToolResultState } from "../internal-hooks.js";
import {
  buildPatchedMessages,
  record,
  type ReplayMessage,
} from "./dangling-tool-call.js";
import { cloneAiMessageWithToolCalls } from "./tool-call-metadata.js";
const SOURCE = Symbol("branch.history-repair.source");
type SourcedMessage = ReplayMessage & { [SOURCE]?: Message };
function project(message: Message): SourcedMessage {
  const base: SourcedMessage = { type: message.role, content: message.content, [SOURCE]: message };
  if (message.role === "assistant") {
    base.type = "ai";
    const calls = message.content
      .filter((c) => c.type === "toolCall")
      .map((c) => ({ id: c.id, name: c.name, args: c.arguments }));
    base.tool_calls = calls;
    base.invalid_tool_calls = [];
    base.additional_kwargs = {};
    base.response_metadata = {};
  } else if (message.role === "toolResult") {
    base.type = "tool";
    base.tool_call_id = message.toolCallId;
    base.name = message.toolName;
    base.status = message.isError ? "error" : "success";
  }
  return base;
}
function restoreAssistant(message: SourcedMessage, source: AssistantMessage): AssistantMessage {
  const calls = [...(message.tool_calls ?? []), ...(message.invalid_tool_calls ?? [])];
  let cursor = 0;
  const synced = cloneAiMessageWithToolCalls(message, message.tool_calls ?? []);
  const content = (
    Array.isArray(synced.content) ? synced.content : source.content
  ) as AssistantMessage["content"];
  return replaceCompactionReplayOwnerContent(
    source,
    content.map((block) => {
      if (block.type !== "toolCall") return block;
      const call = calls[cursor++];
      if (!call) return block;
      const id = String(call.id),
        name = String(call.name),
        args = record(call.args) ?? {};
      return id === block.id && name === block.name && args === block.arguments
        ? block
        : { ...block, id, name, arguments: args };
    }),
  );
}
function restore(message: SourcedMessage): Message {
  const source = message[SOURCE];
  if (source?.role === "assistant") return restoreAssistant(message, source);
  if (source?.role === "toolResult")
    return copyInternalToolResultState(source, {
      ...source,
      toolCallId: String(message.tool_call_id),
      toolName: String(message.name ?? source.toolName),
    });
  if (source) return source;
  const result: ToolResultMessage = {
    role: "toolResult",
    toolCallId: String(message.tool_call_id),
    toolName: String(message.name ?? "unknown_tool"),
    content: [{ type: "text", text: String(message.content) }],
    isError: true,
    timestamp: 0,
  };
  return result;
}
/** Repair the projected request only; persisted history and execution safety hooks retain ownership. */
export function repairProviderHistory(messages: Message[]): Message[] {
  const projected = messages.map(project);
  const patched = buildPatchedMessages(projected);
  return patched ? patched.map(restore) : messages;
}
