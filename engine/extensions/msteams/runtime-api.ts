// Private runtime barrel for the bundled Microsoft Teams extension.
// Keep this barrel thin and aligned with the local extension surface.

export { DEFAULT_ACCOUNT_ID } from "branch/plugin-sdk/account-id";
export { mergeAllowlist, summarizeMapping } from "branch/plugin-sdk/allow-from";
export type {
  BaseProbeResult,
  ChannelDirectoryEntry,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelOutboundAdapter,
} from "branch/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "branch/plugin-sdk/channel-core";
export { logTypingFailure } from "branch/plugin-sdk/channel-outbound";
export { createChannelPairingController } from "branch/plugin-sdk/channel-pairing";
export { createChannelMessageReplyPipeline } from "branch/plugin-sdk/channel-outbound";
export {
  PAIRING_APPROVED_MESSAGE,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
} from "branch/plugin-sdk/channel-status";
export {
  buildChannelKeyCandidates,
  normalizeChannelSlug,
  resolveChannelEntryMatchWithFallback,
  resolveNestedAllowlistDecision,
} from "branch/plugin-sdk/channel-targets";
export type {
  GroupToolPolicyConfig,
  MSTeamsChannelConfig,
  MSTeamsCloudName,
  MSTeamsConfig,
  MSTeamsReplyStyle,
  MSTeamsTeamConfig,
  MarkdownTableMode,
  BranchConfig,
} from "branch/plugin-sdk/config-contracts";
export { isDangerousNameMatchingEnabled } from "branch/plugin-sdk/dangerous-name-runtime";
export { resolveDefaultGroupPolicy } from "branch/plugin-sdk/runtime-group-policy";
export {
  detectMime,
  extensionForMime,
  extractOriginalFilename,
  getFileExtension,
} from "branch/plugin-sdk/media-runtime";
export { resolveChannelMediaMaxBytes } from "branch/plugin-sdk/account-helpers";
export { loadOutboundMediaFromUrl } from "branch/plugin-sdk/outbound-media";
// Deprecated media-legacy-projection surface; the re-export stays until the
// compat record's removeAfter window expires (deleted in retirement PR 4).
export { buildMediaPayload } from "branch/plugin-sdk/reply-payload";
export type { ReplyPayload } from "branch/plugin-sdk/reply-payload";
export type { PluginRuntime } from "branch/plugin-sdk/runtime-store";
export type { RuntimeEnv } from "branch/plugin-sdk/runtime";
export type { SsrFPolicy } from "branch/plugin-sdk/ssrf-runtime";
export { fetchWithSsrFGuard } from "branch/plugin-sdk/ssrf-runtime";
export { normalizeStringEntries } from "branch/plugin-sdk/string-normalization-runtime";
export { chunkTextForOutbound } from "branch/plugin-sdk/text-chunking";
export { DEFAULT_WEBHOOK_MAX_BODY_BYTES } from "branch/plugin-sdk/webhook-ingress";
export { setMSTeamsRuntime } from "./src/runtime.js";
