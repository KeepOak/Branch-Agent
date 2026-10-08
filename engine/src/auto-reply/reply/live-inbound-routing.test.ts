// A held session turn must not park the next inbound reply.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSessionLane } from "../../agents/embedded-agent-runner/lanes.js";
import type { RunEmbeddedAgentParams } from "../../agents/embedded-agent-runner/run/params.js";
import {
  enqueueCommandInLane,
  getCommandLaneSnapshot,
  setCommandLaneConcurrency,
} from "../../process/command-queue.js";
import { resetCommandQueueStateForTest } from "../../process/command-queue.test-support.js";
import { CommandLane } from "../../process/lanes.js";
import { createDeferred } from "../../../test/helpers/promise.js";
import type { TemplateContext } from "../templating.js";
import type { ReplyPayload } from "../types.js";
import { createTestFollowupRun } from "./agent-runner.test-fixtures.js";
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

vi.mock("../../agents/embedded-agent.js", () => ({
  compactEmbeddedAgentSession: vi.fn(async () => ({ ok: true, compacted: false })),
  runEmbeddedAgent: (params: RunEmbeddedAgentParams) => runEmbeddedAgentMock(params),
}));

vi.mock("./agent-runner-memory.js", () => ({
  runSessionCompactionIfNeeded: (...args: unknown[]) => runSessionCompactionIfNeededMock(...args),
  runMemoryFlushIfNeeded: (...args: unknown[]) => runMemoryFlushIfNeededMock(...args),
}));

const { runReplyAgent } = await import("./agent-runner.js");

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
  const followupRun = createTestFollowupRun({
    agentId,
    sessionId: `session-${params.messageId}`,
    sessionKey: params.sessionKey,
    messageProvider: "telegram",
    provider: MODEL.provider,
    model: MODEL.model,
    thinkLevel: "low",
    timeoutMs: 60_000,
    inputProvenance:
      params.provenance === "inter_session"
        ? { kind: "inter_session", sourceTool: "sessions_send", sourceSessionKey: ELM_SESSION_KEY }
        : { kind: "external_user" },
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
  const result = await Promise.race([
    pending.then((value) => {
      outcome = "reply";
      return value;
    }),
    new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), REPLY_BUDGET_MS);
    }),
  ]);
  return {
    channel,
    elapsedMs: Math.round(performance.now() - startedAt),
    outcome,
    pending,
    result,
    text: replyText(result) || channel.deliveries[0] || "",
  };
}

afterEach(() => {
  for (const hold of sessionHolds.values()) {
    hold.release();
  }
  sessionHolds.clear();
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
});

let mainHold: Hold | undefined;
let agentReplyHold: Hold | undefined;

function installFastModel() {
  runMemoryFlushIfNeededMock.mockResolvedValue({ sessionEntry: undefined, outcome: "skipped" });
  runSessionCompactionIfNeededMock.mockImplementation(async (params: { sessionEntry?: unknown }) => {
    return params.sessionEntry;
  });
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
    return {
      payloads: [{ text: `reply:${prompt}` }],
      meta: { agentMeta: { usage: { input: 1, output: 1 } } },
    };
  });
}

describe("live inbound routing", () => {

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
    expect(modelCall.sessionPersistence).toBe("detached");
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
