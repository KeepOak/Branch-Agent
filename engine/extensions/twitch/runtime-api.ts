// Private runtime barrel for the bundled Twitch extension.
// Keep this barrel thin and aligned with the local extension surface.

export type {
  ChannelAccountSnapshot,
  ChannelCapabilities,
  ChannelGatewayContext,
  ChannelLogSink,
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  ChannelResolveKind,
  ChannelResolveResult,
  ChannelStatusAdapter,
} from "branch/plugin-sdk/channel-contract";
export type { ChannelPlugin } from "branch/plugin-sdk/channel-core";
export type { OutboundDeliveryResult } from "branch/plugin-sdk/channel-send-result";
export type { BranchConfig } from "branch/plugin-sdk/config-contracts";
export type { RuntimeEnv } from "branch/plugin-sdk/runtime";
export type { WizardPrompter } from "branch/plugin-sdk/setup";
