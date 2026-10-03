import type { ChannelDoctorConfigMutation } from "branch/plugin-sdk/channel-contract";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  createLegacyPrivateNetworkDoctorContract,
  defineChannelAliasMigration,
} from "branch/plugin-sdk/runtime-doctor-migrations";

const networkContract = createLegacyPrivateNetworkDoctorContract({
  channelKey: "mattermost",
});

// Mattermost has a preview stream mode; runtime resolves it with a "partial"
// default (resolveChannelPreviewStreamMode(merged, "partial") in accounts.ts),
// so scalar/boolean `streaming` values migrate through the mode path. Account
// merge replaces the root streaming object wholesale (resolveMergedAccountConfig
// without a streaming deep-merge), so migration seeds materialized account
// objects with the inherited root settings.
const streamingAliasMigration = defineChannelAliasMigration({
  channelId: "mattermost",
  streaming: { defaultMode: "partial" },
  accountStreamingReplacesRoot: true,
});

export const legacyConfigRules = [
  ...networkContract.legacyConfigRules,
  ...streamingAliasMigration.legacyConfigRules,
];

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: BranchConfig;
}): ChannelDoctorConfigMutation {
  const network = networkContract.normalizeCompatibilityConfig({ cfg });
  return streamingAliasMigration.normalizeChannelConfig({
    cfg: network.config,
    changes: network.changes,
  });
}
