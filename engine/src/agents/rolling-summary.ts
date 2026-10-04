// Ported from google-gemini/gemini-cli packages/core/src/context/processors/rollingSummaryProcessor.ts at c6bccb7ecbf6d8368d995455dd725ed34466faad.
// Adapted from context-graph nodes to agent transcript messages.
import type { SideQuery } from "./agent-loop-side-query.js";
import { formatMessagesForLlm } from "./format-messages-for-llm.js";
import { CONTEXT_CHARS_PER_TOKEN, type ContextProcessor } from "./node-distillation.js";
import type { AgentMessage } from "./runtime/index.js";

export interface RollingSummaryProcessorOptions {
  target?: "incremental" | "freeNTokens" | "max";
  freeTokensTarget?: number;
  maxRollingSummaries?: number;
  systemInstruction?: string;
}

export interface RollingSummaryEnvironment {
  sideQuery: SideQuery;
  /** Token cost of one message (upstream env.tokenCalculator.getTokenCost). */
  getTokenCost?: (message: AgentMessage) => number;
  onError?: (message: string, error: unknown) => void;
}

const rollingSummaryMessages = new WeakSet<object>();

export function isRollingSummaryMessage(message: AgentMessage): boolean {
  return rollingSummaryMessages.has(message as object);
}

/** Token cost at the context manager's 3 characters per token. */
export function estimateMessageTokens(message: AgentMessage): number {
  const content = (message as { content?: unknown }).content;
  const chars = typeof content === "string" ? content.length : JSON.stringify(content ?? "").length;
  return Math.ceil(chars / CONTEXT_CHARS_PER_TOKEN);
}

function roleOf(message: AgentMessage | undefined): unknown {
  return (message as { role?: unknown } | undefined)?.role;
}

export function createRollingSummaryProcessor(
  id: string,
  env: RollingSummaryEnvironment,
  options: RollingSummaryProcessorOptions,
): ContextProcessor {
  const getTokenCost = env.getTokenCost ?? estimateMessageTokens;
  const generateRollingSummary = async (nodes: AgentMessage[]): Promise<string> => {
    const transcript = formatMessagesForLlm(nodes);

    const systemPrompt =
      options.systemInstruction ??
      `You are an expert context compressor. Your job is to drastically shorten the provided conversational transcript while preserving the absolute core semantic meaning, facts, and intent. Omit all conversational filler, pleasantries, or redundant information. Return ONLY the compressed summary.`;

    const response = await env.sideQuery({ systemPrompt, prompt: transcript });
    return response || "";
  };

  return {
    id,
    name: "RollingSummaryProcessor",
    process: async ({ targets }) => {
      if (targets.length === 0) {
        return [...targets];
      }

      const strategy = options.target ?? "max";
      const nodesToSummarize: AgentMessage[] = [];
      const first = targets[0];

      if (strategy === "incremental") {
        // 'incremental' simply summarizes the minimum viable chunk (the oldest 2 nodes), ignoring token math.
        for (const node of targets) {
          if (node === first && roleOf(node) === "user") {
            continue; // Keep system prompt
          }
          nodesToSummarize.push(node);
          if (nodesToSummarize.length >= 2) {
            break; // We have enough for a minimum rolling summary
          }
        }
      } else {
        let targetTokensToRemove = 0;
        if (strategy === "freeNTokens") {
          targetTokensToRemove = options.freeTokensTarget ?? Infinity;
        } else if (strategy === "max") {
          targetTokensToRemove = Infinity;
        }

        if (targetTokensToRemove > 0) {
          let deficitAccumulator = 0;
          for (const node of targets) {
            if (node === first && roleOf(node) === "user") {
              continue; // Keep system prompt
            }
            nodesToSummarize.push(node);
            deficitAccumulator += getTokenCost(node);
            if (deficitAccumulator >= targetTokensToRemove) {
              break;
            }
          }
        }
      }

      if (nodesToSummarize.length < 2) {
        return [...targets]; // Not enough context to summarize
      }

      try {
        // Synthesize the rolling summary synchronously
        const snapshotText = await generateRollingSummary(nodesToSummarize);
        const consumed = new Set<AgentMessage>(nodesToSummarize);

        const summaryNode = {
          role: "user",
          content: [{ type: "text", text: snapshotText }],
          timestamp: (nodesToSummarize[nodesToSummarize.length - 1] as { timestamp?: number })
            .timestamp,
        } as AgentMessage;
        rollingSummaryMessages.add(summaryNode as object);

        const returnedNodes = targets.filter((t) => !consumed.has(t));
        const firstRemovedIdx = targets.findIndex((t) => consumed.has(t));

        if (firstRemovedIdx !== -1) {
          const idx = Math.max(0, firstRemovedIdx);
          returnedNodes.splice(idx, 0, summaryNode);
        } else {
          returnedNodes.unshift(summaryNode);
        }

        return returnedNodes;
      } catch (e) {
        env.onError?.("RollingSummaryProcessor failed sync backstop", e);
        return [...targets];
      }
    },
  };
}
