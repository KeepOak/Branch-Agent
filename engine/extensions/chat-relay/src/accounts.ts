import { createAccountListHelpers } from "branch/plugin-sdk/account-helpers";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "branch/plugin-sdk/account-id";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export const CHAT_RELAY_CHANNEL_ID = "chat-relay" as const;

export type RelayAccountConfig = {
  name?: string;
  enabled?: boolean;
  url?: string;
  platform?: string;
  botId?: string;
  identities?: { platform: string; botId: string }[];
  allowFrom?: string[];
  groupAllowFrom?: string[];
  groupPolicy?: "open" | "allowlist" | "disabled";
  defaultTo?: string;
  accounts?: Record<string, RelayAccountConfig>;
  defaultAccount?: string;
};

const {
  listAccountIds,
  resolveDefaultAccountId,
  resolveAccountConfig,
} = createAccountListHelpers<RelayAccountConfig>(CHAT_RELAY_CHANNEL_ID, {
  normalizeAccountId,
  omitKeys: ["defaultAccount"],
  implicitDefaultAccount: { channelKeys: ["url"] },
});

export const listRelayAccountIds = listAccountIds;
export const resolveDefaultRelayAccountId = resolveDefaultAccountId;

export function resolveRelayAccount(params: { cfg: BranchConfig; accountId?: string | null }) {
  const accountId = normalizeAccountId(params.accountId ?? resolveDefaultAccountId(params.cfg));
  const merged = resolveAccountConfig(params.cfg, accountId);
  const channel = params.cfg.channels?.[CHAT_RELAY_CHANNEL_ID] as RelayAccountConfig | undefined;
  const identities = merged.identities?.length ? merged.identities : merged.platform ? [{ platform: merged.platform, botId: merged.botId ?? "" }] : [];
  return {
    accountId,
    name: merged.name,
    // Relay spends a connector service and can send messages: explicit opt-in.
    enabled: channel?.enabled === true && merged.enabled !== false,
    configured: Boolean(merged.url?.trim() && identities.length),
    url: merged.url?.trim() ?? "",
    identities,
    allowFrom: merged.allowFrom,
    groupAllowFrom: merged.groupAllowFrom,
    groupPolicy: merged.groupPolicy,
    defaultTo: merged.defaultTo,
  };
}

export type ResolvedRelayAccount = ReturnType<typeof resolveRelayAccount>;
export { DEFAULT_ACCOUNT_ID };
