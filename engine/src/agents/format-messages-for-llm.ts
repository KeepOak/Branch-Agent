// Ported from google-gemini/gemini-cli packages/core/src/context/utils/formatNodesForLlm.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
// Adapted from context-graph nodes to agent transcript messages.
import type { AgentMessage } from "./runtime/index.js";

export interface FormatMessagesOptions {
  /**
   * The maximum number of characters to retain from a tool response.
   * Tool responses larger than this will be truncated to preserve LLM attention span
   * and avoid context limits during summarization operations.
   * Defaults to 2000.
   */
  maxToolResponseChars?: number;
}

/**
 * Maps common tool names to semantic wrappers that improve LLM reading comprehension.
 */
function getSemanticToolWrapper(toolName: string): string {
  if (toolName.includes("search") || toolName.includes("grep")) {
    return `SEARCH RESULTS`;
  }
  if (toolName.includes("list") || toolName.includes("dir")) {
    return `WORKSPACE STRUCTURE`;
  }
  // "exec" is this engine's shell tool name.
  if (toolName.includes("shell") || toolName.includes("cmd") || toolName.includes("exec")) {
    return `SHELL EXECUTION`;
  }
  if (toolName.includes("read") || toolName.includes("fetch")) {
    return `FILE/WEB CONTENT`;
  }
  return `TOOL RESPONSE`;
}

type Block = { type?: unknown; text?: unknown; name?: unknown; arguments?: unknown };

function blocksOf(message: AgentMessage): Block[] {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return Array.isArray(content) ? (content as Block[]) : [];
}

function textOf(blocks: Block[]): string {
  return blocks
    .map((block) => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function truncateMiddle(raw: string, maxChars: number): string {
  if (raw.length <= maxChars) {
    return raw;
  }
  const half = Math.floor(maxChars / 2);
  const truncatedCount = raw.length - maxChars;
  return `${raw.substring(0, half)}... [TRUNCATED ${truncatedCount} chars] ...${raw.substring(raw.length - half)}`;
}

function formatMessageLines(message: AgentMessage, maxToolChars: number): string[] {
  const role = (message as { role?: unknown }).role;
  if (role === "toolResult") {
    const toolName = String((message as { toolName?: unknown }).toolName ?? "unknown_tool");
    const raw = JSON.stringify(textOf(blocksOf(message)));
    return [
      `[TOOL] [TOOL_EXECUTION]: [${getSemanticToolWrapper(toolName)} (${toolName})]: ${truncateMiddle(raw, maxToolChars)}`,
    ];
  }
  if (role === "user") {
    return [`[USER] [USER_PROMPT]: ${textOf(blocksOf(message))}`];
  }
  if (role === "assistant") {
    const lines: string[] = [];
    for (const block of blocksOf(message)) {
      if (block.type === "text" && typeof block.text === "string" && block.text) {
        lines.push(`[MODEL] [AGENT_THOUGHT]: ${block.text}`);
      } else if (block.type === "toolCall") {
        lines.push(
          `[MODEL] [TOOL_EXECUTION]: CALL: ${String(block.name)}(${JSON.stringify(block.arguments)})`,
        );
      }
    }
    return lines;
  }
  // Fallback for unexpected message shapes
  return [`[SYSTEM] [${String(role)}]: ${JSON.stringify(message)}`];
}

/**
 * Formats a sequence of transcript messages into a dense, human/LLM-readable
 * text transcript. Used by summarization side calls to serialize the history
 * before passing it to an LLM.
 */
export function formatMessagesForLlm(
  messages: readonly AgentMessage[],
  options: FormatMessagesOptions = {},
): string {
  const maxToolChars = options.maxToolResponseChars ?? 2000;
  // A user prompt opens a turn; turns are labelled relative to the latest (e.g. -2, -1, 0).
  const turnOf: number[] = [];
  let turn = -1;
  for (const message of messages) {
    if ((message as { role?: unknown }).role === "user" || turn < 0) {
      turn += 1;
    }
    turnOf.push(turn);
  }
  let transcript = "";
  messages.forEach((message, index) => {
    const turnMarker = `[Turn ${(turnOf[index] ?? 0) - turn}] `;
    for (const line of formatMessageLines(message, maxToolChars)) {
      transcript += `${turnMarker}${line}\n`;
    }
  });
  return transcript;
}
