/** Tests the one final-message request after a CLI turn ends on a tool call (#847). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildExternalRunFailureReply } from "../auto-reply/reply/agent-runner-failure-reply.js";
import { withTestRunAdmission } from "./admitted-run-context.test-support.js";
import { runPreparedCliAgent } from "./cli-runner.js";
import { buildPreparedCliRunContext } from "./cli-runner.test-helpers.js";
import { acceptsCliLiveSession } from "./cli-runner/cli-live-session-registry.js";
import type { PreparedCliRunContext } from "./cli-runner/types.js";
import { SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION } from "./embedded-agent-runner/run/incomplete-turn-recovery.js";
import { FailoverError, hasModelFallbackStop } from "./failover-error.js";

const { executePreparedCliRunMock } = vi.hoisted(() => ({
  executePreparedCliRunMock: vi.fn(),
}));

vi.mock("./cli-runner/execute.runtime.js", () => ({
  executePreparedCliRun: executePreparedCliRunMock,
}));

vi.mock("../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: vi.fn(() => null),
}));

const PLAIN_REASON = "The run ended after a tool call without a final message.";
const endedOnToolCall = {
  text: "",
  rawText: "",
  sessionId: "native-tool-session",
  endedAfterToolCall: true as const,
};

function createContext(params: Partial<PreparedCliRunContext["params"]> = {}) {
  const context = buildPreparedCliRunContext({ prompt: "Run the tests and report." });
  Object.assign(context.params, params);
  return context;
}

// The Claude CLI path Trunks use: a plugin transport that keeps a warm stdio process.
function createLiveSessionContext() {
  const context = buildPreparedCliRunContext({
    prompt: "Run the tests and report.",
    backend: { liveSession: "claude-stdio" },
  });
  context.executionTarget = {
    kind: "plugin",
    execute: vi.fn(),
  } as PreparedCliRunContext["executionTarget"];
  const closeLiveSession = vi.fn(async () => {});
  context.preparedBackend.closeLiveSession = closeLiveSession;
  expect(acceptsCliLiveSession(context)).toBe(true);
  return { context, closeLiveSession };
}

// Closing a warm process needs live run authority, as in production.
function runLive(live: PreparedCliRunContext) {
  return withTestRunAdmission(
    { admittedRunContext: live.params.admittedRunContext, runId: live.params.runId },
    (admittedRunContext) =>
      runPreparedCliAgent({ ...live, params: { ...live.params, admittedRunContext } }),
  );
}

function continuationCall() {
  const call = executePreparedCliRunMock.mock.calls[1] as
    | [PreparedCliRunContext, string | undefined]
    | undefined;
  if (!call) {
    throw new Error("expected a final-message request");
  }
  return { context: call[0], cliSessionId: call[1] };
}

async function expectPlainFailure(operation: Promise<unknown>) {
  const error = await operation.then(
    () => {
      throw new Error("expected the run to fail");
    },
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({
    name: "FailoverError",
    message: PLAIN_REASON,
    code: "cli_ended_after_tool_call",
  });
  expect(hasModelFallbackStop(error)).toBe(true);
  return error;
}

describe("runPreparedCliAgent final message after a tool call", () => {
  beforeEach(() => {
    executePreparedCliRunMock.mockReset();
  });

  it("asks once on the same session with no tools and uses the answer as the final", async () => {
    executePreparedCliRunMock.mockResolvedValueOnce(endedOnToolCall).mockResolvedValueOnce({
      text: "All 3 tests pass.",
      rawText: "All 3 tests pass.",
      sessionId: "native-tool-session",
    });

    const result = await runPreparedCliAgent(createContext());

    expect(executePreparedCliRunMock).toHaveBeenCalledTimes(2);
    const { context, cliSessionId } = continuationCall();
    expect(cliSessionId).toBe("native-tool-session");
    expect(context.params.prompt).toBe(SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION);
    expect(context.params.cliToolAvailability).toEqual({ native: [], branch: [] });
    expect(result.payloads).toEqual([{ text: "All 3 tests pass." }]);
  });

  it("runs the request with no tools in its own process on a warm live session", async () => {
    executePreparedCliRunMock.mockResolvedValueOnce(endedOnToolCall).mockResolvedValueOnce({
      text: "All 3 tests pass.",
      rawText: "All 3 tests pass.",
      sessionId: "native-tool-session",
    });
    const { context: live, closeLiveSession } = createLiveSessionContext();

    const result = await runLive(live);

    expect(executePreparedCliRunMock).toHaveBeenCalledTimes(2);
    const { context, cliSessionId } = continuationCall();
    expect(cliSessionId).toBe("native-tool-session");
    expect(context.params.prompt).toBe(SETTLED_TOOL_TERMINAL_CONTINUATION_INSTRUCTION);
    expect(context.params.cliToolAvailability).toEqual({ native: [], branch: [] });
    // The warm process keeps its tools, so the request never runs on it: it is closed
    // first and the request resumes the persisted native session in a fresh process.
    expect(acceptsCliLiveSession(context)).toBe(false);
    expect(context.preparedBackend.backend.liveSession).toBeUndefined();
    expect(closeLiveSession).toHaveBeenCalledWith("restart");
    expect(closeLiveSession.mock.invocationCallOrder[0]).toBeLessThan(
      executePreparedCliRunMock.mock.invocationCallOrder[1]!,
    );
    // The next turn still starts a warm process.
    expect(live.preparedBackend.backend.liveSession).toBe("claude-stdio");
    expect(result.payloads).toEqual([{ text: "All 3 tests pass." }]);
  });

  it("ends plainly instead of asking with tools when the turn lives only in the warm process", async () => {
    executePreparedCliRunMock
      .mockResolvedValueOnce(endedOnToolCall)
      .mockResolvedValue({ text: "late answer", rawText: "late answer" });
    const { context: live, closeLiveSession } = createLiveSessionContext();
    live.requiredClaudeLiveSessionGeneration = "warm-generation";

    await expectPlainFailure(runLive(live));

    expect(executePreparedCliRunMock).toHaveBeenCalledOnce();
    expect(closeLiveSession).not.toHaveBeenCalled();
  });

  it("fails with the plain reason when the request returns nothing", async () => {
    executePreparedCliRunMock
      .mockResolvedValueOnce(endedOnToolCall)
      .mockResolvedValueOnce({ text: "", rawText: "", sessionId: "native-tool-session" });

    const error = await expectPlainFailure(runPreparedCliAgent(createContext()));

    expect(executePreparedCliRunMock).toHaveBeenCalledTimes(2);
    expect(buildExternalRunFailureReply({ message: PLAIN_REASON, error }).text).toBe(PLAIN_REASON);
  });

  it("asks only once when the request ends on a tool call again", async () => {
    executePreparedCliRunMock
      .mockResolvedValueOnce(endedOnToolCall)
      .mockResolvedValueOnce(endedOnToolCall)
      .mockResolvedValue({ text: "late answer", rawText: "late answer" });

    await expectPlainFailure(runPreparedCliAgent(createContext()));

    expect(executePreparedCliRunMock).toHaveBeenCalledTimes(2);
  });

  it("never replays the turn when the request itself fails", async () => {
    executePreparedCliRunMock.mockResolvedValueOnce(endedOnToolCall).mockRejectedValueOnce(
      new FailoverError("CLI produced no output.", {
        reason: "timeout",
        code: "cli_no_output_timeout",
        provider: "claude-cli",
        model: "sonnet",
      }),
    );
    const context = createContext({ sessionKey: "agent:main:main" });
    context.reusableCliSession = { mode: "reuse", sessionId: "native-tool-session" };
    context.branchHistoryPrompt = "history";

    await expectPlainFailure(runPreparedCliAgent(context));

    expect(executePreparedCliRunMock).toHaveBeenCalledTimes(2);
  });

  it("asks an optional-reply run for its final message instead of going silent", async () => {
    executePreparedCliRunMock.mockResolvedValueOnce(endedOnToolCall).mockResolvedValueOnce({
      text: "Checked the queue; nothing new.",
      rawText: "Checked the queue; nothing new.",
      sessionId: "native-tool-session",
    });

    const result = await runPreparedCliAgent(
      createContext({ allowEmptyAssistantReplyAsSilent: true }),
    );

    expect(executePreparedCliRunMock).toHaveBeenCalledTimes(2);
    expect(result.payloads).toEqual([{ text: "Checked the queue; nothing new." }]);
  });

  it("fails an optional-reply run plainly when the request returns nothing", async () => {
    executePreparedCliRunMock
      .mockResolvedValueOnce(endedOnToolCall)
      .mockResolvedValueOnce({ text: "", rawText: "", sessionId: "native-tool-session" });

    await expectPlainFailure(
      runPreparedCliAgent(createContext({ allowEmptyAssistantReplyAsSilent: true })),
    );
  });

  it("does not ask again when the turn wrote its final message", async () => {
    executePreparedCliRunMock.mockResolvedValueOnce({
      text: "All 3 tests pass.",
      rawText: "All 3 tests pass.",
      sessionId: "native-tool-session",
    });

    const result = await runPreparedCliAgent(createContext());

    expect(executePreparedCliRunMock).toHaveBeenCalledOnce();
    expect(result.payloads).toEqual([{ text: "All 3 tests pass." }]);
  });
});
