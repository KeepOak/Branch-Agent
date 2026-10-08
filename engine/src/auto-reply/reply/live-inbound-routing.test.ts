// Routing owns lanes and cancellation; an in-memory transcript store isolates DB workers.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { resolveSessionLane } from "../../agents/embedded-agent-runner/lanes.js";
import type { RunEmbeddedAgentParams } from "../../agents/embedded-agent-runner/run/params.js";
import { enqueueCommandInLane, getCommandLaneSnapshot } from "../../process/command-queue.js";
import { resetCommandQueueStateForTest } from "../../process/command-queue.test-support.js";
import { runEmbeddedFallbackCandidate } from "./agent-runner-embedded-candidate.js";
import { shouldStartLiveInboundReply, startLiveInboundReply } from "./live-inbound-routing.js";
import type { FollowupRun } from "./queue/types.js";
import {
  abortReplyRunBySessionId,
  createReplyOperation,
  resolveReplyOperationsForSession,
  type ReplyOperation,
} from "./reply-run-registry.js";
import { testing as replyRunTesting } from "./reply-run-registry.test-support.js";

const fake = vi.hoisted(() => ({
  histories: new Map<string, string[]>(),
  model: vi.fn<(params: RunEmbeddedAgentParams) => Promise<{ payloads: { text: string }[] }>>(),
}));
vi.mock("../../agents/embedded-agent.js", () => ({ runEmbeddedAgent: fake.model }));
vi.mock("../../plugin-sdk/session-transcript-runtime.js", () => ({
  appendAssistantMirrorMessageByIdentity: async (params: {
    sessionKey: string;
    text: string;
    signal: AbortSignal;
  }) => {
    params.signal.throwIfAborted();
    const history = fake.histories.get(params.sessionKey) ?? [];
    history.push(params.text);
    fake.histories.set(params.sessionKey, history);
    return { ok: true, messageId: String(history.length) };
  },
}));
vi.mock("./agent-runner-utils.js", () => ({
  buildEmbeddedRunExecutionParams: async ({ run }: { run: FollowupRun["run"] }) => ({
    runBaseParams: run,
    embeddedContext: {},
    senderContext: {},
  }),
}));
vi.mock("../../config/sessions.js", () => ({ resolveGroupSessionKey: () => undefined }));
vi.mock("../../agents/openai-routing.js", () => ({
  resolveOpenAIRuntimeProvider: ({ provider }: { provider: string }) => provider,
}));
vi.mock("./agent-runner-core.js", () => ({ resolveTerminalReplyDelivery: vi.fn() }));
vi.mock("./agent-runner-event-handler.js", () => ({ createAgentRunEventHandler: () => vi.fn() }));
vi.mock("./agent-lifecycle-terminal.js", () => ({
  createAgentLifecycleTerminalBackstop: () => ({ beginAttempt: vi.fn() }),
}));

const KEY = "agent:main:telegram:direct:owner-chat";
const SESSION = "real-session";
const holds: Array<ReturnType<typeof createDeferred<void>>> = [];
const pending: Promise<unknown>[] = [];

function holdLane(lane: string) {
  const hold = createDeferred();
  holds.push(hold);
  pending.push(enqueueCommandInLane(lane, () => hold.promise));
  return hold;
}
function followup(kind: "external_user" | "inter_session" = "external_user"): FollowupRun {
  return {
    prompt: "Are you there?",
    summaryLine: "ping",
    enqueuedAt: Date.now(),
    messageId: "ping",
    run: {
      agentId: "main",
      sessionId: SESSION,
      sessionKey: KEY,
      sessionFile: "unused-session",
      workspaceDir: ".",
      agentDir: ".",
      config: {},
      provider: "openai",
      model: "gpt-5.5",
      thinkLevel: "low",
      verboseLevel: "off",
      elevatedLevel: "off",
      timeoutMs: 60_000,
      blockReplyBreak: "message_end",
      inputProvenance:
        kind === "inter_session"
          ? { kind, sourceTool: "sessions_send", sourceSessionKey: "agent:elm:main" }
          : { kind },
    },
  };
}
function runCandidate(run: FollowupRun, operation: ReplyOperation) {
  // Only presentation/model services are faked; production candidate passes lanes,
  // persistence and cancellation to the model and real live-inbound persistence owner.
  const params = {
    turn: {
      followupRun: run,
      sessionKey: KEY,
      sessionCtx: {},
      commandBody: run.prompt,
      getActiveSessionEntry: () => undefined,
      replyOperation: operation,
      typingSignals: {},
      opts: {},
    },
    candidateRun: run.run,
    effectiveRun: run.run,
    candidateThinkLevel: "low",
    candidateAgentRuntime: "branch",
    agentHarnessRuntimeOverride: "branch",
    provider: "openai",
    model: "gpt-5.5",
    runtimeConfig: {},
    runId: operation.sessionId,
    runAbortSignal: operation.abortSignal,
    runLane: run.liveInboundGlobalLane,
    getLifecycleGeneration: () => "test-generation",
    onLifecycleBackstop: vi.fn(),
    onCompactionFacts: vi.fn(),
    currentTurnImages: {},
    deferredLifecycle: {},
    bootstrapPromptWarningSignaturesSeen: [],
    presentation: {},
    timing: { logMilestoneIfSlow: vi.fn(), measure: (_: string, fn: () => unknown) => fn() },
  } as unknown as Parameters<typeof runEmbeddedFallbackCandidate>[0];
  return runEmbeddedFallbackCandidate(params);
}
function fastModel() {
  fake.model.mockImplementation(async (params) => {
    await enqueueCommandInLane(params.lane ?? "main", () =>
      enqueueCommandInLane(
        params.liveInboundSessionLane ?? resolveSessionLane(KEY),
        async () => undefined,
      ),
    );
    params.abortSignal?.throwIfAborted();
    return { payloads: [{ text: "reply:" + params.prompt }] };
  });
}
afterEach(async () => {
  for (const hold of holds.splice(0)) {
    hold.resolve();
  }
  await Promise.allSettled(pending.splice(0));
  replyRunTesting.resetReplyRunRegistry();
  resetCommandQueueStateForTest();
  fake.histories.clear();
  fake.model.mockReset();
});

describe("live inbound routing", () => {
  it("answers on a side lane while the chat and main lanes remain held", async () => {
    holdLane(resolveSessionLane(KEY));
    holdLane("main");
    const active = createReplyOperation({
      sessionKey: KEY,
      sessionId: SESSION,
      resetTriggered: false,
    });
    active.setPhase("running");
    expect(
      shouldStartLiveInboundReply({
        isHeartbeat: false,
        resetTriggered: false,
        queueMode: "steer",
        messageInjectionDisposition: "unavailable",
        sessionKey: KEY,
      }),
    ).toBe(true);
    fastModel();
    const run = followup();
    const started = performance.now();
    const { result } = await startLiveInboundReply({
      followupRun: run,
      sessionKey: KEY,
      run: (op) => runCandidate(run, op),
    });
    expect(result.payloads?.[0]?.text).toBe("reply:Are you there?");
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(getCommandLaneSnapshot(resolveSessionLane(KEY)).activeCount).toBe(1);
    expect(active.abortSignal.aborted).toBe(false);
    expect(active.result).toBeNull();
    expect(fake.model.mock.calls[0]?.[0]).toMatchObject({
      provider: "openai",
      model: "gpt-5.5",
      thinkLevel: "low",
      liveInboundSessionLane: "live-inbound:owner:" + KEY,
    });
  });

  it("persists the live assistant text in the real session history", async () => {
    fastModel();
    const run = followup();
    await startLiveInboundReply({
      followupRun: run,
      sessionKey: KEY,
      run: (op) => runCandidate(run, op),
    });
    expect(fake.histories.get(KEY)).toEqual(["reply:Are you there?"]);
    expect([...fake.histories.keys()]).toEqual([KEY]);
  });

  it("answers the owner while an agent reply is still running", async () => {
    holdLane(resolveSessionLane(KEY));
    const agentEntered = createDeferred();
    const agentHold = createDeferred();
    holds.push(agentHold);
    fastModel();
    fake.model.mockImplementationOnce(async () => {
      agentEntered.resolve();
      await agentHold.promise;
      return { payloads: [{ text: "agent reply" }] };
    });
    const agent = followup("inter_session");
    const agentPending = startLiveInboundReply({
      followupRun: agent,
      sessionKey: KEY,
      run: (op) => runCandidate(agent, op),
    });
    pending.push(agentPending);
    await agentEntered.promise;
    const owner = followup();
    const started = performance.now();
    const reply = await startLiveInboundReply({
      followupRun: owner,
      sessionKey: KEY,
      run: (op) => runCandidate(owner, op),
    });
    expect(reply.result.payloads?.[0]?.text).toBe("reply:Are you there?");
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(agent.liveInboundGlobalLane).not.toBe(owner.liveInboundGlobalLane);
    agentHold.resolve();
    await agentPending;
  });

  it.each(["sessionKey", "sessionId"])(
    "cancels every live inbound op by real %s, even after the busy turn ends",
    async (target) => {
      const active = createReplyOperation({
        sessionKey: KEY,
        sessionId: SESSION,
        resetTriggered: false,
      });
      const release = createDeferred();
      holds.push(release);
      const operations: ReplyOperation[] = [];
      for (const kind of ["external_user", "inter_session"] as const) {
        const task = startLiveInboundReply({
          followupRun: followup(kind),
          sessionKey: KEY,
          run: async (op) => {
            op.setPhase("running");
            operations.push(op);
            await release.promise;
          },
        });
        pending.push(task);
      }
      active.complete();
      if (target === "sessionId") {
        expect(abortReplyRunBySessionId(SESSION)).toBe(true);
      } else {
        const found = resolveReplyOperationsForSession({
          sessionKeys: [KEY],
          sessionId: SESSION,
          agentId: "main",
        });
        expect(found).toHaveLength(2);
        for (const op of found) {
          op.abortByUser();
        }
      }
      expect(operations).toHaveLength(2);
      expect(operations.every((op) => op.abortSignal.aborted)).toBe(true);
      release.resolve();
    },
  );
});
