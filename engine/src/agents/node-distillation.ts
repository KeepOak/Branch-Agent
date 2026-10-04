// Ported from google-gemini/gemini-cli packages/core/src/context/processors/nodeDistillationProcessor.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
// Adapted from context-graph nodes to agent transcript messages: user text
// blocks are USER_PROMPT nodes, assistant text blocks are AGENT_THOUGHT nodes
// and a tool result is a TOOL_EXECUTION node.
import type { SideQuery } from "./agent-loop-side-query.js";
import type { AgentMessage } from "./runtime/index.js";

/** Upstream context manager token estimate (initializer charsPerToken). */
export const CONTEXT_CHARS_PER_TOKEN = 3;

export interface NodeDistillationProcessorOptions {
  nodeThresholdTokens: number;
}

export interface ContextProcessorEnvironment {
  sideQuery: SideQuery;
  onWarn?: (message: string, error: unknown) => void;
}

export interface ContextProcessor {
  id: string;
  name: string;
  process: (args: { targets: readonly AgentMessage[] }) => Promise<AgentMessage[]>;
}

export function tokensToChars(tokens: number): number {
  return tokens * CONTEXT_CHARS_PER_TOKEN;
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CONTEXT_CHARS_PER_TOKEN);
}

type Block = { type?: unknown; text?: unknown };

function contentBlocks(message: AgentMessage): Block[] | undefined {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return Array.isArray(content) ? (content as Block[]) : undefined;
}

function isTextBlock(block: Block): block is { type: "text"; text: string } {
  return block.type === "text" && typeof block.text === "string";
}

export function createNodeDistillationProcessor(
  id: string,
  env: ContextProcessorEnvironment,
  options: NodeDistillationProcessorOptions,
): ContextProcessor {
  const generateSummary = async (text: string, contextInfo: string): Promise<string> => {
    try {
      const response = await env.sideQuery({
        systemPrompt: `You are an expert context compressor. Your job is to drastically shorten the following ${contextInfo} while preserving the absolute core semantic meaning, facts, and intent. Omit all conversational filler, pleasantries, or redundant information. Return ONLY the compressed summary.`,
        prompt: text,
      });
      return response || text;
    } catch (e: unknown) {
      env.onWarn?.(`NodeDistillationProcessor failed to summarize ${contextInfo}`, e);
      return text; // Fallback to original text on API failure
    }
  };

  /** USER_PROMPT / AGENT_THOUGHT: distill each oversized text part. */
  const distillTextParts = async (
    message: AgentMessage,
    nodeType: string,
    thresholdChars: number,
  ): Promise<AgentMessage> => {
    const blocks = contentBlocks(message);
    if (!blocks) {
      return message;
    }
    let changed = false;
    const next: Block[] = [];
    for (const block of blocks) {
      if (isTextBlock(block) && block.text.length > thresholdChars) {
        const summary = await generateSummary(block.text, nodeType);
        if (estimateTextTokens(summary) < estimateTextTokens(block.text)) {
          next.push({ ...block, text: summary });
          changed = true;
          continue;
        }
      }
      next.push(block);
    }
    return changed ? ({ ...message, content: next } as AgentMessage) : message;
  };

  /** TOOL_EXECUTION: distill the whole observation into `{ summary }`. */
  const distillToolResult = async (
    message: AgentMessage,
    thresholdChars: number,
  ): Promise<AgentMessage> => {
    const blocks = contentBlocks(message) ?? [];
    const stringifiedObs = blocks
      .filter(isTextBlock)
      .map((block) => block.text)
      .join("\n");
    if (stringifiedObs.length <= thresholdChars) {
      return message;
    }
    const toolName = String((message as { toolName?: unknown }).toolName || "unknown");
    const summary = await generateSummary(stringifiedObs, toolName);
    if (estimateTextTokens(summary) >= estimateTextTokens(stringifiedObs)) {
      return message;
    }
    const nonText = blocks.filter((block) => !isTextBlock(block));
    return {
      ...message,
      content: [{ type: "text", text: summary }, ...nonText],
    } as AgentMessage;
  };

  return {
    id,
    name: "NodeDistillationProcessor",
    process: async ({ targets }) => {
      const thresholdChars = tokensToChars(options.nodeThresholdTokens);
      const returnedNodes: AgentMessage[] = [];

      // Scan the target working buffer and unconditionally apply the configured threshold
      for (const node of targets) {
        switch ((node as { role?: unknown }).role) {
          case "user":
            returnedNodes.push(await distillTextParts(node, "USER_PROMPT", thresholdChars));
            break;
          case "assistant":
            returnedNodes.push(await distillTextParts(node, "AGENT_THOUGHT", thresholdChars));
            break;
          case "toolResult":
            returnedNodes.push(await distillToolResult(node, thresholdChars));
            break;
          default:
            returnedNodes.push(node);
            break;
        }
      }

      return returnedNodes;
    },
  };
}
