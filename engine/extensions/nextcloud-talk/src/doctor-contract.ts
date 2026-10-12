import type { ChannelDoctorConfigMutation } from "branch/plugin-sdk/channel-contract";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  createLegacyWebhookListenerDoctorContract,
  defineChannelAliasMigration,
} from "branch/plugin-sdk/runtime-doctor-migrations";
import {
  hasConfiguredNextcloudTalkChannelState,
  listNextcloudTalkAccountIds,
  mergeNextcloudTalkAccountConfig,
} from "../configured-state.js";

const webhookContract = createLegacyWebhookListenerDoctorContract({
  channelKey: "nextcloud-talk",
  defaultHost: "0.0.0.0",
  defaultPort: 8788,
});
export const { historicalWebhookListener } = webhookContract;

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
  ...streamingAliasMigration.legacyConfigRules,
];

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: BranchConfig;
}): ChannelDoctorConfigMutation {
  const webhook = webhookContract.normalizeCompatibilityConfig({ cfg });
  return {
    ...streamingAliasMigration.normalizeChannelConfig({
      cfg: webhook.config,
      changes: webhook.changes,
    }),
    historicalWebhookAccountIds: !hasConfiguredNextcloudTalkChannelState({ cfg })
      ? []
      : listNextcloudTalkAccountIds(cfg).filter(
          (accountId) => mergeNextcloudTalkAccountConfig(cfg, accountId).enabled !== false,
        ),
  };
}
