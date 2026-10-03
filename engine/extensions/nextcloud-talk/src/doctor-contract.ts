import type { ChannelDoctorConfigMutation } from "branch/plugin-sdk/channel-contract";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  createLegacyPrivateNetworkDoctorContract,
  createLegacyWebhookListenerDoctorContract,
  defineChannelAliasMigration,
} from "branch/plugin-sdk/runtime-doctor-migrations";

const webhookContract = createLegacyWebhookListenerDoctorContract({
  channelKey: "nextcloud-talk",
  defaultHost: "0.0.0.0",
  defaultPort: 8788,
});

const networkContract = createLegacyPrivateNetworkDoctorContract({
  channelKey: "nextcloud-talk",
});

// Nextcloud Talk's nested streaming schema is delivery-only ({chunkMode,
// block}); it has no preview mode, so only the delivery flat aliases are
// legal legacy input. Account merge replaces the root streaming object
// wholesale (resolveMergedAccountConfig without a streaming deep-merge), so
// migration seeds materialized account objects with inherited root settings.
const streamingAliasMigration = defineChannelAliasMigration({
  channelId: "nextcloud-talk",
  streaming: { defaultMode: "partial", deliveryOnly: true },
  accountStreamingReplacesRoot: true,
});

export const legacyConfigRules = [
  ...webhookContract.legacyConfigRules,
  ...networkContract.legacyConfigRules,
  ...streamingAliasMigration.legacyConfigRules,
];

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: BranchConfig;
}): ChannelDoctorConfigMutation {
  const webhook = webhookContract.normalizeCompatibilityConfig({ cfg });
  const network = networkContract.normalizeCompatibilityConfig({ cfg: webhook.config });
  return streamingAliasMigration.normalizeChannelConfig({
    cfg: network.config,
    changes: [...webhook.changes, ...network.changes],
  });
}
