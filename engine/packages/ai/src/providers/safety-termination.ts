// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/safety_termination_detectors.py (atlas AGENT-LOOP-0076)
import {
  appendAssistantMessageDiagnostic,
  isProviderRefusalAssistantError,
} from "@branch/llm-core/diagnostics";
import type { AssistantMessageDiagnostic } from "../types.js";

export const OPENAI_COMPATIBLE_CONTENT_FILTER_DETECTOR = "openai_compatible_content_filter";

/** finish_reason tokens that mean the provider stopped the response for safety reasons. */
export const DEFAULT_OPENAI_COMPATIBLE_SAFETY_FINISH_REASONS: readonly string[] = [
  "content_filter",
];

export interface SafetyTermination {
  detector: string;
  reasonField: "finish_reason";
  reasonValue: string;
}

type DiagnosticCarrier = { diagnostics?: AssistantMessageDiagnostic[] };

/**
 * Matches an OpenAI-compatible finish_reason against the safety tokens, case-insensitively.
 * Non-string or empty values pass through as no match, so malformed adapter output never throws.
 */
export function detectOpenAICompatibleContentFilter(
  finishReason: unknown,
  finishReasons: readonly string[] = DEFAULT_OPENAI_COMPATIBLE_SAFETY_FINISH_REASONS,
): SafetyTermination | undefined {
  if (typeof finishReason !== "string" || finishReason === "") {
    return undefined;
  }
  const tokens = new Set(finishReasons.map((reason) => reason.toLowerCase()));
  if (!tokens.has(finishReason.toLowerCase())) {
    return undefined;
  }
  return {
    detector: OPENAI_COMPATIBLE_CONTENT_FILTER_DETECTOR,
    reasonField: "finish_reason",
    reasonValue: finishReason,
  };
}

/**
 * Records a detected safety termination on the assistant message as a provider_refusal
 * diagnostic. The raw errorMessage is kept as the provider sent it. The existing refusal path
 * projects the user-facing copy from the diagnostic and never retries it.
 */
export function recordSafetyTermination(
  message: DiagnosticCarrier,
  termination: SafetyTermination,
  provider: string,
): void {
  if (isProviderRefusalAssistantError(message)) {
    return;
  }
  appendAssistantMessageDiagnostic(message, {
    type: "provider_refusal",
    timestamp: Date.now(),
    details: {
      provider,
      category: termination.reasonValue,
      detector: termination.detector,
    },
  });
}
