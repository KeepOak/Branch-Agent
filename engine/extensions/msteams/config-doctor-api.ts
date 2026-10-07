import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "branch/plugin-sdk/channel-contract";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  createLegacyWebhookListenerDoctorContract,
  defineChannelAliasMigration,
} from "branch/plugin-sdk/runtime-doctor-migrations";
import { resolveMSTeamsCredentials } from "./src/token-config.js";

const webhookMigration = createLegacyWebhookListenerDoctorContract({
  channelKey: "msteams",
  defaultPort: 3978,
  webhookKey: "webhook",
  portKey: "port",
  hostKey: null,
  preserveAuthoredActivation: true,
});
export const { historicalWebhookListener } = webhookMigration;

const streamingAliasMigration = defineChannelAliasMigration({
  channelId: "msteams",
  // Teams previews default to partial streaming, matching the runtime default
  // in reply-dispatcher when no mode is configured.
  streaming: { defaultMode: "partial" },
});

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] = [
  ...webhookMigration.legacyConfigRules,
  ...streamingAliasMigration.legacyConfigRules,
];

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: BranchConfig;
}): ChannelDoctorConfigMutation {
  const webhook = webhookMigration.normalizeCompatibilityConfig({ cfg });
  return {
    ...streamingAliasMigration.normalizeChannelConfig({
      cfg: webhook.config,
      changes: webhook.changes,
    }),
    historicalWebhookAccountIds:
      cfg.channels?.msteams === undefined && !resolveMSTeamsCredentials()
        ? null
        : cfg.channels?.msteams?.enabled === false
          ? []
          : [undefined],
  };
}
