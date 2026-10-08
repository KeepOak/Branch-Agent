// A held chat turn keeps its lane. A new inbound reply uses a separate lane
// so it can be answered while that work continues.
import { resolveSessionLane } from "../../agents/embedded-agent-runner/lanes.js";
import { getCommandLaneSnapshot, setCommandLaneConcurrency } from "../../process/command-queue.js";
import { isSessionLaneHeldByPredecessor } from "../../process/session-handoff-lease-gate.js";
import type { InputProvenance } from "../../sessions/input-provenance.js";
import type { FollowupRun, QueueSettings } from "./queue/types.js";
import { createReplyOperation, type ReplyOperation } from "./reply-run-registry.js";

const LIVE_INBOUND_OWNER_GLOBAL_LANE = "live-inbound:owner";
const LIVE_INBOUND_AGENT_GLOBAL_LANE = "live-inbound:agent";
const OWNER_GLOBAL_CONCURRENCY = 16;
const AGENT_GLOBAL_CONCURRENCY = 8;

type LiveInboundClass = "owner" | "agent";

/** Owner messages get their own lanes so agent traffic cannot sit ahead of them. */
function classifyLiveInbound(provenance: InputProvenance | undefined): LiveInboundClass {
  if (provenance?.kind === "inter_session" || provenance?.kind === "internal_system") {
    return "agent";
  }
  return "owner";
}

function liveInboundSessionLane(kind: LiveInboundClass, sessionKey: string): string {
  return `live-inbound:${kind}:${sessionKey}`;
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

function createLiveInboundOperationSessionId(
  kind: LiveInboundClass,
  messageId: string | undefined,
): string {
  const source = messageId?.trim() || "turn";
  const nonce = Math.random().toString(36).slice(2, 8);
  return `live-inbound-${kind}-${source}-${Date.now().toString(36)}-${nonce}`;
}

/**
 * Marks the run as a live reply and gives it a side operation so it does not
 * take or abort the chat's active reply slot.
 */
export async function startLiveInboundReply<T>(params: {
  followupRun: FollowupRun;
  sessionKey: string;
  upstreamAbortSignal?: AbortSignal;
  run: (operation: ReplyOperation) => Promise<T>;
}): Promise<T> {
  const kind = classifyLiveInbound(params.followupRun.run.inputProvenance);
  ensureLiveInboundGlobalCapacity();
  const sessionLane = liveInboundSessionLane(kind, params.sessionKey);
  params.followupRun.liveInbound = true;
  params.followupRun.liveInboundSessionLane = sessionLane;
  params.followupRun.liveInboundGlobalLane = liveInboundGlobalLane(kind);
  const sideSessionId = createLiveInboundOperationSessionId(kind, params.followupRun.messageId);
  const operation = createReplyOperation({
    sessionKey: `${sessionLane}:op:${sideSessionId}`,
    sessionId: sideSessionId,
    sessionTarget: {
      sessionKey: params.sessionKey,
      sessionId: params.followupRun.run.sessionId,
    },
    agentId: params.followupRun.run.agentId,
    resetTriggered: false,
    turnKind: "visible",
    upstreamAbortSignal: params.upstreamAbortSignal,
  });
  try {
    return await params.run(operation);
  } finally {
    operation.complete();
  }
}
