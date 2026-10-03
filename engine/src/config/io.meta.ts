import { writeConfigMachineState } from "../state/config-machine-state-write.js";
// Maintains config metadata fields written alongside user config.
import { VERSION } from "../version.js";
import { materializeModelPolicyAllowlist } from "./model-policy-allowlist-migration.js";
import type { BranchConfig } from "./types.branch.js";
import { materializeUtilityModelSeparation } from "./utility-model-separation-migration.js";

/** Metadata keys automatically stamped on config writes. */
export const AUTO_MANAGED_CONFIG_META_PATHS = [
  ["meta", "lastTouchedVersion"],
  ["meta", "migrations", "modelPolicyAllowlist"],
  ["meta", "migrations", "utilityModelSeparation"],
] as const;

export function stampConfigWriteMetadata(
  cfg: BranchConfig,
  _now: string = new Date().toISOString(),
  version: string = VERSION,
  previousConfig?: unknown,
): BranchConfig {
  const migrationStamped =
    previousConfig === undefined
      ? cfg
      : materializeUtilityModelSeparation(
          materializeModelPolicyAllowlist(cfg, previousConfig).config,
          previousConfig,
        ).config;
  return {
    ...migrationStamped,
    meta: {
      ...migrationStamped.meta,
      lastTouchedVersion: version,
    },
  };
}

/** Persist machine-owned metadata only after the matching config file commit succeeds. */
export function recordConfigWriteMetadata(now: string = new Date().toISOString()): void {
  writeConfigMachineState("config.lastTouchedAt", now);
}
