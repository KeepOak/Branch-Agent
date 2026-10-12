import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";

export {
  buildPluginConfigSchema,
  definePluginEntry,
  type AnyAgentTool,
  type BranchPluginApi,
  type BranchPluginToolContext,
  type PluginLogger,
} from "branch/plugin-sdk/plugin-entry";
export type { PluginStateKeyedStore } from "branch/plugin-sdk/plugin-state-runtime";
export { createPluginRuntimeStore, type PluginRuntime } from "branch/plugin-sdk/runtime-store";

export type PluginGatewayAccessAuthority = NonNullable<
  ReturnType<Parameters<BranchPluginApi["registerGatewayAccessPolicy"]>[0]["authorize"]>
>;
