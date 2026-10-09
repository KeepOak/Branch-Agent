import {
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
} from "@branch/normalization-core/string-coerce";
import type { ChannelMessageActionName } from "../../channels/plugins/types.public.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { enforceMessageActionAllowlist } from "../../infra/outbound/outbound-policy.js";
import { readBooleanParam } from "../../plugin-sdk/boolean-param.js";
import { buildRunUserTurnIdempotencyKey } from "../../sessions/user-turn-transcript.metadata.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../../utils/message-channel.js";
import { jsonResult, readToolStringParam } from "./common.js";
import { getInProcessGatewayToolContext } from "./in-process-gateway.js";
import type { MessageToolOptions } from "./message-tool-discovery.js";

/** Only the current in-app route belongs to session storage; channel routes stay with adapters. */
export async function executeInAppReaction(input: {
  action: ChannelMessageActionName;
  params: Record<string, unknown>;
  currentChannelProvider?: string;
  cfg: BranchConfig;
  agentId?: string;
  options?: MessageToolOptions;
  currentSourceTurnId?: string;
  assertCurrent: () => void;
}) {
  const { action, params, options, cfg, agentId } = input;
  if (
    action !== "react" ||
    normalizeOptionalLowercaseString(input.currentChannelProvider) !== INTERNAL_MESSAGE_CHANNEL ||
    (normalizeOptionalString(params.channel) &&
      normalizeOptionalLowercaseString(params.channel) !== INTERNAL_MESSAGE_CHANNEL) ||
    [params.target, params.to, params.channelId, params.threadId].some(normalizeOptionalString) ||
    (Array.isArray(params.targets) && params.targets.length > 0)
  ) {
    return undefined;
  }
  enforceMessageActionAllowlist({ cfg, agentId, action });
  const context = getInProcessGatewayToolContext();
  if (!context || !options?.agentSessionKey || !options.sessionId || !agentId) {
    throw new Error("In-app reactions require the active Gateway and session.");
  }
  const messageId =
    readToolStringParam(params, "messageId") ?? readToolStringParam(params, "message_id");
  const currentMessageId =
    options.currentMessageId != null ? String(options.currentMessageId) : undefined;
  // WebChat's inbound MessageSid is the client run id, not the transcript row id.
  const sourceTurnId =
    !messageId || messageId === currentMessageId
      ? (normalizeOptionalString(input.currentSourceTurnId) ??
        (currentMessageId ? buildRunUserTurnIdempotencyKey(currentMessageId) : undefined))
      : undefined;
  if (!messageId && !sourceTurnId) {
    throw new Error("In-app reactions require a messageId.");
  }
  const { setAgentSessionReaction } =
    await import("../../gateway/server-methods/sessions-reactions.js");
  const result = await setAgentSessionReaction({
    context,
    cfg,
    agentId,
    sessionKey: options.agentSessionKey,
    sessionId: options.sessionId,
    messageId,
    sourceTurnId,
    emoji: readToolStringParam(params, "emoji", { required: true }),
    remove: readBooleanParam(params, "remove") === true,
    dryRun: readBooleanParam(params, "dryRun") === true,
    assertCurrent: () => {
      input.assertCurrent();
      if (getInProcessGatewayToolContext() !== context) {
        throw new Error("In-app reaction Gateway changed.");
      }
    },
  });
  return jsonResult(result);
}
