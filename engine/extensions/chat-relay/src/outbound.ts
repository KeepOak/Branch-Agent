import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolveRelayAccount } from "./accounts.js";
import { parseRelayDescriptor, splitRelayText } from "./descriptor.js";
import { parseRelayTarget } from "./target.js";
import { activeRelayTransports, relayScopeFor } from "./gateway.js";

export async function sendRelayText(params: {
  cfg: BranchConfig;
  accountId?: string | null;
  to: string;
  text: string;
  replyToId?: string | number | null;
  threadId?: string | number | null;
}): Promise<string> {
  const account = resolveRelayAccount({ cfg: params.cfg, accountId: params.accountId });
  const transport = activeRelayTransports.get(account.accountId);
  if (!transport) throw new Error("Chat relay is not connected");
  const target = parseRelayTarget(params.to);
  if (!account.identities.some((identity) => identity.platform === target.platform)) {
    throw new Error(`Relay does not front platform ${target.platform}`);
  }
  const scope = relayScopeFor(account.accountId, params.to);
  const descriptor = transport.descriptorFor(target.platform) ?? parseRelayDescriptor({
    contract_version: 1, platform: target.platform, label: target.platform,
    max_message_length: 4096, len_unit: "chars",
  });
  let messageId = "";
  for (const [index, chunk] of splitRelayText(descriptor, params.text).entries()) {
    const result = await transport.sendOutbound({
      op: "send",
      chat_id: target.chatId,
      content: chunk,
      reply_to: index === 0 && params.replyToId != null ? String(params.replyToId) : null,
      metadata: {
        ...(params.threadId == null ? {} : { thread_id: String(params.threadId) }),
        ...scope,
        ...(target.scopeId ? { scope_id: target.scopeId } : {}),
        ...(target.userId ? { user_id: target.userId } : {}),
      },
    }, target.platform);
    if (result.success !== true) {
      throw new Error(typeof result.error === "string" ? result.error : "Relay send failed");
    }
    messageId = String(result.message_id ?? result.messageId ?? "");
  }
  return messageId;
}
