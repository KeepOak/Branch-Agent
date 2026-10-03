import type { ChannelDoctorLegacyConfigRule } from "branch/plugin-sdk/channel-contract";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  ELEVENLABS_TALK_PROVIDER_ID,
  hasLegacyTalkFields,
  migrateElevenLabsLegacyTalkConfig,
} from "./config-compat.js";

export { hasLegacyTalkFields } from "./config-compat.js";

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] = [
  {
    path: ["talk"],
    message:
      "talk.voiceId/talk.voiceAliases/talk.modelId/talk.outputFormat/talk.apiKey are legacy; use talk.providers.<provider> and run branch doctor --fix.",
    match: hasLegacyTalkFields,
  },
];

export const ELEVENLABS_TALK_LEGACY_CONFIG_RULES = legacyConfigRules;

export function normalizeCompatibilityConfig({ cfg }: { cfg: BranchConfig }): {
  config: BranchConfig;
  changes: string[];
} {
  return migrateElevenLabsLegacyTalkConfig(cfg);
}

export { ELEVENLABS_TALK_PROVIDER_ID };
