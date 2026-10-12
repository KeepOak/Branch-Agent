import type { CliOutput } from "../cli-output-contracts.js";
import { appendCliResultText } from "../cli-output-results.js";
import { SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION } from "../embedded-agent-runner/run/incomplete-turn-recovery.js";
import { acceptsCliLiveSession, restartCliLiveSession } from "./cli-live-session-registry.js";
import type { PreparedCliRunContext } from "./types.js";

export const CLI_ENDED_AFTER_TOOL_CALL_ERROR =
  "The run ended after a tool call without a final message.";
export const CLI_ENDED_AFTER_TOOL_CALL_CODE = "cli_ended_after_tool_call";

/**
 * Context for the single text-only continuation that asks a turn which ended
 * on a tool call for its final message. It resumes the same CLI session with
 * only the instruction as its prompt, so the original turn is never replayed.
 */
function buildFinalAfterToolCallContext(context: PreparedCliRunContext): PreparedCliRunContext {
  const params: PreparedCliRunContext["params"] = {
    ...context.params,
    prompt: SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION,
    forkCliSessionOnResume: false,
  };
  delete params.cliSessionResumeAt;
  delete params.persistCliSessionForkSuccessor;
  delete params.images;
  delete params.imageOrder;
  delete params.imagePrompt;
  delete params.media;
  // Execution-internal image layout carried alongside the public params.
  delete (params as { mediaImageLayout?: unknown }).mediaImageLayout;
  // The continuation runs with no tools on every backend, so it ends in one model turn.
  params.cliToolAvailability = { native: [], branch: [] };
  const continuation: PreparedCliRunContext = { ...context, params };
  delete continuation.promptContext;
  if (acceptsCliLiveSession(context)) {
    // A warm stdio process fixes its tools at start. The continuation runs in its own
    // process that resumes the persisted native transcript; the next turn starts a new
    // warm process from that transcript, including this final message.
    const { liveSession: _liveSession, ...processPerTurnBackend } = context.preparedBackend.backend;
    continuation.preparedBackend = { ...context.preparedBackend, backend: processPerTurnBackend };
    delete continuation.requiredClaudeLiveSessionGeneration;
  }
  return continuation;
}

/**
 * Prepares the final-message continuation. A warm live session is closed first so the
 * tool-less process owns the native session alone. Returns undefined when the turn lives
 * only in that warm process (its transcript was not on disk), which cannot be resumed.
 */
export async function prepareFinalAfterToolCallContext(
  context: PreparedCliRunContext,
): Promise<PreparedCliRunContext | undefined> {
  if (acceptsCliLiveSession(context)) {
    if (context.requiredClaudeLiveSessionGeneration) {
      return undefined;
    }
    await restartCliLiveSession(context);
  }
  return buildFinalAfterToolCallContext(context);
}

/** Use the continuation's text as the turn's final message, keeping its tool evidence. */
export function mergeFinalAfterToolCall(output: CliOutput, final: CliOutput): CliOutput {
  const { text, textParts } = appendCliResultText(output, final.text.trim());
  const merged: CliOutput = {
    ...output,
    text,
    rawText: final.rawText ?? final.text,
    ...(output.textParts ? { textParts } : {}),
    ...(final.sessionId ? { sessionId: final.sessionId } : {}),
    ...(final.resumeCheckpointId ? { resumeCheckpointId: final.resumeCheckpointId } : {}),
    ...(final.usage ? { usage: final.usage } : {}),
    ...(final.diagnosticUsage ? { diagnosticUsage: final.diagnosticUsage } : {}),
  };
  delete merged.endedAfterToolCall;
  return merged;
}
