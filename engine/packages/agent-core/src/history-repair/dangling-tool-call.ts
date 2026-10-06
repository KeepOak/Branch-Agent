// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/dangling_tool_call_middleware.py (atlas AGENT-LOOP-0092). Converted to strict TypeScript; message adapter is in provider-history.ts.
import { isDeepStrictEqual } from "node:util";
export type Call = Record<string, unknown>;
export interface ReplayMessage {
  type: string;
  content: unknown;
  tool_calls?: Call[];
  invalid_tool_calls?: Call[];
  additional_kwargs?: Record<string, unknown>;
  response_metadata?: Record<string, unknown>;
  tool_call_id?: unknown;
  name?: unknown;
  status?: string;
}
export function record(value: unknown): Call | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Call : undefined;
}
const valid = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const normalName = (name: unknown): string => valid(name) ? name.trim() : "unknown_tool";
function parseObject(value: unknown): Call | undefined {
  if (typeof value !== "string") return undefined;
  try { return record(JSON.parse(value)); } catch { return undefined; }
}
function pythonJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(", ")}]`;
  if (record(value)) return `{${Object.entries(value as Call).map(([key, v]) => `${JSON.stringify(key)}: ${pythonJson(v)}`).join(", ")}}`;
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("non-finite JSON");
  const result = JSON.stringify(value); if (result === undefined) throw new Error("unserializable JSON"); return result;
}
function normalArgs(value: unknown): string {
  if (record(value)) { try { return pythonJson(value); } catch { return "{}"; } }
  return parseObject(value) ? value as string : "{}";
}
function rawCalls(msg: ReplayMessage): Call[] {
  const value = msg.additional_kwargs?.tool_calls;
  return Array.isArray(value) ? value.filter((v): v is Call => !!record(v)) : [];
}
export function messageToolCalls(msg: ReplayMessage): Call[] {
  const structured = msg.tool_calls ?? []; const invalid = msg.invalid_tool_calls ?? [];
  const calls: Call[] = structured.map(c => ({ ...c, name: normalName(c.name), ...(!valid(c.name) ? { invalid_tool_name: true } : {}) }));
  if (!structured.length && !invalid.length) {
    for (const c of rawCalls(msg)) {
      const fn = record(c.function); const name = c.name || fn?.name;
      const args = c.args && Object.keys(record(c.args) ?? {}).length ? c.args : parseObject(fn?.arguments) ?? c.args ?? {};
      calls.push({ id: c.id, name: normalName(name), args: record(args) ?? {}, ...(!valid(name) ? { invalid_tool_name: true } : {}) });
    }
  }
  for (const c of invalid) calls.push({ id: c.id, name: normalName(c.name), args: {}, invalid: true, error: c.error, ...(!valid(c.name) ? { invalid_tool_name: true } : {}) });
  return calls;
}
function sanitized(msg: ReplayMessage): ReplayMessage {
  if (msg.type !== "ai") return msg;
  const out = { ...msg };
  if (msg.tool_calls?.length) out.tool_calls = msg.tool_calls.map(c => ({ ...c, name: normalName(c.name) }));
  if (msg.invalid_tool_calls?.length) out.invalid_tool_calls = msg.invalid_tool_calls.map(c => ({ ...c, name: normalName(c.name), args: normalArgs(c.args) }));
  if (Array.isArray(msg.additional_kwargs?.tool_calls)) {
    out.additional_kwargs = { ...msg.additional_kwargs, tool_calls: rawCalls(msg).map(c => {
      const fn = record(c.function);
      return fn ? { ...c, function: { ...fn, name: normalName(fn.name), arguments: normalArgs(fn.arguments) } } : { ...c, name: normalName(c.name) };
    }) };
  }
  return isDeepStrictEqual(out, msg) ? msg : out;
}
interface Claim { original: unknown; synthetic: string; name: unknown }
function relabel(calls: Call[], index: number, source: string): { calls: Call[]; claims: Claim[] } {
  const claims: Claim[] = [];
  return { claims, calls: calls.map((c, position) => {
    if (valid(c.id)) return c;
    const synthetic = `deerflow_synthetic_tool_call_${index}_${source}_${position}`;
    claims.push({ original: c.id ?? null, synthetic, name: valid(c.name) ? c.name : record(c.function)?.name ?? c.name });
    return { ...c, id: synthetic };
  }) };
}
function malformedResultCount(messages: ReplayMessage[], index: number): number {
  let count = 0;
  for (const msg of messages.slice(index + 1)) { if (msg.type === "ai") break; if (msg.type === "tool" && !valid(msg.tool_call_id)) count++; }
  return count;
}
function normalizeToolCallIds(messages: ReplayMessage[]): ReplayMessage[] {
  let open: Claim[] = []; let positional = false;
  return messages.map((msg, index) => {
    if (msg.type === "ai") {
      const calls = relabel(msg.tool_calls ?? [], index, "call");
      const invalid = relabel(msg.invalid_tool_calls ?? [], index, "invalid");
      open = [...calls.claims, ...invalid.claims];
      const out = { ...msg };
      if (calls.claims.length) out.tool_calls = calls.calls;
      if (invalid.claims.length) out.invalid_tool_calls = invalid.calls;
      if (!msg.tool_calls?.length && !msg.invalid_tool_calls?.length && Array.isArray(msg.additional_kwargs?.tool_calls)) {
        const raw = relabel(rawCalls(msg), index, "raw"); open.push(...raw.claims);
        if (raw.claims.length) out.additional_kwargs = { ...msg.additional_kwargs, tool_calls: raw.calls };
      }
      positional = malformedResultCount(messages, index) === open.length;
      return isDeepStrictEqual(out, msg) ? msg : out;
    }
    if (msg.type !== "tool" || valid(msg.tool_call_id)) return msg;
    const compatible = open.map((c, i) => ({ c, i })).filter(({ c }) => c.original === (msg.tool_call_id ?? null) && (!valid(c.name) || !valid(msg.name) || c.name.trim() === msg.name.trim()));
    if (!compatible.length || (compatible.length > 1 && !positional)) return msg;
    const claimed = open.splice(compatible[0].i, 1)[0];
    return { ...msg, tool_call_id: claimed.synthetic };
  });
}
export function syntheticContent(call: Call): string {
  if (call.invalid_tool_name) return "[Tool call could not be executed because its name was missing or empty. Use one of the available tool names when retrying.]";
  if (call.invalid) {
    const error = typeof call.error === "string" && call.error ? call.error.slice(0, 500) : "";
    if (call.name === "write_file") {
      const details = error ? ` Parser error: ${error}` : "";
      return "[write_file failed before execution: the tool-call arguments were not valid JSON, " +
        "so no file was written. This often happens when the model tries to write a very " +
        "large Markdown file in a single tool call, especially when `content` contains " +
        "unescaped quotes, inline JSON, backslashes, or code fences. Do not retry the same " +
        "large `write_file` payload for this artifact; provide the report/content directly " +
        "as normal assistant text in your next response. If a file write is still needed " +
        `later, split the file into smaller sections instead of one large payload.${details}]`;
    }
    return error ? `[Tool call could not be executed because its arguments were invalid: ${error}]` : "[Tool call could not be executed because its arguments were invalid.]";
  }
  return "[Tool call was interrupted and did not return a result.]";
}
export function buildPatchedMessages(messages: ReplayMessage[]): ReplayMessage[] | null {
  const normalized = normalizeToolCallIds(messages);
  const results = new Map<unknown, ReplayMessage[]>(); const ids = new Set<unknown>();
  for (const msg of normalized) {
    if (msg.type === "tool") { const queue = results.get(msg.tool_call_id) ?? []; queue.push(msg); results.set(msg.tool_call_id, queue); }
    if (msg.type === "ai") for (const call of messageToolCalls(msg)) if (call.id) ids.add(call.id);
  }
  const patched: ReplayMessage[] = []; let dropped = false;
  for (const msg of normalized) {
    if (msg.type === "tool") { if (!ids.has(msg.tool_call_id)) dropped = true; continue; }
    patched.push(sanitized(msg)); if (msg.type !== "ai") continue;
    for (const call of messageToolCalls(msg)) {
      if (!call.id) continue;
      const existing = results.get(call.id)?.shift();
      if (existing) patched.push(call.invalid_tool_name && !valid(existing.name) ? { ...existing, name: call.name } : existing);
      else patched.push({ type: "tool", content: syntheticContent(call), tool_call_id: call.id, name: call.name, status: "error", additional_kwargs: {}, response_metadata: {} });
    }
  }
  return !dropped && isDeepStrictEqual(patched, messages) ? null : patched;
}
export function wrapModelCall<T, R extends { messages: ReplayMessage[]; override: (args: { messages: ReplayMessage[] }) => R }>(request: R, handler: (request: R) => T): T {
  const patched = buildPatchedMessages(request.messages);
  return handler(patched ? request.override({ messages: patched }) : request);
}
