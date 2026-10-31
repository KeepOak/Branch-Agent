// A held chat turn keeps its lane. A new inbound reply uses a separate lane
// so it can be answered while that work continues.
import { resolveSessionLane } from "../../agents/embedded-agent-runner/lanes.js";
import { logVerbose } from "../../globals.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { resolveSendableOutboundReplyParts } from "../../infra/outbound/reply-payload-parts.js";
import { getCommandLaneSnapshot, setCommandLaneConcurrency } from "../../process/command-queue.js";
import { isSessionLaneHeldByPredecessor } from "../../process/session-handoff-lease-gate.js";
import type { InputProvenance } from "../../sessions/input-provenance.js";
import { createLazyRuntimeModule } from "../../shared/lazy-runtime.js";
import { isSilentReplyText } from "../tokens.js";
import type { ReplyPayload } from "../types.js";
import type { InternalGetReplyOptions } from "./get-reply.types.js";
import { trackLiveInboundOperation } from "./live-inbound-operations.js";
import type { FollowupRun, QueueSettings } from "./queue/types.js";
import { createReplyOperation, type ReplyOperation } from "./reply-run-registry.js";
import { replyRunState } from "./reply-run-registry.state.js";

const LIVE_INBOUND_OWNER_GLOBAL_LANE = "live-inbound:owner";
const LIVE_INBOUND_AGENT_GLOBAL_LANE = "live-inbound:agent";
const OWNER_GLOBAL_CONCURRENCY = 16;
const AGENT_GLOBAL_CONCURRENCY = 8;

const loadTranscriptRuntime = createLazyRuntimeModule(
  () => import("../../config/sessions/transcript.runtime.js"),
);

type LiveInboundClass = "owner" | "agent";
type ReplyResult = ReplyPayload | ReplyPayload[] | undefined;

/** Owner messages get their own lanes so agent traffic cannot sit ahead of them. */
function classifyLiveInbound(provenance: InputProvenance | undefined): LiveInboundClass {
  if (provenance?.kind === "inter_session" || provenance?.kind === "internal_system") {
    return "agent";
  }
  return "owner";
}

function liveInboundSessionLane(kind: LiveInboundClass, sessionKey: string): string {
  return "live-inbound:" + kind + ":" + sessionKey;
}

function liveInboundGlobalLane(kind: LiveInboundClass): string {
  return kind === "owner" ? LIVE_INBOUND_OWNER_GLOBAL_LANE : LIVE_INBOUND_AGENT_GLOBAL_LANE;
}

/** Unknown lanes default to one slot. Live replies must not share that bottleneck. */
function ensureLiveInboundGlobalCapacity(): void {
  setCommandLaneConcurrency(LIVE_INBOUND_OWNER_GLOBAL_LANE, OWNER_GLOBAL_CONCURRENCY);
  setCommandLaneConcurrency(LIVE_INBOUND_AGENT_GLOBAL_LANE, AGENT_GLOBAL_CONCURRENCY);
}

function isInboundSessionBusy(sessionKey: string): boolean {
  const lane = resolveSessionLane(sessionKey);
  if (getCommandLaneSnapshot(lane).activeCount > 0) {
    return true;
  }
  return isSessionLaneHeldByPredecessor(lane);
}

export function shouldStartLiveInboundReply(params: {
  liveInbound?: boolean;
  followupAlreadyLive?: boolean;
  isHeartbeat: boolean;
  resetTriggered: boolean;
  queueMode: QueueSettings["mode"];
  messageInjectionDisposition: string;
  sessionKey?: string;
}): boolean {
  if (params.liveInbound || params.followupAlreadyLive) {
    return false;
  }
  if (params.isHeartbeat || params.resetTriggered || params.queueMode === "interrupt") {
    return false;
  }
  if (params.messageInjectionDisposition === "accepted") {
    return false;
  }
  const sessionKey = params.sessionKey?.trim();
  if (!sessionKey) {
    return false;
  }
  return isInboundSessionBusy(sessionKey);
}

function createLiveInboundOperationId(
  kind: LiveInboundClass,
  messageId: string | undefined,
): string {
  const source = messageId?.trim() || "turn";
  const nonce = Math.random().toString(36).slice(2, 8);
  return "live-inbound-" + kind + "-" + source + "-" + Date.now().toString(36) + "-" + nonce;
}

/**
 * The side operation carries the chat's real session id, because admission and
 * session reads key on it. The held turn keeps the chat's session-id lookups
 * (stop, compaction aborts, end waits), so restore them after registering.
 */
function createLiveInboundOperation(params: {
  operationKey: string;
  sessionId: string;
  agentId?: string;
}): ReplyOperation {
  const previousActiveKey = replyRunState.activeKeysBySessionId.get(params.sessionId);
  const previousWaitKey = replyRunState.waitKeysBySessionId.get(params.sessionId);
  const operation = createReplyOperation({
    sessionKey: params.operationKey,
    sessionId: params.sessionId,
    agentId: params.agentId,
    resetTriggered: false,
    turnKind: "visible",
  });
  if (previousActiveKey && replyRunState.activeRunsByKey.has(previousActiveKey)) {
    replyRunState.activeKeysBySessionId.set(params.sessionId, previousActiveKey);
  }
  if (previousWaitKey) {
    replyRunState.waitKeysBySessionId.set(params.sessionId, previousWaitKey);
  }
  return operation;
}

function toPayloadList(result: ReplyResult): ReplyPayload[] {
  if (!result) {
    return [];
  }
  return Array.isArray(result) ? result : [result];
}

/** The visible text of a live reply: streamed blocks first, then final payloads not already sent. */
export function resolveLiveInboundTranscriptReply(params: {
  delivered: readonly ReplyPayload[];
  result: ReplyResult;
}): { text: string; mediaUrls: string[] } | undefined {
  const texts: string[] = [];
  const mediaUrls: string[] = [];
  const seen = new Set<string>();
  for (const payload of [...params.delivered, ...toPayloadList(params.result)]) {
    if (payload.isReasoning) {
      continue;
    }
    const parts = resolveSendableOutboundReplyParts(payload);
    const text = parts.trimmedText;
    const visibleText = text && !isSilentReplyText(text) ? text : "";
    const key = visibleText + "\u0000" + parts.mediaUrls.join("\u0000");
    if ((!visibleText && parts.mediaUrls.length === 0) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    if (visibleText) {
      texts.push(visibleText);
    }
    mediaUrls.push(...parts.mediaUrls);
  }
  if (texts.length === 0 && mediaUrls.length === 0) {
    return undefined;
  }
  return { text: texts.join("\n\n"), mediaUrls };
}

/**
 * The live run keeps its working session off the chat's writer: a durable run
 * claims that writer and supersedes the held turn. The reply the user saw is
 * written to the chat transcript here instead, the same way delivered sends are.
 */
async function writeLiveInboundReplyToTranscript(params: {
  followupRun: FollowupRun;
  sessionKey: string;
  storePath?: string;
  idempotencyKey: string;
  reply: { text: string; mediaUrls: string[] };
}): Promise<void> {
  const run = params.followupRun.run;
  try {
    const { appendAssistantMessageToSessionTranscript } = await loadTranscriptRuntime();
    const outcome = await appendAssistantMessageToSessionTranscript({
      sessionKey: params.sessionKey,
      ...(run.agentId ? { agentId: run.agentId } : {}),
      ...(run.sessionId ? { expectedSessionId: run.sessionId } : {}),
      ...(params.storePath ? { storePath: params.storePath } : {}),
      text: params.reply.text,
      ...(params.reply.mediaUrls.length > 0 ? { mediaUrls: params.reply.mediaUrls } : {}),
      idempotencyKey: params.idempotencyKey,
      ...(run.config ? { config: run.config } : {}),
      updateMode: "inline",
    });
    if (!outcome.ok) {
      logVerbose(
        "live inbound reply was sent but not written to the chat transcript: " + outcome.reason,
      );
    }
  } catch (error) {
    logVerbose(
      "live inbound reply was sent but not written to the chat transcript: " +
        formatErrorMessage(error),
    );
  }
}

/**
 * Marks the run as a live reply and gives it a side operation so it does not
 * take or abort the chat's active reply slot. The side operation is recorded
 * under the chat, so cancelling the chat stops it too.
 */
export async function startLiveInboundReply(params: {
  followupRun: FollowupRun;
  sessionKey: string;
  storePath?: string;
  opts?: InternalGetReplyOptions;
  run: (
    operation: ReplyOperation,
    opts: InternalGetReplyOptions | undefined,
  ) => Promise<ReplyResult>;
}): Promise<ReplyResult> {
  const kind = classifyLiveInbound(params.followupRun.run.inputProvenance);
  ensureLiveInboundGlobalCapacity();
  const sessionLane = liveInboundSessionLane(kind, params.sessionKey);
  params.followupRun.liveInbound = true;
  params.followupRun.liveInboundSessionLane = sessionLane;
  params.followupRun.liveInboundGlobalLane = liveInboundGlobalLane(kind);
  const sideOperationId = createLiveInboundOperationId(kind, params.followupRun.messageId);
  const chatSessionId = params.followupRun.run.sessionId?.trim() || sideOperationId;
  const operation = createLiveInboundOperation({
    operationKey: sessionLane + ":op:" + sideOperationId,
    sessionId: chatSessionId,
    agentId: params.followupRun.run.agentId,
  });
  const forget = trackLiveInboundOperation({
    operation,
    chatSessionKey: params.sessionKey,
    ...(params.followupRun.run.sessionId
      ? { chatSessionId: params.followupRun.run.sessionId }
      : {}),
  });
  const delivered: ReplyPayload[] = [];
  const onBlockReply = params.opts?.onBlockReply;
  const opts: InternalGetReplyOptions | undefined = onBlockReply
    ? {
        ...params.opts,
        onBlockReply: async (...args: Parameters<typeof onBlockReply>) => {
          await onBlockReply(...args);
          delivered.push(args[0]);
        },
      }
    : params.opts;
  let result: ReplyResult;
  try {
    result = await params.run(operation, opts);
  } finally {
    forget();
    if (!operation.result) {
      operation.complete();
    }
    const reply =
      params.followupRun.liveInboundDetached === true
        ? resolveLiveInboundTranscriptReply({ delivered, result })
        : undefined;
    if (reply) {
      await writeLiveInboundReplyToTranscript({
        followupRun: params.followupRun,
        sessionKey: params.sessionKey,
        storePath: params.storePath,
        idempotencyKey: "live-inbound:" + params.sessionKey + ":" + sideOperationId,
        reply,
      });
    }
  }
  return result;
}
