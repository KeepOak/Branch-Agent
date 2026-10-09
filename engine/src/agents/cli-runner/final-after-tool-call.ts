import type { CliOutput } from "../cli-output-contracts.js";
import { appendCliResultText } from "../cli-output-results.js";
import { SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION } from "../embedded-agent-runner/run/incomplete-turn-recovery.js";
import { acceptsCliLiveSession } from "./cli-live-session-registry.js";
import type { PreparedCliRunContext } from "./types.js";

export const CLI_ENDED_AFTER_TOOL_CALL_ERROR =
  "The run ended after a tool call without a final message.";
export const CLI_ENDED_AFTER_TOOL_CALL_CODE = "cli_ended_after_tool_call";

/**
 * Context for the single text-only continuation that asks a turn which ended
 * on a tool call for its final message. It resumes the same CLI session with
 * only the instruction as its prompt, so the original turn is never replayed.
 */
export function buildFinalAfterToolCallContext(
  context: PreparedCliRunContext,
): PreparedCliRunContext {
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
  // A warm stdio session fixes its argv at start and keeps the turn only in
  // that process; restarting it to drop tools would lose the turn. Fresh
  // processes resume the native transcript, so they run with no tools at all.
  if (!acceptsCliLiveSession(context)) {
    params.cliToolAvailability = { native: [], branch: [] };
  }
  const continuation: PreparedCliRunContext = { ...context, params };
  delete continuation.promptContext;
  return continuation;
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
