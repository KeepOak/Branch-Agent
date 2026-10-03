import type { BranchConfig, SlackChannelConfig } from "branch/plugin-sdk/config-contracts";
import { normalizeAccountId } from "branch/plugin-sdk/routing";
import { normalizeLowercaseStringOrEmpty } from "branch/plugin-sdk/string-coerce-runtime";

type SlackChannels = Record<string, SlackChannelConfig>;

type MigrationScope = "account" | "global";

type SlackChannelMigrationResult = {
  migrated: boolean;
  skippedExisting: boolean;
  scopes: MigrationScope[];
};

function resolveAccountChannels(
  cfg: BranchConfig,
  accountId?: string | null,
): { channels?: SlackChannels } {
  if (!accountId) {
    return {};
  }
  const normalized = normalizeAccountId(accountId);
  const accounts = cfg.channels?.slack?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return {};
  }
  const exact = accounts[normalized];
  if (exact?.channels) {
    return { channels: exact.channels };
  }
  const matchKey = Object.keys(accounts).find(
    (key) => normalizeLowercaseStringOrEmpty(key) === normalizeLowercaseStringOrEmpty(normalized),
  );
  return { channels: matchKey ? accounts[matchKey]?.channels : undefined };
}

function migrateSlackChannelsInPlace(
  channels: SlackChannels | undefined,
  oldChannelId: string,
  newChannelId: string,
): { migrated: boolean; skippedExisting: boolean } {
  if (!channels || oldChannelId === newChannelId || !Object.hasOwn(channels, oldChannelId)) {
    return { migrated: false, skippedExisting: false };
  }
  if (Object.hasOwn(channels, newChannelId)) {
    return { migrated: false, skippedExisting: true };
  }
  const channelConfig = channels[oldChannelId];
  if (!channelConfig) {
    return { migrated: false, skippedExisting: false };
  }
  channels[newChannelId] = channelConfig;
  delete channels[oldChannelId];
  return { migrated: true, skippedExisting: false };
}

export function migrateSlackChannelConfig(params: {
  cfg: BranchConfig;
  accountId?: string | null;
  oldChannelId: string;
  newChannelId: string;
}): SlackChannelMigrationResult {
  const scopes: MigrationScope[] = [];
  let skippedExisting = false;
  const channelScopes = {
    account: resolveAccountChannels(params.cfg, params.accountId).channels,
    global: params.cfg.channels?.slack?.channels,
  };
  for (const scope of ["account", "global"] as const) {
    const result = migrateSlackChannelsInPlace(
      channelScopes[scope],
      params.oldChannelId,
      params.newChannelId,
    );
    if (result.migrated) {
      scopes.push(scope);
    }
    if (result.skippedExisting) {
      skippedExisting = true;
    }
  }

  return { migrated: scopes.length > 0, skippedExisting, scopes };
}
