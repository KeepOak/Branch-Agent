import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type { BranchPluginToolContext } from "branch/plugin-sdk/plugin-entry";
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-runtime";

export type TavilyToolConfigContext = Pick<
  BranchPluginToolContext,
  "config" | "runtimeConfig" | "getRuntimeConfig"
>;

export function resolveTavilyToolConfig(
  api: BranchPluginApi,
  ctx?: TavilyToolConfigContext,
): BranchConfig {
  return ctx?.getRuntimeConfig?.() ?? ctx?.runtimeConfig ?? ctx?.config ?? api.config;
}
