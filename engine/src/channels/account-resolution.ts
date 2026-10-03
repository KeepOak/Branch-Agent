import type { BranchConfig } from "../config/types.branch.js";
import type { ChannelPlugin } from "./plugins/types.plugin.js";

/** Prefer fresh operational preparation without retrying failures through the legacy hook. */
export async function resolveChannelAccount<ResolvedAccount>(params: {
  plugin: ChannelPlugin<ResolvedAccount>;
  cfg: BranchConfig;
  accountId?: string | null;
}): Promise<ResolvedAccount> {
  const { config } = params.plugin;
  return config.resolveAccountAsync
    ? await config.resolveAccountAsync(params.cfg, params.accountId)
    : config.resolveAccount(params.cfg, params.accountId);
}

export async function channelHasConfiguredState<ResolvedAccount>(params: {
  plugin: ChannelPlugin<ResolvedAccount>;
  cfg: BranchConfig;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean | undefined> {
  const { config } = params.plugin;
  const input = { cfg: params.cfg, env: params.env };
  return config.hasConfiguredStateAsync
    ? await config.hasConfiguredStateAsync(input)
    : config.hasConfiguredState?.(input);
}
