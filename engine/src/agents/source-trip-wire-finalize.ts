import { resolveMaxProcessorRetries } from "./source-processor-retry-budget.js";
import { TripWire } from "./source-trip-wire.js";

/** Native finalization preserves its rejected draft and uses the reason as retry feedback. */
export function resolveTripWireFinalize(error: unknown, agentId?: string, rejectedDraft?: string) {
  if (!(error instanceof TripWire) || error.options.retry !== true || !error.message.trim()) {
    throw error;
  }
  const maxAttempts = resolveMaxProcessorRetries({
    maxProcessorRetries: undefined,
    hasErrorProcessors: true,
    agentId,
  });
  const feedback = rejectedDraft
    ? `The processor rejected this assistant response:\n${rejectedDraft}\n\nProcessor feedback:\n${error.message}`
    : error.message;
  return {
    action: "revise" as const,
    reason: feedback,
    retry: {
      instruction: feedback,
      maxAttempts,
      // Budget belongs to the processor, even when its feedback changes each time.
      idempotencyKey: `source-tripwire:${error.processorId ?? agentId ?? "anonymous"}`,
    },
  };
}
