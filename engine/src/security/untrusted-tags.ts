// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/input_sanitization_middleware.py (atlas SAFETY-0055)
import { escapeRegExp } from "../shared/regexp.js";

/**
 * Neutralize framework and injection control tags in untrusted text.
 *
 * Blocked tags are HTML-escaped (`<system>` becomes `&lt;system&gt;`) instead of
 * rejected, so the text stays readable while losing its structural meaning.
 * Normal HTML/XML tags such as `<div>` are left alone.
 */

/** Finite set of blocked tag names: system-reserved plus common injection patterns. */
export const BLOCKED_TAG_NAMES: ReadonlySet<string> = new Set([
  "system-reminder",
  "system_reminder",
  "memory",
  "current_date",
  "think",
  "analysis",
  "role",
  "soul",
  "self_update",
  "thinking_style",
  "clarification_system",
  "critical_reminders",
  "response_style",
  "citations",
  "current_uploads",
  "subagent_system",
  "skill_system",
  "skill_index",
  "available_skills",
  "disabled_skills",
  "memory_tool_system",
  "todo_list_system",
  "durable_context_data",
  "slash_skill_activation",
  "mcp_routing_hints",
  "available-deferred-tools",
  "goal_continuation",
  "active_goal",
  "background_task_event",
  "file_editing_workflow",
  "guidelines",
  "output_format",
  "working_directory",
  "tool_restrictions",
  "report_contract",
  "acceptance_criteria",
  "project",
  "documents",
  "system",
  "instruction",
  "important",
  "override",
  "ignore",
  "prompt",
]);

// Matches a full blocked tag: <tag>, </tag>, <tag attrs>, <tag/>, bare <tag
const BLOCKED_TAG_PATTERN = new RegExp(
  `<\\s*/?\\s*(?:${[...BLOCKED_TAG_NAMES].toSorted().map(escapeRegExp).join("|")})\\b[^>]*>?`,
  "gi",
);

/** Plain-text user-input boundary markers (OWASP structured-prompt guidance). */
export const USER_INPUT_BEGIN = "--- BEGIN USER INPUT ---";
export const USER_INPUT_END = "--- END USER INPUT ---";

// Inert look-alikes used when untrusted text already contains a boundary marker.
const NEUTRALIZED_BEGIN = "[BEGIN USER INPUT]";
const NEUTRALIZED_END = "[END USER INPUT]";

const BOUNDARY_TOKEN_PATTERN = new RegExp(
  `${escapeRegExp(USER_INPUT_BEGIN)}|${escapeRegExp(USER_INPUT_END)}`,
  "g",
);

function escapeTagMatch(match: string): string {
  return match.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function neutralizeBoundaryTokens(text: string): string {
  return text.replace(BOUNDARY_TOKEN_PATTERN, (token) =>
    token === USER_INPUT_BEGIN ? NEUTRALIZED_BEGIN : NEUTRALIZED_END,
  );
}

/**
 * Escape blocked framework/injection tags and neutralize user-input boundary
 * markers in untrusted text. Empty or whitespace-only text is returned unchanged.
 */
export function neutralizeUntrustedTags(text: string): string {
  if (!text.trim()) {
    return text;
  }
  return neutralizeBoundaryTokens(text.replace(BLOCKED_TAG_PATTERN, escapeTagMatch));
}
