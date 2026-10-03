// Test-only bridge that feeds legacy fixture values through the canonical mediaModels owner.
import type { BranchConfig } from "../../config/types.branch.js";

type MediaCapability = "image" | "music" | "video";
type LegacyMediaModelKey = "imageGenerationModel" | "musicGenerationModel" | "videoGenerationModel";

export function canonicalizeMediaGenerationTestConfig(
  config: BranchConfig,
  capability: MediaCapability,
  legacyKey: LegacyMediaModelKey,
): BranchConfig {
  const defaults = config.agents?.defaults as
    | (NonNullable<BranchConfig["agents"]>["defaults"] & Record<string, unknown>)
    | undefined;
  const legacyValue = defaults?.[legacyKey];
  if (legacyValue === undefined || defaults?.mediaModels?.[capability] !== undefined) {
    return config;
  }
  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...defaults,
        mediaModels: { ...defaults?.mediaModels, [capability]: legacyValue },
      },
    },
  };
}
