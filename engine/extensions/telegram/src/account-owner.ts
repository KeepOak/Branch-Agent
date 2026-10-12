import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { resolveAgentRoute } from "branch/plugin-sdk/routing";

/** Resolves the agent that owns account-scoped Telegram runtime state. */
export function resolveTelegramAccountOwnerAgentId(params: {
  cfg: BranchConfig;
  accountId?: string | null;
}): string {
  return resolveAgentRoute({
    cfg: params.cfg,
    channel: "telegram",
    accountId: params.accountId,
  }).agentId;
}
