// Ported from cline/cline sdk/packages/core/src/runtime/safety/mistake-tracker.ts
// at 0809928ab28783c0d2b41c1e56edaf0951dadcab. The run loop feeds it once per
// turn in which every tool call failed (session-runtime-orchestrator.ts turn
// bookkeeping at the same commit) and stops the run at the cap.

export type MistakeReason = "api_error" | "invalid_tool_call" | "tool_execution_failed";

export interface ConsecutiveMistakeLimitContext {
  iteration: number;
  consecutiveMistakes: number;
  maxConsecutiveMistakes: number;
  reason: MistakeReason;
  details?: string;
}

export type ConsecutiveMistakeLimitDecision =
  | { action: "continue"; guidance?: string }
  | { action: "stop"; reason?: string };

export type ConsecutiveMistakeLimitHandler = (
  context: ConsecutiveMistakeLimitContext,
) => Promise<ConsecutiveMistakeLimitDecision> | ConsecutiveMistakeLimitDecision;

export interface RecordMistakeInput {
  iteration: number;
  reason: MistakeReason;
  details?: string;
  /** When true, jump straight to maxConsecutiveMistakes instead of incrementing by 1. */
  forceAtLimit?: boolean;
}

export type MistakeOutcome =
  | { action: "continue"; guidance?: string }
  | { action: "stop"; message: string; reason?: string };

export interface MistakeTrackerOptions {
  readonly maxConsecutiveMistakes: number;
  readonly onLimitReached?: ConsecutiveMistakeLimitHandler;
  readonly appendRecoveryNotice: (message: string, reason: MistakeReason) => void;
}

/** Same default as cline's session runtime (`execution.maxConsecutiveMistakes ?? 6`). */
export const DEFAULT_MAX_CONSECUTIVE_MISTAKES = 6;

export class MistakeTracker {
  private consecutiveMistakes = 0;
  private readonly options: MistakeTrackerOptions;

  constructor(options: MistakeTrackerOptions) {
    this.options = options;
  }

  async record(input: RecordMistakeInput): Promise<MistakeOutcome> {
    const max = this.options.maxConsecutiveMistakes;
    const next = input.forceAtLimit && max ? max : this.consecutiveMistakes + 1;
    this.consecutiveMistakes = next;

    if (!max || next < max) {
      return { action: "continue" };
    }

    const limitContext: ConsecutiveMistakeLimitContext = {
      iteration: input.iteration,
      consecutiveMistakes: next,
      maxConsecutiveMistakes: max,
      reason: input.reason,
      details: input.details,
    };
    const decision = await resolveConsecutiveMistakeDecision(
      limitContext,
      this.options.onLimitReached,
    );

    if (decision.action === "continue") {
      const guidance = decision.guidance?.trim();
      if (guidance) {
        this.options.appendRecoveryNotice(guidance, input.reason);
      }
      this.consecutiveMistakes = 0;
      return { action: "continue", guidance };
    }

    return {
      action: "stop",
      reason: decision.reason?.trim() || undefined,
      message: buildMistakeLimitStopMessage({
        iteration: input.iteration,
        consecutiveMistakes: next,
        maxConsecutiveMistakes: max,
        reason: input.reason,
        details: input.details,
        stopReason: decision.reason,
      }),
    };
  }

  reset(): void {
    this.consecutiveMistakes = 0;
  }

  get value(): number {
    return this.consecutiveMistakes;
  }
}

export function buildMistakeLimitStopMessage(input: {
  iteration: number;
  consecutiveMistakes: number;
  maxConsecutiveMistakes: number;
  reason: MistakeReason | "completion_without_submit";
  details?: string;
  stopReason?: string;
}): string {
  const parts = [
    `Stopped after ${input.consecutiveMistakes}/${input.maxConsecutiveMistakes} consecutive mistakes (${input.reason}) at iteration ${input.iteration}.`,
  ];
  const details = input.details?.trim();
  if (details) {
    parts.push(`Error: ${details}`);
  }
  const stopReason = input.stopReason?.trim();
  if (stopReason) {
    parts.push(`Decision: ${stopReason}`);
  }
  parts.push("Session state was preserved. Send a new prompt to resume from the latest state.");
  return parts.join(" ");
}

async function resolveConsecutiveMistakeDecision(
  input: ConsecutiveMistakeLimitContext,
  callback?: ConsecutiveMistakeLimitHandler,
): Promise<ConsecutiveMistakeLimitDecision> {
  if (!callback) {
    return {
      action: "stop",
      reason: `maximum consecutive mistakes reached (${input.maxConsecutiveMistakes})`,
    };
  }
  try {
    return await callback(input);
  } catch (error) {
    return {
      action: "stop",
      reason:
        error instanceof Error
          ? error.message
          : `maximum consecutive mistakes reached (${input.maxConsecutiveMistakes})`,
    };
  }
}

/**
 * Per-turn feed from cline's orchestrator: a turn whose tool calls all failed
 * records one mistake; any successful tool call resets the count.
 */
export async function recordToolTurnOutcome(
  tracker: MistakeTracker,
  iteration: number,
  toolResults: ReadonlyArray<{ isError: boolean; toolName: string; content: unknown }>,
): Promise<MistakeOutcome> {
  let failed = 0;
  let succeeded = 0;
  const failureDetails: string[] = [];
  for (const result of toolResults) {
    if (result.isError) {
      failed += 1;
      const errorText = toolResultText(result.content);
      if (errorText) {
        failureDetails.push(`[${result.toolName}] ${errorText}`);
      }
    } else {
      succeeded += 1;
    }
  }
  if (failed > 0 && succeeded === 0) {
    const details = failureDetails.join("; ");
    return await tracker.record({
      iteration,
      reason: "tool_execution_failed",
      details: `${failed} tool call(s) failed${details ? `: ${details}` : ""}`,
    });
  }
  if (succeeded > 0) {
    tracker.reset();
  }
  return { action: "continue" };
}

function toolResultText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part: unknown) =>
      part && typeof part === "object" && (part as { type?: unknown }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join("")
    .trim();
}
