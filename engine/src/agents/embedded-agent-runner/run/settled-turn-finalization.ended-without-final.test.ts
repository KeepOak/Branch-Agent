import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getReplyPayloadMetadata } from "../../../auto-reply/reply-payload.js";
import {
  prepareSystemAgentRunAdmission,
  type AdmittedRunContext,
} from "../../admitted-run-context.js";
import {
  buildEmbeddedRunnerAssistant,
  makeEmbeddedRunnerAttempt,
} from "../../test-helpers/embedded-agent-runner-e2e-fixtures.js";
import type { EmbeddedRunAttemptWithReceiptEvidence } from "./attempt-result.js";
import {
  SETTLED_TOOL_ENDED_WITHOUT_FINAL_ERROR,
  SETTLED_TOOL_FINALIZATION_FALLBACK_TEXT,
  SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION,
} from "./incomplete-turn-recovery.js";
import { prepareTerminalWithSettledTurnFinalization } from "./settled-turn-finalization.js";
import { createSettledFinalizationTestInput } from "./settled-turn-finalization.test-support.js";
import { resolveEmbeddedRunTerminal } from "./terminal-resolution.js";
import { makeTerminalInput } from "./terminal-resolution.test-support.js";
import type { EmbeddedRunAttemptParams } from "./types.js";

// #847: a run that stops right after a tool result gets one more tool-less
// prompt for its final message; if that still writes nothing, the run ends
// marked "ended without a final" instead of looking finished.

const backendMocks = vi.hoisted(() => ({
  runSettledFinalization: vi.fn(),
  resolveRuntimeModelAttempt: vi.fn(() => undefined),
}));
const transcriptMocks = vi.hoisted(() => ({
  appendAssistantMirrorMessageByIdentity: vi.fn(),
}));

vi.mock("./backend.js", () => ({
  resolveRuntimeModelAttempt: backendMocks.resolveRuntimeModelAttempt,
}));
vi.mock("../../harness/selection.js", () => ({
  runAgentHarnessSettledTurnFinalization: backendMocks.runSettledFinalization,
}));
vi.mock("../../../plugin-sdk/session-transcript-runtime.js", () => ({
  appendAssistantMirrorMessageByIdentity: transcriptMocks.appendAssistantMirrorMessageByIdentity,
}));
vi.mock("../../run-session-target.js", () => ({
  resolveAgentRunSessionTarget: vi.fn(
    async (params: {
      agentId?: string;
      sessionId: string;
      sessionKey?: string;
      sessionTarget?: EmbeddedRunAttemptParams["sessionTarget"];
    }) => ({
      agentId: params.sessionTarget?.agentId ?? params.agentId ?? "main",
      sessionId: params.sessionTarget?.sessionId ?? params.sessionId,
      sessionKey: params.sessionTarget?.sessionKey ?? params.sessionKey ?? "agent:main:settled",
      storePath: params.sessionTarget?.storePath ?? "/synthetic/sessions.json",
    }),
  ),
}));

/** The model ran two tools, both results are recorded, and it wrote nothing after them. */
function endedAfterToolResultAttempt(): EmbeddedRunAttemptWithReceiptEvidence {
  const assistant = buildEmbeddedRunnerAssistant({
    stopReason: "toolUse",
    content: [
      { type: "toolCall", id: "tool-read", name: "read", arguments: {} },
      { type: "toolCall", id: "tool-exec", name: "exec", arguments: {} },
    ],
  });
  const messagesSnapshot = [
    assistant,
    { role: "toolResult", toolCallId: "tool-read", toolName: "read", isError: false },
    { role: "toolResult", toolCallId: "tool-exec", toolName: "exec", isError: false },
  ] as never;
  return makeEmbeddedRunnerAttempt({
    terminal: { kind: "ok" },
    sessionIdUsed: "session-settled",
    sessionFileUsed: "/tmp/session-settled.jsonl",
    assistantTexts: [],
    toolMetas: [
      { toolName: "read", isError: false, replaySafe: true },
      { toolName: "exec", isError: false, replaySafe: false },
    ],
    itemLifecycle: { startedCount: 2, completedCount: 2, activeCount: 0 },
    messagesSnapshot,
    lastAssistant: assistant,
    currentAttemptAssistant: assistant,
    currentAttemptReplayMetadata: { hadPotentialSideEffects: true, replaySafe: false },
    replayMetadata: { hadPotentialSideEffects: true, replaySafe: false },
    settledTurnFinalizationContext: { source: "branch-transcript", messages: messagesSnapshot },
    assistantTurns: 1,
  });
}

let admittedRunContext: AdmittedRunContext;

function userRunInput(trigger: "user" | "cron" = "user") {
  const input = createSettledFinalizationTestInput(
    endedAfterToolResultAttempt(),
    admittedRunContext,
  );
  input.terminalBase.runParams.trigger = trigger;
  input.terminalBase.runParams.sourceReplyDeliveryMode = "automatic";
  input.finalization.preparedAttempt.sessionKey = "agent:main:settled";
  input.finalization.preparedAttempt.agentId = "main";
  return input;
}

async function resolveTerminal(
  input: ReturnType<typeof userRunInput>,
  result: Awaited<ReturnType<typeof prepareTerminalWithSettledTurnFinalization>>,
) {
  const terminalInput = makeTerminalInput({
    ...result.prepared,
    attempt: result.attempt,
    attemptAssistant: result.attemptAssistant,
    terminalState: result.terminalState,
    runParams: input.terminalBase.runParams,
    settledTurnFinalizationOutcome: result.finalizationOutcome,
    settledTurnEndedWithoutFinal: result.endedWithoutFinal,
    replayState: { hadPotentialSideEffects: true, replayInvalid: false },
  });
  const terminal = await resolveEmbeddedRunTerminal(terminalInput);
  if (terminal.action !== "complete") {
    throw new Error("expected a completed terminal");
  }
  return { terminal: terminal.result, terminalInput };
}

describe("run that ends right after a tool result (#847)", () => {
  let admission: ReturnType<typeof prepareSystemAgentRunAdmission>;
  beforeEach(async () => {
    backendMocks.runSettledFinalization.mockReset();
    transcriptMocks.appendAssistantMirrorMessageByIdentity.mockReset();
    transcriptMocks.appendAssistantMirrorMessageByIdentity.mockResolvedValue({
      ok: true,
      messageId: "fallback-message",
    });
    admission = prepareSystemAgentRunAdmission({}, "run-settled", "main", "ended-without-final");
    admittedRunContext = await admission.admit("embedded");
  });
  afterEach(() => {
    admission.close();
  });

  it("prompts once more, tool-less, and delivers the summary as a finished run", async () => {
    const summary = "Tests passed: 12 of 12. SELF-CHECK below.";
    backendMocks.runSettledFinalization.mockResolvedValueOnce({
      outcome: "answered",
      result: {
        assistant: buildEmbeddedRunnerAssistant({ content: [{ type: "text", text: summary }] }),
      },
    });
    const input = userRunInput();

    const result = await prepareTerminalWithSettledTurnFinalization(input);

    expect(backendMocks.runSettledFinalization).toHaveBeenCalledOnce();
    expect(backendMocks.runSettledFinalization.mock.calls[0]?.[0]).toMatchObject({
      operation: "settled-tool-finalization",
      prompt: SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION,
      disableTools: true,
    });
    expect(result.finalizationOutcome).toBe("answered");
    expect(result.endedWithoutFinal).toBe(false);
    expect(transcriptMocks.appendAssistantMirrorMessageByIdentity).not.toHaveBeenCalled();

    const { terminal, terminalInput } = await resolveTerminal(input, result);
    expect(terminal.meta.error).toBeUndefined();
    expect(terminal.payloads).toEqual([expect.objectContaining({ text: summary })]);
    expect(terminal.payloads?.[0]?.isError).not.toBe(true);
    expect(terminalInput.sessionPromptState.activateInternalPrompt).not.toHaveBeenCalled();
  });

  it.each(["empty", "failed"] as const)(
    "marks the run ended without a final when the extra prompt is %s",
    async (outcome) => {
      if (outcome === "failed") {
        backendMocks.runSettledFinalization.mockRejectedValue(new Error("summary unavailable"));
      } else {
        backendMocks.runSettledFinalization.mockResolvedValue({
          outcome: "empty",
          result: { assistant: buildEmbeddedRunnerAssistant({ content: [] }) },
        });
      }
      const input = userRunInput();

      const result = await prepareTerminalWithSettledTurnFinalization(input);

      expect(result.finalizationOutcome).toBe(outcome === "empty" ? "completed-empty" : "failed");
      expect(result.endedWithoutFinal).toBe(true);

      const { terminal, terminalInput } = await resolveTerminal(input, result);
      // Not a finished run: the terminal carries an error that never replays tools.
      expect(terminal.meta.error).toEqual({
        kind: "incomplete_turn",
        message: SETTLED_TOOL_ENDED_WITHOUT_FINAL_ERROR,
        fallbackSafe: false,
        terminalPresentation: false,
      });
      expect(terminal.meta.stopReason).toBeUndefined();
      // The user sees the host notice as an error reply, kept on its persisted transcript entry.
      expect(terminal.payloads).toEqual([
        expect.objectContaining({ text: SETTLED_TOOL_FINALIZATION_FALLBACK_TEXT, isError: true }),
      ]);
      expect(getReplyPayloadMetadata(terminal.payloads?.[0] ?? {})).toMatchObject({
        assistantTranscriptOwned: true,
        assistantTranscriptIdempotencyKey: "run-settled:settled-finalization-fallback",
      });
      expect(terminalInput.sessionPromptState.activateInternalPrompt).not.toHaveBeenCalled();
      expect(terminalInput.setTerminalLifecycleMeta).toHaveBeenCalledOnce();
    },
  );

  it("keeps a scheduled run's silent fallback unmarked", async () => {
    backendMocks.runSettledFinalization.mockResolvedValue({
      outcome: "empty",
      result: { assistant: buildEmbeddedRunnerAssistant({ content: [] }) },
    });
    const input = userRunInput("cron");

    const result = await prepareTerminalWithSettledTurnFinalization(input);

    expect(result.finalizationOutcome).toBe("silent-fallback");
    expect(result.endedWithoutFinal).toBe(false);
    const { terminal } = await resolveTerminal(input, result);
    expect(terminal.meta.error).toBeUndefined();
  });
});
