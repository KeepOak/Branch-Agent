// Ported from QwenLM/qwen-code packages/core/src/services/toolUseSummary.ts at 728c13de219885de6a3e93223460c3ec8a8f690d.
/**
 * Tool Use Summary Generator
 *
 * Generates a short human-readable label (git-commit-subject style, ~30 chars)
 * describing what a batch of tool calls accomplished. Uses the utility (fast)
 * model so the call is cheap; runs in parallel with the next turn's model call
 * so its latency is hidden behind the main-model streaming.
 */

import { randomUUID } from "node:crypto";
import type { SideQuery } from "./agent-loop-side-query.js";

/**
 * Message emitted into the agent event stream after a tool batch completes
 * with a successful summary.
 */
export interface ToolUseSummaryMessage {
  type: "tool_use_summary";
  summary: string;
  /** Tool-use call IDs this summary describes. */
  precedingToolUseIds: string[];
  uuid: string;
  timestamp: string;
}

/**
 * Creates a `tool_use_summary` message. The UUID and timestamp are generated
 * here so the message is immediately serializable for recording/emission.
 */
export function createToolUseSummaryMessage(
  summary: string,
  precedingToolUseIds: string[],
): ToolUseSummaryMessage {
  return {
    type: "tool_use_summary",
    summary,
    precedingToolUseIds,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  };
}

export const TOOL_USE_SUMMARY_SYSTEM_PROMPT = `Write a short summary label describing what these tool calls accomplished. It appears as a single-line row in a mobile app and truncates around 30 characters, so think git-commit-subject, not sentence.

Keep the verb in past tense and the most distinctive noun. Drop articles, connectors, and long location context first.

Examples:
- Searched in auth/
- Fixed NPE in UserService
- Created signup endpoint
- Read config.json
- Ran failing tests`;

/** Max characters per input/output field fed to the summarizer. */
const INPUT_TRUNCATE_LENGTH = 300;
/** Max characters of the last assistant text included as user-intent prefix. */
const LAST_ASSISTANT_TEXT_LENGTH = 200;
/** Output length cap. Matches mobile UI truncation behavior. */
const MAX_SUMMARY_LENGTH = 100;
/** Upstream request budget for the label call. */
export const TOOL_USE_SUMMARY_MAX_TOKENS = 60;
export const TOOL_USE_SUMMARY_TEMPERATURE = 0.3;

export interface ToolInfo {
  name: string;
  input: unknown;
  output: unknown;
}

export interface GenerateToolUseSummaryParams {
  /** Utility-model side call; undefined when no fast model is configured. */
  sideQuery: SideQuery | undefined;
  tools: ToolInfo[];
  signal: AbortSignal;
  /**
   * Trailing text from the assistant's last message, used as intent prefix
   * so the summarizer knows what the user was trying to accomplish.
   */
  lastAssistantText?: string;
  onDebug?: (message: string) => void;
}

/**
 * Generates a short label for a completed tool batch.
 *
 * @returns The summary string, or null when skipped (no tools, no fast model,
 * aborted, or model failure). Non-critical: callers should not surface errors.
 */
export async function generateToolUseSummary(
  params: GenerateToolUseSummaryParams,
): Promise<string | null> {
  const { sideQuery, tools, signal, lastAssistantText } = params;
  const debug = params.onDebug ?? (() => {});

  if (tools.length === 0) {
    return null;
  }

  if (!sideQuery) {
    debug("No fast model configured — skipping summary generation");
    return null;
  }

  if (signal.aborted) {
    return null;
  }

  try {
    const toolSummaries = tools
      .map((tool) => {
        const inputStr = truncateJson(tool.input, INPUT_TRUNCATE_LENGTH);
        const outputStr = truncateJson(tool.output, INPUT_TRUNCATE_LENGTH);
        return `Tool: ${tool.name}\nInput: ${inputStr}\nOutput: ${outputStr}`;
      })
      .join("\n\n");

    const contextPrefix = lastAssistantText
      ? `User's intent (from assistant's last message): ${lastAssistantText.slice(0, LAST_ASSISTANT_TEXT_LENGTH)}\n\n`
      : "";

    const userPrompt = `${contextPrefix}Tools completed:\n\n${toolSummaries}\n\nLabel:`;

    const text = await sideQuery({
      systemPrompt: TOOL_USE_SUMMARY_SYSTEM_PROMPT,
      prompt: userPrompt,
      maxTokens: TOOL_USE_SUMMARY_MAX_TOKENS,
      temperature: TOOL_USE_SUMMARY_TEMPERATURE,
      signal,
    });

    if (signal.aborted) {
      return null;
    }

    if (!text) {
      debug("Summary generation returned empty result");
      return null;
    }

    const cleaned = cleanSummary(text);
    if (!cleaned) {
      debug(`Summary cleaned to empty: raw="${text}"`);
      return null;
    }

    debug(`Summary generated: "${cleaned}"`);
    return cleaned;
  } catch (err) {
    if (signal.aborted) {
      return null;
    }
    debug(`Summary generation failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Truncates a JSON value to a maximum length for the prompt.
 *
 * For large string inputs, pre-truncates BEFORE serialization to avoid
 * allocating the full JSON representation on the interactive turn path.
 * For object/array inputs, recursively pre-truncates string fields before
 * serialization.
 */
export function truncateJson(value: unknown, maxLength: number): string {
  try {
    const pre = preTruncate(value, maxLength);
    const str = JSON.stringify(pre) as string | undefined;
    if (str == null) {
      return "[undefined]";
    }
    return str.length <= maxLength ? str : str.slice(0, maxLength - 3) + "...";
  } catch {
    return "[unable to serialize]";
  }
}

/**
 * Walks an arbitrary value and pre-truncates string leaves that exceed
 * `maxLength`. Bounded to depth 4 to keep the cost predictable on deeply
 * nested objects.
 */
function preTruncate(value: unknown, maxLength: number, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }
  if (depth >= 4) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => preTruncate(v, maxLength, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = preTruncate(v, maxLength, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Character class covering ASCII and common Unicode quote / bracket-quote
 * pairs. Bounded quantifier keeps the regex linear.
 */
const QUOTE_CHARS = "\"'`‘’“”「」『』";
const LEADING_QUOTES_RE = new RegExp(`^[${QUOTE_CHARS}]{1,10}`);
const TRAILING_QUOTES_RE = new RegExp(`[${QUOTE_CHARS}]{1,10}$`);

/**
 * Error/refusal-like response markers the label should not produce. Covers
 * English and Chinese refusals common in mixed-provider deployments.
 */
const REFUSAL_PREFIXES = [
  /^api error\b/i,
  /^error[:：]/i,
  // Match "I can't" (ASCII apostrophe), "I can’t" (curly U+2019), and "I cannot".
  /^i can(?:['’]t|not)\b/i,
  /^unable to\b/i,
  /^failed to\b/i,
  /^sorry[,，]/i,
  /^request failed\b/i,
  /^我无法/,
  /^我不能/,
  /^抱歉[,，]?/,
  /^无法/,
];

/**
 * Strips markdown, quotes, and common prefix noise from the model's raw
 * response. Enforces `MAX_SUMMARY_LENGTH` as a hard cap. Returns empty string
 * if the result is unusable (error message, prefixed label, etc.).
 */
export function cleanSummary(raw: string): string {
  // Take first line only
  let text = raw.split("\n")[0]?.trim() ?? "";

  // Strip leading bullet/dash first so a bulleted quoted label loses both quotes.
  text = text.replace(/^[-*•]\s+/, "").trim();

  // Strip markdown emphasis (`**bold**`, `__bold__`, `_italic_`).
  text = text
    .replace(/^[*_]{1,3}/, "")
    .replace(/[*_]{1,3}$/, "")
    .trim();

  // Strip surrounding ASCII + Unicode quotes/backticks.
  text = text.replace(LEADING_QUOTES_RE, "").replace(TRAILING_QUOTES_RE, "").trim();

  // Strip common prefix labels like "Label:" "Summary:"
  text = text.replace(/^(label|summary|result|output)\s*[:：]\s*/i, "").trim();

  if (!text) {
    return "";
  }

  // Reject error/refusal-like responses (English + Chinese variants).
  for (const re of REFUSAL_PREFIXES) {
    if (re.test(text)) {
      return "";
    }
  }

  // Hard cap length
  if (text.length > MAX_SUMMARY_LENGTH) {
    text = text.slice(0, MAX_SUMMARY_LENGTH).trim();
  }

  return text;
}
