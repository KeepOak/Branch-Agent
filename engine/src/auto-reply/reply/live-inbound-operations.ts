// A live inbound reply runs on its own reply operation so it never takes the
// held turn's slot. Cancelling the chat must still stop it, so each side
// operation is recorded under the chat it answers.
import { chatRunBelongsToAgent } from "../../gateway/chat-run-owner.js";
import { agentSessionKeysMatchByRequestKey } from "../../routing/session-key.js";
import { resolveGlobalSet } from "../../shared/global-singleton.js";
import type { ReplyOperation } from "./reply-run-registry.contracts.js";

type LiveInboundOperationEntry = {
  operation: ReplyOperation;
  chatSessionKey: string;
  chatSessionId?: string;
};

const LIVE_INBOUND_OPERATIONS = resolveGlobalSet<LiveInboundOperationEntry>(
  Symbol.for("branch.liveInboundReplyOperations"),
  "close-and-restart",
);

/** Records a side operation under its chat. The returned function forgets it. */
export function trackLiveInboundOperation(entry: LiveInboundOperationEntry): () => void {
  const tracked = { ...entry };
  LIVE_INBOUND_OPERATIONS.add(tracked);
  return () => {
    LIVE_INBOUND_OPERATIONS.delete(tracked);
  };
}

/** Live replies still running for a chat, matched by the chat's own identity. */
export function resolveLiveInboundOperationsForChat(params: {
  sessionKey: string;
  sessionId?: string;
  agentId: string;
  defaultAgentId?: string;
}): ReplyOperation[] {
  const operations: ReplyOperation[] = [];
  for (const entry of LIVE_INBOUND_OPERATIONS) {
    if (entry.operation.result) {
      continue;
    }
    if (params.sessionId && entry.chatSessionId && entry.chatSessionId !== params.sessionId) {
      continue;
    }
    if (!agentSessionKeysMatchByRequestKey(entry.chatSessionKey, params.sessionKey)) {
      continue;
    }
    if (
      !chatRunBelongsToAgent(
        {
          agentId: entry.operation.agentId,
          sessionKey: entry.chatSessionKey,
          defaultAgentId: params.defaultAgentId,
        },
        params.agentId,
      )
    ) {
      continue;
    }
    operations.push(entry.operation);
  }
  return operations;
}
