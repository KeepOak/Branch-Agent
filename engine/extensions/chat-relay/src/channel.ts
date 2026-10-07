import { buildChannelOutboundSessionRoute, createChatChannelPlugin } from "branch/plugin-sdk/channel-core";
import type { ChannelPlugin } from "branch/plugin-sdk/channel-core";
import { createMessageReceiptFromOutboundResults, defineChannelMessageAdapter } from "branch/plugin-sdk/channel-outbound";
import { createComputedAccountStatusAdapter, createDefaultChannelRuntimeState } from "branch/plugin-sdk/status-helpers";
import {
  CHAT_RELAY_CHANNEL_ID, DEFAULT_ACCOUNT_ID, listRelayAccountIds,
  resolveDefaultRelayAccountId, resolveRelayAccount, type ResolvedRelayAccount,
} from "./accounts.js";
import { relayChannelConfigSchema } from "./config-schema.js";
import { startRelayGatewayAccount } from "./gateway.js";
import { sendRelayText } from "./outbound.js";
import { parseRelayTarget } from "./target.js";

const meta = {
  id: CHAT_RELAY_CHANNEL_ID,
  label: "Chat Relay",
  selectionLabel: "Chat Relay",
  docsPath: "/channels/chat-relay",
  blurb: "Connect chat platforms through a remote relay connector.",
};

export const chatRelayPlugin: ChannelPlugin<ResolvedRelayAccount> = createChatChannelPlugin({
  base: {
    id: CHAT_RELAY_CHANNEL_ID,
    meta,
    capabilities: { chatTypes: ["direct", "group"], threads: true },
    reload: { configPrefixes: ["channels.chat-relay"] },
    configSchema: relayChannelConfigSchema,
    config: {
      listAccountIds: listRelayAccountIds,
      resolveAccount: (cfg, accountId) => resolveRelayAccount({ cfg, accountId }),
      defaultAccountId: resolveDefaultRelayAccountId,
      isConfigured: (account) => account.configured,
      resolveAllowFrom: ({ cfg, accountId }) => resolveRelayAccount({ cfg, accountId }).allowFrom,
      resolveDefaultTo: ({ cfg, accountId }) => resolveRelayAccount({ cfg, accountId }).defaultTo,
    },
    messaging: {
      targetPrefixes: ["chat-relay"],
      normalizeTarget: (raw) => { try { return raw.trim() && parseRelayTarget(raw) ? raw.trim() : undefined; } catch { return undefined; } },
      inferTargetChatType: ({ to }) => parseRelayTarget(to).chatType,
      targetResolver: {
        looksLikeId: (raw) => { try { return Boolean(parseRelayTarget(raw)); } catch { return false; } },
        hint: "<platform>:<direct|group|channel>:<chat-id>",
      },
      resolveOutboundSessionRoute: ({ cfg, agentId, accountId, target }) => {
        const parsed = parseRelayTarget(target);
        return buildChannelOutboundSessionRoute({
          cfg, agentId, channel: CHAT_RELAY_CHANNEL_ID, accountId,
          recipientSessionExact: parsed.chatType === "direct",
          peer: { kind: parsed.chatType, id: target },
          chatType: parsed.chatType,
          from: `${CHAT_RELAY_CHANNEL_ID}:${accountId ?? DEFAULT_ACCOUNT_ID}`,
          to: target,
        });
      },
    },
    status: createComputedAccountStatusAdapter<ResolvedRelayAccount>({
      defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
      buildChannelSummary: ({ snapshot }) => ({
        ok: snapshot.configured,
        label: snapshot.configured ? "configured" : "missing config",
      }),
      resolveAccountSnapshot: ({ account }) => ({
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        extra: { url: account.url, platforms: account.identities.map((identity) => identity.platform) },
      }),
    }),
    gateway: { startAccount: startRelayGatewayAccount },
    message: defineChannelMessageAdapter({
      id: CHAT_RELAY_CHANNEL_ID,
      durableFinal: { capabilities: { text: true, replyTo: true, thread: true } },
      send: {
        text: async (ctx) => {
          const messageId = await sendRelayText({ ...ctx, replyToId: ctx.replyToId });
          return {
            messageId,
            receipt: createMessageReceiptFromOutboundResults({
              results: [{ channel: CHAT_RELAY_CHANNEL_ID, messageId }],
              threadId: ctx.threadId == null ? undefined : String(ctx.threadId),
              replyToId: ctx.replyToId ?? undefined,
              kind: "text",
            }),
          };
        },
      },
    }),
  },
  outbound: {
    base: { deliveryMode: "direct" },
    attachedResults: {
      channel: CHAT_RELAY_CHANNEL_ID,
      sendText: async (ctx) => ({ messageId: await sendRelayText({ ...ctx, replyToId: ctx.replyToId }) }),
    },
  },
});
