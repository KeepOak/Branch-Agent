// Private runtime entry and shared type imports for the bundled Mattermost plugin.
export type { ChannelGroupContext, BranchConfig, PluginRuntime } from "branch/plugin-sdk/core";
export type { RuntimeEnv } from "branch/plugin-sdk/runtime";
export type { ReplyPayload } from "branch/plugin-sdk/reply-runtime";
export { setMattermostRuntime } from "./src/runtime.js";
