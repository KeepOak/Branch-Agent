import { appendAssistantMirrorMessageByIdentity } from "../../plugin-sdk/session-transcript-runtime.js";
import type { ReplyPayload } from "../types.js";
import type { FollowupRun } from "./queue/types.js";

/** Publish side-lane output without replacing the busy turn's transcript writer. */
export async function persistLiveInboundReply(params: {
  followupRun: FollowupRun;
  sessionKey?: string;
  storePath?: string;
  runId: string;
  signal?: AbortSignal;
  payloads?: ReplyPayload[];
}): Promise<void> {
  if (!params.followupRun.liveInbound) {
    return;
  }
  const run = params.followupRun.run;
  const sessionKey = params.sessionKey ?? run.sessionKey;
  if (!sessionKey) {
    throw new Error("Live inbound reply requires a session key");
  }
  for (const [index, payload] of (params.payloads ?? []).entries()) {
    if (
      payload.isReasoning ||
      payload.isError ||
      (!payload.text && !payload.mediaUrl && !payload.mediaUrls?.length)
    ) {
      continue;
    }
    params.signal?.throwIfAborted();
    const appended = await appendAssistantMirrorMessageByIdentity({
      agentId: run.agentId,
      sessionKey,
      sessionId: run.sessionId,
      storePath: params.storePath,
      config: run.config,
      signal: params.signal,
      text: payload.text,
      mediaUrls: payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : undefined),
      idempotencyKey: `live-inbound:${params.runId}:${index}`,
    });
    if (!appended.ok) {
      throw new Error("Live inbound reply persistence failed: " + appended.reason);
    }
  }
}
