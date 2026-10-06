import { resolveInboundSupplementalSenderAllowed } from "branch/plugin-sdk/channel-inbound";
import type { MsgContext } from "branch/plugin-sdk/reply-runtime";
import {
  resolveDiscordMemberAllowed,
  resolveDiscordOwnerAllowFrom,
  type DiscordChannelConfigResolved,
  type DiscordGuildEntryResolved,
} from "./allow-list.js";

type DiscordSupplementalContextSender = {
  id?: string;
  name?: string;
  tag?: string;
  memberRoleIds?: readonly string[];
};

export function createDiscordSupplementalContextAccessChecker(params: {
  channelConfig?: DiscordChannelConfigResolved | null;
  guildInfo?: DiscordGuildEntryResolved | null;
  allowNameMatching?: boolean;
  isGuild: boolean;
}) {
  const userAllowList = params.channelConfig?.users ?? params.guildInfo?.users ?? [];
  const roleAllowList = params.channelConfig?.roles ?? params.guildInfo?.roles ?? [];
  const allowFrom = [...userAllowList, ...roleAllowList];
  return (sender: DiscordSupplementalContextSender): boolean => {
    return resolveInboundSupplementalSenderAllowed({
      isGroup: params.isGuild,
      groupPolicy: allowFrom.length === 0 ? "open" : "allowlist",
      allowFrom,
      isSenderAllowed: () =>
        resolveDiscordMemberAllowed({
          userAllowList,
          roleAllowList,
          memberRoleIds: [...(sender.memberRoleIds ?? [])],
          userId: sender.id ?? "",
          userName: sender.name,
          userTag: sender.tag,
          allowNameMatching: params.allowNameMatching,
        }),
    });
  };
}

export function buildDiscordGroupSystemPrompt(
  channelConfig?: DiscordChannelConfigResolved | null,
): string | undefined {
  return channelConfig?.systemPrompt?.trim() || undefined;
}

function buildDiscordChannelStructuredContext(params: {
  isGuild: boolean;
  guildName?: string;
  channelName?: string;
  channelTopic?: string;
  threadName?: string;
}): MsgContext["ChannelStructuredContext"] | undefined {
  if (!params.isGuild) {
    return undefined;
  }
  const guildName = params.guildName?.trim();
  const channelName = params.channelName?.trim();
  const topic = params.channelTopic?.trim();
  const threadName = params.threadName?.trim();
  if (!guildName && !channelName && !topic && !threadName) {
    return undefined;
  }
  const payload = {
    ...(guildName ? { guild_name: guildName } : {}),
    ...(channelName ? { channel_name: channelName } : {}),
    ...(topic ? { topic } : {}),
    ...(threadName ? { thread_name: threadName } : {}),
  };
  return [
    {
      label: "Discord channel metadata",
      source: "discord",
      type: "channel_metadata",
      payload,
    },
  ];
}

export function buildDiscordInboundAccessContext(params: {
  channelConfig?: DiscordChannelConfigResolved | null;
  guildInfo?: DiscordGuildEntryResolved | null;
  sender: {
    id: string;
    name?: string;
    tag?: string;
  };
  allowNameMatching?: boolean;
  isGuild: boolean;
  guildName?: string;
  channelName?: string;
  channelTopic?: string;
  threadName?: string;
}) {
  return {
    groupSystemPrompt: params.isGuild
      ? buildDiscordGroupSystemPrompt(params.channelConfig)
      : undefined,
    channelStructuredContext: buildDiscordChannelStructuredContext({
      isGuild: params.isGuild,
      guildName: params.guildName,
      channelName: params.channelName,
      channelTopic: params.channelTopic,
      threadName: params.threadName,
    }),
    ownerAllowFrom: resolveDiscordOwnerAllowFrom({
      channelConfig: params.channelConfig,
      guildInfo: params.guildInfo,
      sender: params.sender,
      allowNameMatching: params.allowNameMatching,
    }),
  };
}
