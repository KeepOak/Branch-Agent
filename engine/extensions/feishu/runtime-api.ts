// Private runtime barrel for the bundled Feishu extension.
// Keep this barrel thin and generic-only.

export type {
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelPlugin,
  HistoryEntry,
  BranchConfig,
  BranchPluginApi,
  OutboundIdentity,
  PluginRuntime,
  ReplyPayload,
} from "branch/plugin-sdk/core";
export type { BranchConfig as ClawdbotConfig } from "branch/plugin-sdk/core";
export type RuntimeEnv = {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  exit: (code: number) => void;
};
export {
  evaluateSupplementalContextVisibility,
  resolveChannelContextVisibilityMode,
} from "branch/plugin-sdk/context-visibility-runtime";
export { normalizeAgentId } from "branch/plugin-sdk/routing";
export { setFeishuRuntime } from "./src/runtime.js";
