import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { getSessionEntry, resolveStorePath } from "branch/plugin-sdk/session-store-runtime";
import { resolveWhatsAppInboundPolicy } from "../../inbound-policy.js";
import { normalizeGroupActivation } from "./group-activation.runtime.js";

export async function resolveGroupActivationFor(params: {
  cfg: BranchConfig;
  accountId?: string | null;
  agentId: string;
  sessionKey: string;
  conversationId: string;
}) {
  const storePath = resolveStorePath(params.cfg.session?.store, {
    agentId: params.agentId,
  });
  const entry = getSessionEntry({
    storePath,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });
  const requireMention = resolveWhatsAppInboundPolicy({
    cfg: params.cfg,
    accountId: params.accountId,
  }).resolveConversationRequireMention(params.conversationId);
  const defaultActivation = !requireMention ? "always" : "mention";
  return normalizeGroupActivation(entry?.groupActivation) ?? defaultActivation;
}
