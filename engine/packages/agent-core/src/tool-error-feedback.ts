// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/tool_error_handling_middleware.py (atlas AGENT-LOOP-0090). Converted to TypeScript; Branch delegation tool is sessions_spawn.
import type { AgentToolResult } from "./types.js";
const RECOVERY_HINT = "Continue with available context, or choose an alternative tool.";
const RULES: ReadonlyArray<readonly [readonly string[], string, boolean, string]> = [
  [["401", "403", "unauthorized", "authentication", "invalid api key"], "auth", false, "stop"],
  [["rate limit", "rate limited", "rate_limit"], "rate_limited", false, "summarize"],
  [["timeout", "timed out", "connection", "network error", "temporarily unavailable"], "transient", false, "try_alternative"],
  [["not configured", "not installed", "missing required", "disabled", "no api key"], "config", false, "stop"],
  [["permission denied", "access denied", "path traversal", "forbidden"], "permission", true, "try_alternative"],
  [["no results found", "no content found", "no images found", "no results"], "no_results", true, "rewrite_query"],
  [["not found", "no such file", "does not exist", "404"], "not_found", true, "rewrite_query"],
  [["unexpected error", "internal error", "500"], "internal", false, "stop"],
];
export function toolExceptionResult(name: string, error: unknown): AgentToolResult<unknown> {
  const kind = error instanceof Error ? error.name : "Error";
  let detail = (error instanceof Error ? error.message : String(error)).trim() || kind;
  if (detail.length > 500) detail = detail.slice(0, 497) + "...";
  const structured = `${kind}: ${detail}`;
  const lower = structured.toLowerCase();
  const rule = RULES.find(([keywords]) => keywords.some(word => /^\d+$/.test(word) ? new RegExp(`\\b${word}\\b`).test(lower) : lower.includes(word)));
  const details: Record<string, unknown> = {
    tool_meta: { status: "error", source: "exception", error_type: rule?.[1] ?? "unknown", recoverable_by_model: rule?.[2] ?? true, recommended_next_action: rule?.[3] ?? "try_alternative" },
  };
  let text = `Error: Tool '${name || "unknown_tool"}' failed with ${kind}: ${detail}. ${RECOVERY_HINT}`;
  if (name === "task" || name === "sessions_spawn") {
    text = `Task failed. Error: ${structured}`;
    if (!/[.!?]$/.test(text)) text += ".";
    text += ` ${RECOVERY_HINT}`;
    details.subagent_status = "failed"; details.subagent_error = structured;
  }
  return { content: [{ type: "text", text }], details };
}
