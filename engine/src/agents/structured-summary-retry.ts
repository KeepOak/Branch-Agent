// From aaif-goose/goose@bab8ff641039c9cd3331121cd84a5c6045f365ca:crates/goose-context-management/src/summarize.rs (atlas AGENT-LOOP-0100). Converted to TypeScript with Branch canonical toolResult messages.
import { isContextOverflowError } from "./failover/context-overflow.js";
import type { AgentMessage } from "./runtime/index.js";

export const SUMMARY_REMOVAL_PERCENTAGES = [0, 10, 20, 50, 100] as const;

/** Preserve the source's middle-out index order, including its odd-count boundary. */
export function filterSummaryToolResponses(
  messages: AgentMessage[],
  percent: number,
): AgentMessage[] {
  if (percent === 0) return messages;
  const indices = messages.flatMap((message, index) =>
    message.role === "toolResult" ? [index] : [],
  );
  if (!indices.length) return messages;
  const count = Math.max(1, Math.floor((indices.length * percent) / 100));
  const middle = Math.floor(indices.length / 2),
    removed = new Set<number>();
  for (let index = 0; index < count; index++) {
    const offset = Math.floor(index / 2);
    if (index % 2 === 0 && middle > offset) removed.add(indices[middle - offset - 1]);
    else if (index % 2 === 1 && middle + offset < indices.length)
      removed.add(indices[middle + offset]);
  }
  return messages.filter((_message, index) => !removed.has(index));
}

export class SummaryRemovalExhaustedError extends Error {}

/** Context-overflow recovery only; access failures and caller cancellation propagate. */
export async function summarizeWithToolResponseRemoval(
  messages: AgentMessage[],
  complete: (messages: AgentMessage[]) => Promise<string>,
): Promise<string> {
  const hasToolResponses = messages.some((message) => message.role === "toolResult");
  for (const [attempt, percent] of SUMMARY_REMOVAL_PERCENTAGES.entries()) {
    try {
      return await complete(filterSummaryToolResponses(messages, percent));
    } catch (error) {
      if (!isContextOverflowError(error instanceof Error ? error.message : String(error)))
        throw error;
      if (!hasToolResponses)
        throw new SummaryRemovalExhaustedError(
          "Failed to compact: the base prompt (system prompt, tool schemas, and conversation) exceeds the model's effective context window, and there are no tool responses to remove. Use a model or configuration with a larger usable context, disable some extensions to reduce the tool-schema payload, or start a new session.",
          { cause: error },
        );
      if (attempt === SUMMARY_REMOVAL_PERCENTAGES.length - 1)
        throw new SummaryRemovalExhaustedError(
          "Failed to compact: context limit exceeded even after removing all tool responses",
          { cause: error },
        );
    }
  }
  throw new Error("Unexpected: exhausted all attempts without returning");
}
