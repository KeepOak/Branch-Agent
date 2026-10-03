import { collectConfigRuntimeEnvVars } from "./env-vars.js";
import type { BranchConfig } from "./types.js";

export const GATEWAY_CONFIG_SELECTION_ENV_KEYS: ReadonlySet<string> = new Set([
  "ANDROID_DATA",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "BRANCH_AGENT_DIR",
  "BRANCH_CONFIG_PATH",
  "BRANCH_HOME",
  "BRANCH_INCLUDE_ROOTS",
  "BRANCH_CONFIG_READONLY",
  "BRANCH_NIX_MODE",
  "BRANCH_OAUTH_DIR",
  "BRANCH_PACKAGE_DIR",
  "BRANCH_PROFILE",
  "BRANCH_STATE_DIR",
  "BRANCH_WORKSPACE_DIR",
  "PI_CODING_AGENT_DIR",
  "PREFIX",
  "USERPROFILE",
]);

/** Rejects config.env changes that would retarget a running Gateway process. */
export function assertGatewayConfigEnvSelectionUnchanged(
  previousConfig: BranchConfig,
  nextConfig: BranchConfig,
): void {
  const normalize = (config: BranchConfig) =>
    new Map(
      Object.entries(collectConfigRuntimeEnvVars(config)).map(([key, value]) => [
        key.toUpperCase(),
        value,
      ]),
    );
  const previous = normalize(previousConfig);
  const next = normalize(nextConfig);
  for (const key of GATEWAY_CONFIG_SELECTION_ENV_KEYS) {
    if (previous.get(key) !== next.get(key)) {
      throw new Error(
        `Config env cannot change process-stable Gateway selector ${key} during reload. Restart with the target environment instead.`,
      );
    }
  }
}
