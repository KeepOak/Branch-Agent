// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/tool_call_metadata.py (atlas AGENT-LOOP-0092). Converted to TypeScript preserving all provider metadata surfaces.
import { record, type Call, type ReplayMessage } from "./dangling-tool-call.js";
const ID_KEYS: Record<string, string[]> = { tool_use: ["id"], function_call: ["call_id", "id"], custom_tool_call: ["call_id"], tool_call: ["id"], tool_call_chunk: ["id"] };
const callId = (call: Call): string | undefined => typeof call.id === "string" && call.id ? call.id : undefined;
export function syncContentToolCallBlocks(content: unknown, calls: Call[]): unknown {
  if (!Array.isArray(content)) return content;
  const retained = new Set(calls.map(callId).filter((id): id is string => !!id));
  const entries = content.map((block: unknown) => {
    const obj = record(block); const keys = typeof obj?.type === "string" ? ID_KEYS[obj.type] : undefined;
    const id = keys?.map(k => obj?.[k]).find((v): v is string => typeof v === "string" && !!v);
    return { block, tool: !!keys, id, name: obj?.name };
  });
  const matched = new Set(entries.map(e => e.id).filter((id): id is string => !!id && retained.has(id)));
  const budget = new Map<string, number>();
  for (const call of calls) if (typeof call.name === "string" && !matched.has(callId(call) ?? "")) budget.set(call.name, (budget.get(call.name) ?? 0) + 1);
  const synced = entries.filter(e => {
    if (!e.tool) return true;
    if (e.id) return retained.has(e.id);
    if (typeof e.name !== "string" || !(budget.get(e.name) ?? 0)) return false;
    budget.set(e.name, budget.get(e.name)! - 1); return true;
  }).map(e => e.block);
  return synced.length === content.length ? content : synced;
}
export function cloneAiMessageWithToolCalls(message: ReplayMessage, calls: Call[], content?: unknown): ReplayMessage {
  const ids = new Set(calls.map(callId).filter((id): id is string => !!id));
  const out = { ...message, tool_calls: calls };
  const synced = syncContentToolCallBlocks(content ?? message.content, [...calls, ...(message.invalid_tool_calls ?? [])]);
  if (content !== undefined || synced !== message.content) out.content = synced;
  const kwargs = { ...message.additional_kwargs };
  if (Array.isArray(kwargs.tool_calls)) {
    const raw = kwargs.tool_calls.filter(c => { const obj = record(c); return !!obj && ids.has(callId(obj) ?? ""); });
    if (raw.length) kwargs.tool_calls = raw; else delete kwargs.tool_calls;
  }
  if (!calls.length) delete kwargs.function_call;
  out.additional_kwargs = kwargs;
  const metadata = { ...message.response_metadata };
  if (!calls.length && metadata.finish_reason === "tool_calls") metadata.finish_reason = "stop";
  out.response_metadata = metadata;
  return out;
}
