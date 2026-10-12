import type { BranchConfig } from "../config/types.branch.js";
import { isTruthyEnvValue } from "../infra/env.js";

export function resolveGatewayStartupSourceConfig(
  config: BranchConfig,
  env: NodeJS.ProcessEnv,
): BranchConfig {
  const skipChannels =
    isTruthyEnvValue(env.BRANCH_SKIP_CHANNELS) || isTruthyEnvValue(env.BRANCH_SKIP_PROVIDERS);
  if (!skipChannels || !config.channels) {
    return config;
  }
  return {
    ...config,
    channels: undefined,
  };
}
