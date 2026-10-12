// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/condenser/llm_summarizing_condenser.py and openhands-sdk/openhands/sdk/utils/truncate.py (atlas AGENT-LOOP-0104). Converted to TypeScript; R-1541 drops oldest folded items before hard-reset scaling. Canonical history and caller cancellation are preserved.

import { serializeConversation } from "../../packages/agent-core/src/harness/compaction/utils.js";
import { convertToLlm } from "../../packages/agent-core/src/harness/messages.js";
import { sanitizeCompactionMessages } from "./compaction-planning.js";
import { isContextOverflowError } from "./failover/context-overflow.js";
import { classifyProviderError } from "./failover/provider-error-classification.js";
import type { AgentMessage } from "./runtime/index.js";

const TRUNCATION_NOTICE =
  "<response clipped><NOTE>Due to the max output limit, only part of the full response has been shown to you.</NOTE>";
export function maybeTruncate(content: string, truncateAfter?: number): string {
  if (!truncateAfter || truncateAfter < 0 || content.length <= truncateAfter) return content;
  if (TRUNCATION_NOTICE.length >= truncateAfter) return TRUNCATION_NOTICE.slice(0, truncateAfter);
  const remaining = truncateAfter - TRUNCATION_NOTICE.length,
    head = Math.ceil(remaining / 2),
    tail = remaining - head;
  return content.slice(0, head) + TRUNCATION_NOTICE + (tail ? content.slice(-tail) : "");
}
function overflow(error: unknown): boolean {
  return (
    classifyProviderError(error) === "context_window_exceeded" ||
    isContextOverflowError(error instanceof Error ? error.message : String(error))
  );
}
function serializeEvent(message: AgentMessage): string {
  return serializeConversation(convertToLlm(sanitizeCompactionMessages([message])));
}
function eventTimestamp(message: AgentMessage): number {
  if (typeof message.timestamp === "number") return message.timestamp;
  const numeric = Number(message.timestamp);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(message.timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}
function projectEvents(messages: AgentMessage[], maxLength: number): AgentMessage[] {
  return messages.map((message) => ({
    role: "user",
    content: maybeTruncate(serializeEvent(message), maxLength),
    timestamp: eventTimestamp(message),
  }));
}
export type CompactionOverflowOptions = {
  signal: AbortSignal;
  maxRetries?: number;
  scaling?: number;
  onRetry?: (phase: "drop-oldest" | "hard-reset", attempt: number) => void;
};
/** Source's five-attempt, 0.8 scaling policy; the system prompt stays in the completion caller. */
export async function hardContextReset(
  messages: AgentMessage[],
  complete: (input: AgentMessage[]) => Promise<string>,
  options: CompactionOverflowOptions,
): Promise<string | undefined> {
  const retries = options.maxRetries ?? 5,
    scaling = options.scaling ?? 0.8;
  let maxLength: number | undefined;
  for (let attempt = 0; attempt < retries; attempt++) {
    options.signal.throwIfAborted();
    try {
      return await complete(
        maxLength === undefined ? messages : projectEvents(messages, maxLength),
      );
    } catch (error) {
      options.signal.throwIfAborted();
      if (!overflow(error)) throw error;
      maxLength = Math.floor(
        (maxLength ??
          messages.reduce(
            (largest, message) => Math.max(largest, serializeEvent(message).length),
            0,
          )) * scaling,
      );
      options.onRetry?.("hard-reset", attempt + 1);
    }
  }
  return undefined;
}
/** Never reports a failed hard reset as a successful checkpoint. */
export async function summarizeWithCompactionOverflowRetry(
  messages: AgentMessage[],
  complete: (input: AgentMessage[]) => Promise<string>,
  options: CompactionOverflowOptions,
): Promise<string> {
  const retries = options.maxRetries ?? 5;
  let lastError: unknown;
  for (let attempt = 0; attempt < retries; attempt++) {
    options.signal.throwIfAborted();
    const dropped = Math.min(attempt, Math.max(0, messages.length - 1));
    if (attempt > 0 && dropped < attempt) break;
    try {
      const summary = await complete(dropped ? messages.slice(dropped) : messages);
      return dropped
        ? `[Uncertain: overflow recovery omitted ${dropped} oldest folded message(s) from summary input. The canonical transcript is retained.]\n\n${summary}`
        : summary;
    } catch (error) {
      options.signal.throwIfAborted();
      if (!overflow(error)) throw error;
      lastError = error;
      options.onRetry?.("drop-oldest", attempt + 1);
    }
  }
  const reset = await hardContextReset(messages, complete, options);
  if (reset !== undefined)
    return `[Uncertain: overflow recovery required clipped summary input; each clipped event retained its beginning and end. The canonical transcript is retained.]\n\n${reset}`;
  throw lastError;
}
