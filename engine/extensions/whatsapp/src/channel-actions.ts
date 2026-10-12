import { createActionGate } from "branch/plugin-sdk/channel-actions";
import type { ChannelMessageActionName } from "branch/plugin-sdk/channel-contract";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { listWhatsAppAccountIds, resolveWhatsAppAccount } from "./accounts.js";
import { resolveWhatsAppReactionLevel } from "./reaction-level.js";

function resolveEnabledWhatsAppAgentReactions(params: { cfg: BranchConfig; accountId?: string }) {
  if (!params.cfg.channels?.whatsapp) {
    return undefined;
  }
  const gate = createActionGate(params.cfg.channels.whatsapp.actions);
  if (!gate("reactions")) {
    return undefined;
  }
  const resolved = resolveWhatsAppReactionLevel({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return resolved.agentReactionsEnabled ? resolved : undefined;
}

export function resolveWhatsAppAgentReactionGuidance(params: {
  cfg: BranchConfig;
  accountId?: string;
}) {
  return resolveEnabledWhatsAppAgentReactions(params)?.agentReactionGuidance;
}

function hasAnyWhatsAppAccountWithAgentReactionsEnabled(cfg: BranchConfig) {
  if (!cfg.channels?.whatsapp) {
    return false;
  }
  return listWhatsAppAccountIds(cfg).some((accountId) => {
    const account = resolveWhatsAppAccount({ cfg, accountId });
    if (!account.enabled) {
      return false;
    }
    return Boolean(
      resolveEnabledWhatsAppAgentReactions({
        cfg,
        accountId,
      }),
    );
  });
}

export function describeWhatsAppMessageActions(params: {
  cfg: BranchConfig;
  accountId?: string | null;
}): { actions: ChannelMessageActionName[] } | null {
  if (!params.cfg.channels?.whatsapp) {
    return null;
  }
  const gate = createActionGate(params.cfg.channels.whatsapp.actions);
  const actions = new Set<ChannelMessageActionName>();
  const canReact =
    params.accountId != null
      ? Boolean(
          resolveEnabledWhatsAppAgentReactions({
            cfg: params.cfg,
            accountId: params.accountId,
          }),
        )
      : hasAnyWhatsAppAccountWithAgentReactionsEnabled(params.cfg);
  if (canReact) {
    actions.add("react");
  }
  if (gate("polls")) {
    actions.add("poll");
  }
  actions.add("upload-file");
  return { actions: Array.from(actions) };
}
