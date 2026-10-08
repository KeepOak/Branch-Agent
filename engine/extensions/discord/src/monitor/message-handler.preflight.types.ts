import type { GroupThreadMentionFacts, InboundEventKind } from "branch/plugin-sdk/channel-inbound";
import type {
  ChannelIngressContextBinding,
  ResolvedChannelMessageIngress,
} from "branch/plugin-sdk/channel-ingress-runtime";
import type { BranchConfig, ReplyToMode } from "branch/plugin-sdk/config-contracts";
import type { SessionBindingRecord } from "branch/plugin-sdk/conversation-runtime";
import type { resolveAgentRoute } from "branch/plugin-sdk/routing";
import type { ChannelType, Client, User } from "../internal/discord.js";
import type { DiscordChannelConfigResolved, DiscordGuildEntryResolved } from "./allow-list.js";
import type { DiscordIngressLifecycle } from "./ingress.js";
import type { DiscordAvatarResolver } from "./message-avatar.js";
import type { DiscordChannelInfo } from "./message-channel-info.js";
import type { DiscordHistoryEntry } from "./message-handler.history.js";
import type { DiscordMediaInfo } from "./message-media.js";
import type { DiscordThreadBindingLookup } from "./reply-delivery.js";
import type { DiscordSenderIdentity } from "./sender-identity.js";
import type { DiscordThreadChannel } from "./threading.js";

export type { DiscordSenderIdentity } from "./sender-identity.js";

type BuildChannelInboundContext =
  typeof import("branch/plugin-sdk/channel-inbound").buildChannelInboundEventContext;
export type RuntimeEnv = import("branch/plugin-sdk/runtime-env").RuntimeEnv;

export type DiscordMessageEvent = import("./listeners.js").DiscordMessageEvent;

type DiscordMessagePreflightSharedFields = {
  cfg: BranchConfig;
  discordConfig: NonNullable<BranchConfig["channels"]>["discord"];
  accountId: string;
  token: string;
  runtime: RuntimeEnv;
  buildContext?: BuildChannelInboundContext;
  botUserId?: string;
  abortSignal?: AbortSignal;
  isPolicyCurrent?: () => boolean;
  guildHistories: Map<string, DiscordHistoryEntry[]>;
  historyLimit: number;
  mediaMaxBytes: number;
  textLimit: number;
  replyToMode: ReplyToMode;
  ackReactionScope: "all" | "direct" | "group-all" | "group-mentions" | "off" | "none";
  groupPolicy: "open" | "disabled" | "allowlist";
  turnAdoptionLifecycle?: DiscordIngressLifecycle;
};

export type DiscordMessagePreflightContext = DiscordMessagePreflightSharedFields & {
  data: DiscordMessageEvent;
  client: Client;
  message: DiscordMessageEvent["message"];
  messageChannelId: string;
  author: User;
  sender: DiscordSenderIdentity;
  canonicalMessageId?: string;
  /** Receipt sequence retained across debounce/preflight/queue delays. */
  stalenessStartSequence?: number;
  sourceMessageIds?: readonly string[];
  memberRoleIds: string[];

  channelInfo: DiscordChannelInfo | null;
  channelName?: string;

  isGuildMessage: boolean;
  isDirectMessage: boolean;
  isGroupDm: boolean;

  commandAuthorized: boolean;
  resolveChannelIngress: (
    contextBinding: ChannelIngressContextBinding,
    conversation?: { parentId?: string; threadId?: string },
  ) => Promise<ResolvedChannelMessageIngress>;
  baseText: string;
  messageText: string;
  preflightAudioTranscript?: string;
  // Keep one required receipt-time snapshot: queued processing must never
  // fall back to Discord's expiring attachment URLs.
  preparedMedia: DiscordMediaInfo[];
  wasMentioned: boolean;
  conversationAvatar?: string;

  route: ReturnType<typeof resolveAgentRoute>;
  threadBinding?: SessionBindingRecord;
  boundSessionKey?: string;
  boundAgentId?: string;

  guildInfo: DiscordGuildEntryResolved | null;
  guildSlug: string;

  threadChannel: DiscordThreadChannel | null;
  threadParentId?: string;
  threadParentName?: string;
  threadParentType?: ChannelType;
  threadName?: string | null;

  displayChannelSlug: string;

  baseSessionKey: string;
  channelConfig: DiscordChannelConfigResolved | null;

  shouldRequireMention: boolean;
  groupRequireMention: boolean;
  hasAnyMention: boolean;
  hasControlCommand: boolean;
  shouldBypassMention: boolean;
  effectiveWasMentioned: boolean;
  groupThread?: GroupThreadMentionFacts;
  inboundEventKind: InboundEventKind;
  canDetectMention: boolean;

  threadBindings: DiscordThreadBindingLookup;
  discordRestFetch?: typeof fetch;
};

export type DiscordMessagePreflightParams = DiscordMessagePreflightSharedFields & {
  dmEnabled: boolean;
  groupDmEnabled: boolean;
  groupDmChannels?: string[];
  dmPolicy: "open" | "pairing" | "allowlist" | "disabled";
  allowFrom?: string[];
  guildEntries?: Record<string, DiscordGuildEntryResolved>;
  threadBindings: DiscordThreadBindingLookup;
  discordRestFetch?: typeof fetch;
  avatarResolver?: DiscordAvatarResolver;
  precedingMessages?: readonly DiscordMessageEvent["message"][];
  data: DiscordMessageEvent;
  client: Client;
};
