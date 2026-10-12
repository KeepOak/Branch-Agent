// Private runtime barrel for the bundled Nextcloud Talk extension.
// Keep this barrel thin and aligned with the local extension surface.

export type { AllowlistMatch } from "branch/plugin-sdk/allow-from";
export type { ChannelGroupContext } from "branch/plugin-sdk/channel-contract";
export { logInboundDrop } from "branch/plugin-sdk/channel-inbound";
export { createChannelPairingController } from "branch/plugin-sdk/channel-pairing";
export type {
  GroupPolicy,
  GroupToolPolicyConfig,
  BranchConfig,
} from "branch/plugin-sdk/config-contracts";
export {
  GROUP_POLICY_BLOCKED_LABEL,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  warnMissingProviderGroupPolicyFallbackOnce,
} from "branch/plugin-sdk/runtime-group-policy";
export type { OutboundReplyPayload } from "branch/plugin-sdk/reply-payload";
export { deliverFormattedTextWithAttachments } from "branch/plugin-sdk/reply-payload";
export type { PluginRuntime } from "branch/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "branch/plugin-sdk/runtime";
export { fetchWithSsrFGuard } from "branch/plugin-sdk/ssrf-runtime";
export { setNextcloudTalkRuntime } from "./src/runtime.js";
