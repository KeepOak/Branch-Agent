import { randomUUID } from "node:crypto";
import {
  buildChannelInboundEventContext,
  createChannelInboundEnvelopeBuilder,
  resolveChannelInboundRouteEnvelope,
} from "branch/plugin-sdk/channel-inbound";
import type { PluginRuntime } from "branch/plugin-sdk/runtime-store";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { CHAT_RELAY_CHANNEL_ID, type ResolvedRelayAccount } from "./accounts.js";
import { buildRelayTarget } from "./target.js";
import { sendRelayText } from "./outbound.js";
import type { RelayInboundEvent } from "./transport.js";

export async function handleRelayInbound(params: {
  cfg: BranchConfig;
  account: ResolvedRelayAccount;
  event: RelayInboundEvent;
  channelRuntime: PluginRuntime["channel"];
}): Promise<void> {
  const source = params.event.source;
  if (!source?.platform || !source.chat_id) {
    return;
  }
  const messageId = params.event.message_id || source.message_id || randomUUID();
  const senderId = source.user_id || source.chat_id;
  if (!params.account.identities.some((identity) => identity.platform === source.platform)) {
    return;
  }
  const chatType = source.chat_type === "dm" || source.chat_type === "direct"
    ? "direct" as const
    : source.chat_type === "channel" ? "channel" as const : "group" as const;
  const peerTarget = buildRelayTarget({ platform: source.platform, chatType, chatId: source.chat_id });
  const target = buildRelayTarget({ platform: source.platform, chatType, chatId: source.chat_id,
    scopeId: source.scope_id, userId: source.user_id });
  const { route } = resolveChannelInboundRouteEnvelope({
    cfg: params.cfg,
    channel: CHAT_RELAY_CHANNEL_ID,
    accountId: params.account.accountId,
    peer: { kind: chatType, id: peerTarget },
  });
  const isGroup = chatType !== "direct";
  const wasMentioned = isGroup
    ? params.channelRuntime.mentions.matchesMentionPatterns(
        params.event.text ?? "",
        params.channelRuntime.mentions.buildMentionRegexes(params.cfg, route.agentId),
      )
    : undefined;
  const access = await params.channelRuntime.inbound.ingress.resolveStable({
    cfg: params.cfg,
    channelId: CHAT_RELAY_CHANNEL_ID,
    accountId: params.account.accountId,
    identity: { key: "sender", entryIdPrefix: "relay-entry" },
    groupAllowFromFallbackToAllowFrom: true,
    subject: { stableId: senderId },
    conversation: {
      kind: chatType,
      id: source.chat_id,
      threadId: source.thread_id,
      title: source.chat_name,
    },
    contextBinding: {
      agentId: route.agentId,
      sessionKey: route.sessionKey,
      nativeChannelId: source.chat_id,
      messageId,
      inboundEventKind: "user_request",
    },
    mentionFacts: isGroup ? { canDetectMention: true, wasMentioned: Boolean(wasMentioned) } : undefined,
    // An authenticated connector owns provider-side access. Operators can still
    // restrict this channel locally without silently imposing a new default.
    dmPolicy: "open",
    groupPolicy: params.account.groupPolicy ?? "open",
    policy: { activation: isGroup ? { requireMention: false, allowTextCommands: true } : undefined },
    allowFrom: params.account.allowFrom ?? ["*"],
    groupAllowFrom: params.account.groupAllowFrom ?? ["*"],
  });
  if (access.ingress.admission !== "dispatch") return;

  const senderName = source.user_display_name || source.user_name || senderId;
  const text = params.event.text ?? "";
  const body = createChannelInboundEnvelopeBuilder({
    cfg: params.cfg,
    route: { agentId: route.agentId, sessionKey: route.sessionKey },
  })({ channel: "Chat Relay", from: senderName, body: text });
  const ctxPayload = (params.channelRuntime.inbound.buildContext ?? buildChannelInboundEventContext)({
    channel: CHAT_RELAY_CHANNEL_ID,
    accountId: params.account.accountId,
    messageId,
    messageIdFull: messageId,
    from: target,
    sender: { id: senderId, name: senderName },
    conversation: {
      kind: chatType === "direct" ? "direct" : "group",
      id: source.chat_id,
      label: source.chat_name || source.chat_id,
      threadId: source.thread_id,
      nativeChannelId: source.chat_id,
    },
    route: {
      agentId: route.agentId,
      dmScope: route.dmScope,
      accountId: route.accountId,
      routeSessionKey: route.sessionKey,
      dispatchSessionKey: route.sessionKey,
    },
    reply: {
      to: target,
      originatingTo: target,
      replyToId: params.event.reply_to_message_id,
      messageThreadId: source.thread_id,
    },
    message: { body, bodyForAgent: text, rawBody: text, commandBody: text },
    channelIngress: access,
    access: {
      commands: { authorized: true },
      mentions: { canDetectMention: isGroup, wasMentioned: Boolean(wasMentioned) },
    },
  });
  await params.channelRuntime.inbound.dispatch({
    cfg: params.cfg,
    channel: CHAT_RELAY_CHANNEL_ID,
    accountId: params.account.accountId,
    route: { agentId: route.agentId, dmScope: route.dmScope, sessionKey: route.sessionKey },
    ctxPayload,
    delivery: {
      deliver: async (payload, info) => {
        if (info?.kind !== "final" || !payload.text) return;
        await sendRelayText({
          cfg: params.cfg,
          accountId: params.account.accountId,
          to: target,
          text: payload.text,
          replyToId: messageId,
          threadId: source.thread_id,
        });
      },
      onError: (error) => { throw error; },
    },
    replyPipeline: {},
  });
}
