// A held session turn must not park the next inbound reply.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred } from "../../../test/helpers/promise.js";
import { resolveSessionLane } from "../../agents/embedded-agent-runner/lanes.js";
import type { RunEmbeddedAgentParams } from "../../agents/embedded-agent-runner/run/params.js";
import { claimAgentSessionWriter } from "../../agents/embedded-agent-runner/run/session-bootstrap.js";
import { SessionManager } from "../../agents/sessions/index.js";
import {
  initialModelFallbackAttemptOptions,
  type TestModelFallbackRunnerParams,
} from "../../agents/test-helpers/model-fallback-runner.test-support.js";
import type { SessionTranscriptRuntimeTarget } from "../../config/sessions/session-accessor.js";
import type { InternalSessionEntry } from "../../config/sessions/types.js";
import { createEmptyPluginRegistry } from "../../plugins/registry-empty.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import {
  enqueueCommandInLane,
  getCommandLaneSnapshot,
  setCommandLaneConcurrency,
} from "../../process/command-queue.js";
import { resetCommandQueueStateForTest } from "../../process/command-queue.test-support.js";
import { CommandLane } from "../../process/lanes.js";
import type { TemplateContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import { abortSessionRunTargetWithOutcome } from "./abort-operation.js";
import { createTestQueuedFollowupRun } from "./agent-runner.test-fixtures.js";
import { startLiveInboundReply } from "./live-inbound-routing.js";
import type { QueueSettings } from "./queue.js";
import { clearFollowupQueueForTest } from "./queue.test-helpers.js";
import { createReplyOperation, type ReplyOperation } from "./reply-run-registry.js";
import { testing as replyRunTesting } from "./reply-run-registry.test-support.js";
import { createMockTypingController } from "./test-helpers.js";

const REPLY_BUDGET_MS = 5_000;
const OWNER_SESSION_KEY = "agent:main:telegram:direct:owner-chat";
const OAK_SESSION_KEY = "agent:oak:main";
const ELM_SESSION_KEY = "agent:elm:main";
const MODEL = { provider: "openai", model: "gpt-5.5" } as const;

const runEmbeddedAgentMock = vi.fn();
const runSessionCompactionIfNeededMock = vi.fn();
const runMemoryFlushIfNeededMock = vi.fn();
const history = new Map<
  string,
  { target: SessionTranscriptRuntimeTarget; entry: InternalSessionEntry; manager: SessionManager }
>();

// Named CI shards reuse a worker. Do not inherit another file's cached backend
// module (or its mock); the dynamic reply runner must see this file's mocks.
vi.hoisted(() => vi.resetModules());
vi.mock("../../agents/model-fallback-runner.js", () => ({
  runWithModelFallback: async (params: TestModelFallbackRunnerParams) => ({
    result: await params.run(
      params.provider,
      params.model,
      initialModelFallbackAttemptOptions(params),
    ),
    provider: params.provider,
    model: params.model,
    attempts: [],
  }),
}));
vi.mock("./agent-runner-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-runner-utils.js")>()),
  resolveQueuedReplyExecutionConfig: async (cfg: unknown) => cfg,
}));

// Routing owns no database lifecycle. Keep storage boundaries fake, as in the
// other reply execution fixtures, instead of opening a worker-backed state DB.
vi.mock("../../config/sessions/session-transcript-watermark.js", () => ({
  readSessionTranscriptStartAsync: vi.fn(async (target: SessionTranscriptRuntimeTarget) => ({
    ...target,
    entryCount: 0,
  })),
}));
vi.mock("../../config/sessions/session-entry-read-runtime.js", () => ({
  readSessionEntryInWorker: vi.fn(async (target: { sessionKey: string }) => {
    const fixture = history.get(target.sessionKey);
    return fixture?.entry;
  }),
  readSessionEntryReadOnlyInWorker: vi.fn(async () => undefined),
}));
vi.mock("../../config/sessions/session-accessor.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../config/sessions/session-accessor.js")>()),
  loadSessionEntryReadOnly: vi.fn(() => undefined),
  updateSessionEntry: vi.fn(async () => undefined),
  patchSessionEntryCore: vi.fn(async () => undefined),
}));
vi.mock("../../agents/agent-bundle-mcp-manager-api.js", () => ({
  retireSessionMcpRuntime: vi.fn(async () => undefined),
  peekSessionMcpRuntime: vi.fn(() => undefined),
}));
vi.mock("../../infra/message-tool-run-outcome-store.js", () => ({
  recordMessageToolRunOutcome: vi.fn(),
}));
vi.mock("../../agents/harness/runtime-plugin.js", () => ({
  ensureSelectedAgentHarnessPlugin: vi.fn(async () => undefined),
}));

vi.mock("../../agents/embedded-agent.js", () => ({
  compactEmbeddedAgentSession: vi.fn(async () => ({ ok: true, compacted: false })),
  runEmbeddedAgent: (params: RunEmbeddedAgentParams) => runEmbeddedAgentMock(params),
  abortEmbeddedAgentRun: vi.fn(() => false),
}));
vi.mock("../../agents/embedded-agent-runner/runs.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/embedded-agent-runner/runs.js")>()),
  abortEmbeddedAgentRun: vi.fn(() => false),
}));

vi.mock("./agent-runner-memory.js", () => ({
  runSessionCompactionIfNeeded: (...args: unknown[]) => runSessionCompactionIfNeededMock(...args),
  runMemoryFlushIfNeeded: (...args: unknown[]) => runMemoryFlushIfNeededMock(...args),
}));

const { runReplyAgent } = await import("./agent-runner.js");
await import("./reply-payloads-dedupe.runtime.js");

beforeEach(() => setActivePluginRegistry(createEmptyPluginRegistry()));

type Hold = {
  promise: Promise<void>;
  release: () => void;
  settled: () => boolean;
};

function createHold(): Hold {
  let settled = false;
  const gate = createDeferred();
  return {
    promise: gate.promise.then(() => {
      settled = true;
    }),
    release: () => {
      settled = true;
      gate.resolve();
    },
    settled: () => settled,
  };
}

function replyText(result: ReplyPayload | ReplyPayload[] | undefined): string {
  const payload = Array.isArray(result) ? result[0] : result;
  return payload?.text ?? "";
}

function createChannel() {
  const deliveries: string[] = [];
  return {
    deliveries,
    onBlockReply: vi.fn(async (payload: ReplyPayload) => {
      if (payload.text) {
        deliveries.push(payload.text);
      }
    }),
  };
}

function createInboundRun(params: {
  sessionKey: string;
  prompt: string;
  messageId: string;
  provenance?: "external_user" | "inter_session";
}) {
  const agentId = params.sessionKey.split(":")[1]?.trim() || "main";
  const followupRun = createTestQueuedFollowupRun({
    prompt: params.prompt,
    summaryLine: params.prompt,
    enqueuedAt: Date.now(),
    run: {
      agentDir: "agent",
      workspaceDir: ".",
      sessionFile: "session.jsonl",
      config: {},
      skillsSnapshot: { prompt: "", skills: [] },
      verboseLevel: "off",
      elevatedLevel: "off",
      bashElevated: { enabled: false, allowed: false, defaultLevel: "off" },
      blockReplyBreak: "message_end",
      skipProviderRuntimeHints: true,
      agentId,
      sessionId: `session-${params.messageId}`,
      sessionKey: params.sessionKey,
      messageProvider: "telegram",
      provider: MODEL.provider,
      model: MODEL.model,
      thinkLevel: "low",
      timeoutMs: 60_000,
      // Complete model facts keep this fake backend off provider discovery/state IO.
      thinkingCatalog: [
        { provider: MODEL.provider, id: MODEL.model, input: ["text"], reasoning: true },
      ],
      inputProvenance:
        params.provenance === "inter_session"
          ? {
              kind: "inter_session",
              sourceTool: "sessions_send",
              sourceSessionKey: ELM_SESSION_KEY,
            }
          : { kind: "external_user" },
    },
  });
  followupRun.prompt = params.prompt;
  followupRun.summaryLine = params.prompt;
  followupRun.messageId = params.messageId;
  followupRun.originatingChannel = "telegram";
  followupRun.originatingTo = "chat";
  const sessionCtx = {
    Provider: "telegram",
    OriginatingChannel: "telegram",
    OriginatingTo: "chat",
    AccountId: "default",
    ChatType: "direct",
    MessageSid: params.messageId,
    Body: params.prompt,
  } as unknown as TemplateContext;
  const resolvedQueue = {
    mode: "steer",
    debounceMs: 0,
    cap: 20,
    dropPolicy: "summarize",
  } as QueueSettings;
  return { followupRun, sessionCtx, resolvedQueue };
}

function holdSession(sessionKey: string): Promise<void> {
  const lane = resolveSessionLane(sessionKey);
  return enqueueCommandInLane(lane, () => sessionHolds.get(sessionKey)!.promise);
}

const sessionHolds = new Map<string, Hold>();

function armSessionHold(sessionKey: string): Hold {
  const hold = createHold();
  sessionHolds.set(sessionKey, hold);
  return hold;
}

async function sendInbound(params: {
  sessionKey: string;
  prompt: string;
  messageId: string;
  provenance?: "external_user" | "inter_session";
  active: ReplyOperation;
  awaitCompletion?: boolean;
}) {
  const channel = createChannel();
  const inbound = createInboundRun(params);
  const startedAt = performance.now();
  const pending = runReplyAgent({
    commandBody: params.prompt,
    followupRun: inbound.followupRun,
    queueKey: params.sessionKey,
    resolvedQueue: inbound.resolvedQueue,
    shouldSteer: true,
    shouldFollowup: true,
    isActive: true,
    isRunActive: () => params.active.phase === "running" && !params.active.result,
    typing: createMockTypingController(),
    sessionCtx: inbound.sessionCtx,
    sessionKey: params.sessionKey,
    defaultModel: `${MODEL.provider}/${MODEL.model}`,
    resolvedVerboseLevel: "off",
    isNewSession: false,
    blockStreamingEnabled: false,
    resolvedBlockStreamingBreak: "message_end",
    shouldInjectGroupIntro: false,
    typingMode: "instant",
    opts: { onBlockReply: channel.onBlockReply },
  });
  let outcome: "reply" | "budget" = "budget";
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const result = params.awaitCompletion
    ? await pending
    : await Promise.race([
        pending.then((value) => {
          outcome = "reply";
          return value;
        }),
        new Promise<undefined>((resolve) => {
          budgetTimer = setTimeout(() => resolve(undefined), REPLY_BUDGET_MS);
        }),
      ]);
  clearTimeout(budgetTimer);
  return {
    channel,
    elapsedMs: Math.round(performance.now() - startedAt),
    outcome,
    pending,
    result,
    text: replyText(result) || channel.deliveries[0] || "",
  };
}

function resetRoutingTestState() {
  for (const hold of sessionHolds.values()) {
    hold.release();
  }
  sessionHolds.clear();
  history.clear();
  mainHold?.release();
  mainHold = undefined;
  agentReplyHold?.release();
  agentReplyHold = undefined;
  resetCommandQueueStateForTest();
  replyRunTesting.resetReplyRunRegistry();
  clearFollowupQueueForTest(OWNER_SESSION_KEY);
  clearFollowupQueueForTest(OAK_SESSION_KEY);
  clearFollowupQueueForTest(ELM_SESSION_KEY);
  runEmbeddedAgentMock.mockReset();
  runSessionCompactionIfNeededMock.mockReset();
  runMemoryFlushIfNeededMock.mockReset();
}
afterEach(resetRoutingTestState);

let mainHold: Hold | undefined;
let agentReplyHold: Hold | undefined;

function installFastModel() {
  runMemoryFlushIfNeededMock.mockResolvedValue({ sessionEntry: undefined, outcome: "skipped" });
  runSessionCompactionIfNeededMock.mockImplementation(
    async (params: { sessionEntry?: unknown }) => {
      return params.sessionEntry;
    },
  );
  runEmbeddedAgentMock.mockImplementation(async (params: RunEmbeddedAgentParams) => {
    if (params.prompt === "from-elm" && agentReplyHold) {
      const lane =
        params.liveInboundSessionLane?.trim() ||
        resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
      await enqueueCommandInLane(lane, () => agentReplyHold!.promise);
    } else {
      const globalLane = params.lane?.trim() || CommandLane.Main;
      const mainLane: string = CommandLane.Main;
      if (globalLane === mainLane) {
        await enqueueCommandInLane(CommandLane.Main, async () => undefined);
      }
      const lane =
        params.liveInboundSessionLane?.trim() ||
        resolveSessionLane(params.sessionKey?.trim() || params.sessionId);
      await enqueueCommandInLane(lane, async () => undefined);
    }
    const prompt = params.prompt ?? "";
    if (params.sessionPersistence !== "detached") {
      const fixture = history.get(params.sessionKey!);
      if (fixture) {
        const writer = await claimAgentSessionWriter({ ...params, sessionTarget: fixture.target });
        expect(writer).toEqual({
          expectedLifecycleRevision: fixture.entry.lifecycleRevision,
          expectedWriterRunId: fixture.entry.activeWriterRunId,
        });
        const manager = fixture.manager;
        manager.appendMessage({
          role: "assistant",
          content: [{ type: "text", text: `reply:${prompt}` }],
          api: "openai-responses",
          provider: MODEL.provider,
          model: MODEL.model,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: Date.now(),
        });
      }
    }
    return {
      payloads: [{ text: `reply:${prompt}` }],
      meta: { agentMeta: { usage: { input: 1, output: 1 } } },
    };
  });
}

describe("live inbound routing", () => {
  // Warm the reply pipeline's lazy modules before measuring routing latency.
  // No provider or state store is involved: the same fake backend/boundaries
  // serve every turn, including this unmeasured initialization.
  beforeAll(async () => {
    setActivePluginRegistry(createEmptyPluginRegistry());
    installFastModel();
    const hold = armSessionHold(OWNER_SESSION_KEY);
    const block = holdSession(OWNER_SESSION_KEY);
    const active = createReplyOperation({
      sessionKey: OWNER_SESSION_KEY,
      sessionId: "session-warmup",
      resetTriggered: false,
      turnKind: "visible",
    });
    active.setPhase("running");
    try {
      await sendInbound({
        sessionKey: OWNER_SESSION_KEY,
        prompt: "warmup",
        messageId: "warmup",
        active,
        awaitCompletion: true,
      });
    } finally {
      hold.release();
      await block;
      resetRoutingTestState();
    }
  });
  it("saves the live assistant reply in the real session history", async () => {
    installFastModel();
    const target = {
      agentId: "main",
      sessionId: "session-history",
      sessionKey: OWNER_SESSION_KEY,
      storePath: "sessions.json",
    };
    const fixture = {
      target,
      entry: {
        sessionId: target.sessionId,
        updatedAt: 1,
        lifecycleRevision: "history-revision",
        activeWriterRunId: "held-writer",
      } as InternalSessionEntry,
      manager: SessionManager.inMemory(),
    };
    history.set(OWNER_SESSION_KEY, fixture);
    const hold = armSessionHold(OWNER_SESSION_KEY);
    const block = holdSession(OWNER_SESSION_KEY);
    const active = createReplyOperation({
      sessionKey: OWNER_SESSION_KEY,
      sessionId: "session-history",
      resetTriggered: false,
      turnKind: "visible",
    });
    active.setPhase("running");
    const reply = await sendInbound({
      sessionKey: OWNER_SESSION_KEY,
      prompt: "history ping",
      messageId: "history",
      active,
      awaitCompletion: true,
    });
    try {
      expect(reply.text).toBe("reply:history ping");
      // Read the canonical chat's stored entries through a fresh history view.
      // The store is in-memory; routing tests must never open a state database.
      expect(
        SessionManager.fromEntries(fixture.manager.getEntries()).buildSessionContext().messages,
      ).toContainEqual(
        expect.objectContaining({
          role: "assistant",
          content: [{ type: "text", text: "reply:history ping" }],
        }),
      );
      expect(hold.settled()).toBe(false);
      expect(fixture.entry.activeWriterRunId).toBe("held-writer");
    } finally {
      hold.release();
      await Promise.all([block, reply.pending]);
    }
  });

  it("cancelling the chat aborts every live inbound operation for that session", async () => {
    const active = createReplyOperation({
      sessionKey: OWNER_SESSION_KEY,
      sessionId: "session-cancel",
      resetTriggered: false,
      turnKind: "visible",
    });
    active.setPhase("running");
    const gate = createHold();
    const operations: ReplyOperation[] = [];
    const pending = ["external_user", "inter_session"].map((kind, index) => {
      const { followupRun } = createInboundRun({
        sessionKey: OWNER_SESSION_KEY,
        messageId: `cancel-${index}`,
        prompt: "cancel me",
        provenance: kind as "external_user" | "inter_session",
      });
      followupRun.run.sessionId = "session-cancel";
      return startLiveInboundReply({
        followupRun,
        sessionKey: OWNER_SESSION_KEY,
        run: async (operation) => {
          operation.setPhase("running");
          operations.push(operation);
          await gate.promise;
        },
      });
    });
    expect(operations).toHaveLength(2);
    const outcome = abortSessionRunTargetWithOutcome({
      agentId: "main",
      key: OWNER_SESSION_KEY,
      sessionId: "session-cancel",
    });
    try {
      expect(outcome.aborted).toBe(true);
      expect(active.abortSignal.aborted).toBe(true);
      expect(operations.map((op) => op.abortSignal.aborted)).toEqual([true, true]);
    } finally {
      gate.release();
      await Promise.all(pending);
      await outcome.retirement;
    }
  });

  it("answers a new message within 5s while a 60s-class turn holds the chat", async () => {
    installFastModel();
    setCommandLaneConcurrency(CommandLane.Main, 1);
    mainHold = createHold();
    const mainBlock = enqueueCommandInLane(CommandLane.Main, () => mainHold!.promise);
    const sessionHold = armSessionHold(OWNER_SESSION_KEY);
    const sessionBlock = holdSession(OWNER_SESSION_KEY);
    const active = createReplyOperation({
      sessionKey: OWNER_SESSION_KEY,
      sessionId: "session-long",
      resetTriggered: false,
      turnKind: "visible",
    });
    active.setPhase("running");

    const reply = await sendInbound({
      sessionKey: OWNER_SESSION_KEY,
      prompt: "Are you there?",
      messageId: "owner-2",
      provenance: "external_user",
      active,
    });

    expect(reply.outcome, `no reply after ${reply.elapsedMs}ms while the turn was still held`).toBe(
      "reply",
    );
    expect(reply.text, `reply text after ${reply.elapsedMs}ms`).toBe("reply:Are you there?");
    expect(reply.elapsedMs).toBeLessThan(REPLY_BUDGET_MS);
    expect(sessionHold.settled()).toBe(false);
    expect(mainHold.settled()).toBe(false);
    expect(active.result).toBeNull();
    expect(active.abortSignal.aborted).toBe(false);
    expect(runEmbeddedAgentMock).toHaveBeenCalled();
    const modelCall = runEmbeddedAgentMock.mock.calls[0]?.[0] as RunEmbeddedAgentParams;
    expect(modelCall.provider).toBe(MODEL.provider);
    expect(modelCall.model).toBe(MODEL.model);
    expect(modelCall.sessionPersistence).toBe("durable");
    expect(modelCall.liveInboundSessionLane).toBe(`live-inbound:owner:${OWNER_SESSION_KEY}`);
    expect(modelCall.lane).not.toBe(CommandLane.Main);
    expect(getCommandLaneSnapshot(resolveSessionLane(OWNER_SESSION_KEY)).activeCount).toBe(1);

    sessionHold.release();
    mainHold.release();
    await Promise.all([sessionBlock, mainBlock, reply.pending]);
  });

  it("answers the owner within 5s while two agents are messaging each other", async () => {
    installFastModel();
    const oakHold = armSessionHold(OAK_SESSION_KEY);
    const elmHold = armSessionHold(ELM_SESSION_KEY);
    const oakBlock = holdSession(OAK_SESSION_KEY);
    const elmBlock = holdSession(ELM_SESSION_KEY);
    const oakActive = createReplyOperation({
      sessionKey: OAK_SESSION_KEY,
      sessionId: "session-oak",
      resetTriggered: false,
      turnKind: "visible",
    });
    oakActive.setPhase("running");
    const elmActive = createReplyOperation({
      sessionKey: ELM_SESSION_KEY,
      sessionId: "session-elm",
      resetTriggered: false,
      turnKind: "visible",
    });
    elmActive.setPhase("running");

    const betweenAgents = await sendInbound({
      sessionKey: OAK_SESSION_KEY,
      prompt: "status from elm",
      messageId: "elm-to-oak",
      provenance: "inter_session",
      active: oakActive,
    });
    expect(betweenAgents.outcome).toBe("reply");
    expect(betweenAgents.text).toBe("reply:status from elm");
    expect(betweenAgents.elapsedMs).toBeLessThan(REPLY_BUDGET_MS);
    const agentCall = runEmbeddedAgentMock.mock.calls.at(-1)?.[0] as RunEmbeddedAgentParams;
    expect(agentCall.provider).toBe(MODEL.provider);
    expect(agentCall.model).toBe(MODEL.model);
    expect(agentCall.liveInboundSessionLane).toBe(`live-inbound:agent:${OAK_SESSION_KEY}`);
    await betweenAgents.pending;

    agentReplyHold = createHold();
    const agentPending = sendInbound({
      sessionKey: OAK_SESSION_KEY,
      prompt: "from-elm",
      messageId: "elm-holds",
      provenance: "inter_session",
      active: oakActive,
    });
    await vi.waitFor(() => {
      expect(getCommandLaneSnapshot(`live-inbound:agent:${OAK_SESSION_KEY}`).activeCount).toBe(1);
    });

    const owner = await sendInbound({
      sessionKey: OAK_SESSION_KEY,
      prompt: "owner ping",
      messageId: "owner-while-agents",
      provenance: "external_user",
      active: oakActive,
    });
    expect(owner.outcome, `owner waited ${owner.elapsedMs}ms behind agent traffic`).toBe("reply");
    expect(owner.text).toBe("reply:owner ping");
    expect(owner.elapsedMs).toBeLessThan(REPLY_BUDGET_MS);
    expect(agentReplyHold.settled()).toBe(false);
    expect(oakActive.result).toBeNull();
    expect(elmActive.result).toBeNull();
    const ownerCall = runEmbeddedAgentMock.mock.calls.at(-1)?.[0] as RunEmbeddedAgentParams;
    expect(ownerCall.liveInboundSessionLane).toBe(`live-inbound:owner:${OAK_SESSION_KEY}`);
    expect(ownerCall.provider).toBe(MODEL.provider);
    expect(ownerCall.model).toBe(MODEL.model);

    agentReplyHold.release();
    oakHold.release();
    elmHold.release();
    await Promise.all([oakBlock, elmBlock, (await agentPending).pending, owner.pending]);
  });
});
