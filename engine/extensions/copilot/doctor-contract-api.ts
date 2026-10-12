// Session-route ownership is static manifest metadata; no config fields are retired.
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

type LegacyConfigRule = {
  path: string[];
  message: string;
  match: (value: unknown) => boolean;
};

export const legacyConfigRules: LegacyConfigRule[] = [];

export function normalizeCompatibilityConfig({ cfg }: { cfg: BranchConfig }): {
  config: BranchConfig;
  changes: string[];
} {
  return { config: cfg, changes: [] };
}
