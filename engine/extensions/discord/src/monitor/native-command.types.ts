import type {
  BuildChannelInboundEventContextParams,
  BuiltChannelInboundEventContext,
  ChannelInboundTurnPlan,
} from "branch/plugin-sdk/channel-inbound";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export type DiscordConfig = NonNullable<BranchConfig["channels"]>["discord"];
export type DiscordDispatchReplyFromConfig = NonNullable<
  ChannelInboundTurnPlan["dispatchReplyFromConfig"]
>;

export type DiscordBuildInboundContext = (
  params: BuildChannelInboundEventContextParams,
) => BuiltChannelInboundEventContext | Promise<BuiltChannelInboundEventContext>;
