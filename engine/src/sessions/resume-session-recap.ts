/** NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2
 * hermes_cli/session_recap.py: deterministic local recap port, no model calls. */
import path from "node:path";
import { homedir } from "node:os";
import { stripVTControlCharacters } from "node:util";

type Message = Record<string, unknown>;
type ToolCall = { name: string; args: Message };
const FILE_TOOLS: Record<string, string> = {
  write_file: "path", patch: "path", read_file: "path", skill_manage: "file_path", skill_view: "file_path",
  // Native Branch names retain the source tool semantics.
  write: "path", edit: "path", read: "path",
};
function record(value: unknown): Message | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Message : undefined;
}
function coerceText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return String(value);
  return value.flatMap((part) => {
    const text = typeof part === "string" ? part : record(part)?.text;
    return typeof text === "string" ? [text] : [];
  }).join("\n");
}
function toolCall(value: unknown): ToolCall | undefined {
  const fn = record(record(value)?.function);
  if (!fn?.name) return undefined;
  let args = fn.arguments;
  if (typeof args === "string" && args) {
    try { args = JSON.parse(args); } catch { args = {}; }
  }
  return { name: String(fn.name), args: record(args) ?? {} };
}
function visibleCounts(messages: readonly Message[]): [number, number, number] {
  const count = (role: string) => messages.filter((message) => message.role === role).length;
  return [count("user"), count("assistant"), count("tool")];
}
function recentWindow(messages: readonly Message[]): readonly Message[] {
  let count = 0;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (["user", "assistant"].includes(String(messages[index].role)) && ++count >= 20) return messages.slice(index);
  }
  return messages;
}
function shortenedPath(value: string): string {
  const home = homedir();
  const absolute = path.resolve(value === "~" ? home : value.startsWith("~/") ? path.join(home, value.slice(2)) : value);
  if (absolute === process.cwd()) return ".";
  const local = path.relative(process.cwd(), absolute);
  if (local && !local.startsWith(`..${path.sep}`) && local !== ".." && !path.isAbsolute(local)) return local;
  const fromHome = path.relative(home, absolute);
  return fromHome && !fromHome.startsWith(`..${path.sep}`) && fromHome !== ".." && !path.isAbsolute(fromHome)
    ? `~/${fromHome}` : absolute;
}
function toolActivity(messages: readonly Message[]) {
  const calls = messages.filter((message) => message.role === "assistant").flatMap((message) =>
    Array.isArray(message.tool_calls) ? message.tool_calls.flatMap((value): ToolCall[] => {
      const call = toolCall(value); return call ? [call] : [];
    }) : []);
  const counts = new Map<string, number>(); const files = new Map<string, string>();
  for (const { name, args } of calls.toReversed()) {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    const filename = args[FILE_TOOLS[name]];
    if (typeof filename === "string" && filename && !files.has(filename)) files.set(filename, shortenedPath(filename));
  }
  return { counts: [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b)), files: [...files.values()] };
}
function cleanPreview(value: string, limit: number): string {
  const text = stripVTControlCharacters(value).replace(/\p{Cc}/gu, " ").split(/\s+/).filter(Boolean).join(" ");
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}
function capped(items: string[]): string {
  return items.slice(0, 5).join(", ") + (items.length > 5 ? ` (+${items.length - 5} more)` : "");
}
function recentDescription(messages: readonly Message[], window: readonly Message[]): string {
  const [users, assistants, tools] = visibleCounts(messages);
  const [recentUsers, recentAssistants] = visibleCounts(window);
  let scope = `${recentUsers} user turn${recentUsers === 1 ? "" : "s"} / ${recentAssistants} assistant repl${recentAssistants === 1 ? "y" : "ies"}`;
  if (users !== recentUsers || assistants !== recentAssistants) scope += ` (of ${users}/${assistants} total)`;
  return `  Recent: ${scope}, ${tools} tool result${tools === 1 ? "" : "s"}`;
}

export function buildSessionRecap(messages: readonly Message[],
  options: { title?: string; sessionId?: string } = {}): string {
  const suffix = options.title || options.sessionId?.slice(0, 8);
  const lines = [`Session recap${suffix ? ` — ${cleanPreview(suffix, Number.MAX_SAFE_INTEGER)}` : ""}`];
  if (!messages.length) return `${lines[0]}\n  (nothing to recap — no messages yet)`;
  const window = recentWindow(messages); lines.push(recentDescription(messages, window));
  const activity = toolActivity(window);
  if (activity.counts.length) lines.push(`  Tools used: ${capped(activity.counts.map(([name, count]) => `${cleanPreview(name, 200)}×${count}`))}`);
  if (activity.files.length) lines.push(`  Files touched: ${capped(activity.files.map((filename) => cleanPreview(filename, 500)))}`);
  for (const [role, label, limit] of [["user", "Last ask", 140], ["assistant", "Last reply", 200]] as const) {
    const content = window.toReversed().filter((message) => message.role === role)
      .map((message) => coerceText(message.content).trim()).find(Boolean);
    if (content) lines.push(`  ${label}: ${cleanPreview(content, limit)}`);
  }
  if (lines.length === 2) lines.push("  (no assistant activity yet in this window)");
  return lines.join("\n");
}

/** Native toolCall parts become the source function/arguments dialect in memory only. */
export function nativeRecapMessages(events: readonly unknown[]): Message[] {
  return events.flatMap((event): Message[] => {
    const message = record(record(event)?.message);
    if (!message || message.display === false) return [];
    const parts = Array.isArray(message.content) ? message.content : [];
    const tool_calls = parts.flatMap((part) => {
      const value = record(part);
      return value?.type === "toolCall" ? [{ function: { name: value.name, arguments: value.arguments } }] : [];
    });
    return [{ ...message, role: message.role === "toolResult" ? "tool" : message.role,
      ...(tool_calls.length ? { tool_calls } : {}) }];
  });
}
