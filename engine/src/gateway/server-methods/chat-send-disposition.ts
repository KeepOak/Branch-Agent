import type {
  ReplyMessageInjectionAttempt,
  ReplyMessageInjectionTarget,
} from "../../auto-reply/reply/reply-run-registry.js";

/** What a chat.send did to its thread, reported in the ack (openclaw sessions_send shape). */
export type ChatSendTargetDisposition = "steered" | "queued" | "started";

export type ChatSendDisposition = {
  targetDisposition: ChatSendTargetDisposition;
  /** The run that carries the message when it joined a running turn. */
  steeredRunId?: string;
};

/**
 * Decided before the ack leaves. "steered" means the running turn accepted the message
 * (injection acceptance is settled pre-ack). "queued" means the thread had a run at
 * admission and the message did not join it. "started" means no run was in the way.
 */
export function resolveChatSendDisposition(params: {
  injection: Pick<ReplyMessageInjectionAttempt, "targetRunId"> | undefined;
  target: Pick<ReplyMessageInjectionTarget, "runId"> | undefined;
  queuedBehindActiveRun: boolean;
}): ChatSendDisposition {
  if (params.injection) {
    const steeredRunId = params.injection.targetRunId ?? params.target?.runId;
    return {
      targetDisposition: "steered",
      ...(steeredRunId ? { steeredRunId } : {}),
    };
  }
  return { targetDisposition: params.queuedBehindActiveRun ? "queued" : "started" };
}
