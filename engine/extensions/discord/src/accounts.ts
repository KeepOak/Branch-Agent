import {
  createAccountActionGate,
  createAccountListHelpers,
} from "branch/plugin-sdk/account-helpers";
import { normalizeAccountId } from "branch/plugin-sdk/account-id";
import {
  mapAllowFromEntries,
  normalizeChannelDmPolicy,
  type ChannelDmPolicy,
} from "branch/plugin-sdk/channel-config-helpers";
import { resolveConfiguredFromCredentialStatuses } from "branch/plugin-sdk/channel-status";
import type {
  DiscordAccountConfig,
  DiscordActionConfig,
  BranchConfig,
} from "branch/plugin-sdk/config-contracts";
import { resolveAccountEntry } from "branch/plugin-sdk/routing";
import { normalizeOptionalString } from "branch/plugin-sdk/string-coerce-runtime";
import { resolveDiscordAccountAvailability } from "./account-token-inspect.js";
import { selectDiscordRuntimeConfig } from "./runtime-config.js";
import { resolveDiscordToken, type DiscordCredentialStatus } from "./token.js";

export type ResolvedDiscordAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  token: string;
  tokenSource: "env" | "config" | "none";
  tokenStatus: DiscordCredentialStatus;
  config: DiscordAccountConfig;
};

const {
  listAccountIds,
  resolveDefaultAccountId,
  resolveAccountConfig: mergeDiscordAccountConfig,
} = createAccountListHelpers<DiscordAccountConfig>("discord", {
  implicitDefaultAccount: {
    channelKeys: ["token"],
    envVars: ["DISCORD_BOT_TOKEN"],
  },
  nestedObjectKeys: ["activities", "agentComponents", "botLoopProtection", "staleness"],
});
export const listDiscordAccountIds = listAccountIds;
export const resolveDefaultDiscordAccountId = resolveDefaultAccountId;

export function resolveDiscordAccountConfig(
  cfg: BranchConfig,
  accountId: string,
): DiscordAccountConfig | undefined {
  return resolveAccountEntry(cfg.channels?.discord?.accounts, accountId);
}

export { mergeDiscordAccountConfig };

export function resolveDiscordAccountAllowFrom(params: {
  cfg: BranchConfig;
  accountId?: string | null;
}): string[] | undefined {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultDiscordAccountId(params.cfg),
  );
  const accountConfig = resolveDiscordAccountConfig(params.cfg, accountId);
  const rootConfig = params.cfg.channels?.discord as DiscordAccountConfig | undefined;
  const allowFrom = accountConfig?.allowFrom ?? rootConfig?.allowFrom;
  return allowFrom ? mapAllowFromEntries(allowFrom) : undefined;
}

export function resolveDiscordAccountDmPolicy(params: {
  cfg: BranchConfig;
  accountId?: string | null;
}): ChannelDmPolicy | undefined {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultDiscordAccountId(params.cfg),
  );
  const accountConfig = resolveDiscordAccountConfig(params.cfg, accountId);
  const rootConfig = params.cfg.channels?.discord as DiscordAccountConfig | undefined;
  return normalizeChannelDmPolicy(accountConfig?.dmPolicy ?? rootConfig?.dmPolicy ?? "pairing");
}

export function createDiscordActionGate(params: {
  cfg: BranchConfig;
  accountId?: string | null;
}): (key: keyof DiscordActionConfig, defaultValue?: boolean) => boolean {
  const accountId = normalizeAccountId(
    params.accountId ?? resolveDefaultDiscordAccountId(params.cfg),
  );
  return createAccountActionGate({
    baseActions: params.cfg.channels?.discord?.actions,
    accountActions: resolveDiscordAccountConfig(params.cfg, accountId)?.actions,
  });
}

export function resolveDiscordAccount(params: {
  cfg: BranchConfig;
  accountId?: string | null;
}): ResolvedDiscordAccount {
  const cfg = selectDiscordRuntimeConfig(params.cfg);
  const accountId = normalizeAccountId(params.accountId ?? resolveDefaultDiscordAccountId(cfg));
  const baseEnabled = cfg.channels?.discord?.enabled !== false;
  const merged = mergeDiscordAccountConfig(cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const tokenResolution = resolveDiscordToken(cfg, { accountId });
  return {
    accountId,
    enabled,
    name: normalizeOptionalString(merged.name),
    token: tokenResolution.token,
    tokenSource: tokenResolution.source,
    tokenStatus: tokenResolution.tokenStatus,
    config: merged,
  };
}

export function resolveDiscordMaxLinesPerMessage(params: {
  cfg: BranchConfig;
  discordConfig?: DiscordAccountConfig | null;
  accountId?: string | null;
}): number | undefined {
  if (typeof params.discordConfig?.maxLinesPerMessage === "number") {
    return params.discordConfig.maxLinesPerMessage;
  }
  return resolveDiscordAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  }).config.maxLinesPerMessage;
}

function inspectDiscordRuntimeAvailability(account: ResolvedDiscordAccount, cfg: BranchConfig) {
  return resolveDiscordAccountAvailability({
    account,
    resolveAccounts: () =>
      listDiscordAccountIds(cfg).map((accountId) => resolveDiscordAccount({ cfg, accountId })),
  });
}

export function isDiscordAccountEnabledForRuntime(
  account: ResolvedDiscordAccount,
  cfg: BranchConfig,
): boolean {
  return inspectDiscordRuntimeAvailability(account, cfg).enabled;
}

export function resolveDiscordAccountDisabledReason(
  account: ResolvedDiscordAccount,
  cfg: BranchConfig,
): string {
  return inspectDiscordRuntimeAvailability(account, cfg).stateReason ?? "disabled";
}

export function listEnabledDiscordAccounts(cfg: BranchConfig): ResolvedDiscordAccount[] {
  return listDiscordAccountIds(cfg)
    .map((accountId) => resolveDiscordAccount({ cfg, accountId }))
    .filter((account) => isDiscordAccountEnabledForRuntime(account, cfg));
}

export function listDiscordStartupAccountIds(cfg: BranchConfig): string[] {
  const startupAccountIds = listEnabledDiscordAccounts(cfg)
    .filter(
      (candidate) =>
        resolveConfiguredFromCredentialStatuses(candidate) ??
        Boolean(normalizeOptionalString(candidate.token)),
    )
    .map((candidate) => candidate.accountId);
  const defaultAccountId = resolveDefaultDiscordAccountId(cfg);
  // Promote only a gateway-eligible account; otherwise a disabled or unconfigured
  // default would waste the immediate startup slot while a real bot waits.
  if (!startupAccountIds.includes(defaultAccountId)) {
    return startupAccountIds;
  }
  return [
    defaultAccountId,
    ...startupAccountIds.filter((candidateId) => candidateId !== defaultAccountId),
  ];
}
