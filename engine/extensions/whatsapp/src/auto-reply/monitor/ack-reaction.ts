import {
  createAckReactionHandle,
  type AckReactionHandle,
} from "branch/plugin-sdk/channel-feedback";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { logVerbose } from "branch/plugin-sdk/runtime-env";
import type { AdmittedWebInboundMessage } from "../../inbound/types.js";
import { sendReactionWhatsApp } from "../../send.js";
import { formatError } from "../../session.js";
import { resolveWhatsAppReactionEligibility } from "./reaction-eligibility.js";

export async function maybeSendAckReaction(params: {
  cfg: BranchConfig;
  msg: AdmittedWebInboundMessage;
  agentId: string;
  sessionKey: string;
  verbose: boolean;
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
}): Promise<AckReactionHandle | null> {
  const eligibility = await resolveWhatsAppReactionEligibility(params);
  if (eligibility.status === "disabled") {
    return null;
  }
  const { chatId, messageId, emoji, reactionOptions } = eligibility;

  params.info({ chatId, messageId, emoji }, "sending ack reaction");
  return createAckReactionHandle({
    ackReactionValue: emoji,
    send: () => sendReactionWhatsApp(chatId, messageId, emoji, reactionOptions),
    remove: () => sendReactionWhatsApp(chatId, messageId, "", reactionOptions),
    onSendError: (err) => {
      params.warn(
        {
          error: formatError(err),
          chatId,
          messageId,
        },
        "failed to send ack reaction",
      );
      logVerbose(`WhatsApp ack reaction failed for chat ${chatId}: ${formatError(err)}`);
    },
  });
}
