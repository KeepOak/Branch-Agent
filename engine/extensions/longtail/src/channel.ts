import { DEFAULT_ACCOUNT_ID } from "branch/plugin-sdk/account-id";
import { createHybridChannelConfigAdapter } from "branch/plugin-sdk/channel-config-helpers";
import type { ChannelPlugin } from "branch/plugin-sdk/channel-core";
import { createChannelMessageAdapterFromOutbound } from "branch/plugin-sdk/channel-outbound";
import { createEmptyChannelDirectoryAdapter } from "branch/plugin-sdk/directory-runtime";
import {
  createComputedAccountStatusAdapter,
  createDefaultChannelRuntimeState,
} from "branch/plugin-sdk/status-helpers";
import { chunkTextForOutbound, sanitizeAssistantVisibleText } from "branch/plugin-sdk/text-chunking";
import { isConfigured, listAccountIds, resolveAccount } from "./accounts.js";
import { LongtailChannelConfigSchema } from "./config-schema.js";
import { sendLongtailText, type LongtailAccount } from "./send.js";

const id = "longtail";

const config = createHybridChannelConfigAdapter<LongtailAccount>({
  sectionKey: id,
  listAccountIds,
  resolveAccount,
  defaultAccountId: () => DEFAULT_ACCOUNT_ID,
  clearBaseFields: ["provider", "baseUrl", "token", "userId", "email", "defaultTo", "title"],
  resolveAllowFrom: () => [],
  formatAllowFrom: () => [],
  resolveDefaultTo: (account) => account.defaultTo,
});

const sendText = async (ctx: {
  cfg: Parameters<typeof resolveAccount>[0];
  accountId?: string | null;
  to: string;
  text: string;
  onPlatformSendDispatch?: () => void | Promise<void>;
}) => {
  const account = resolveAccount(ctx.cfg, ctx.accountId);
  if (!account.enabled || !isConfigured(account)) {
    throw new Error("Long-tail account is disabled or incomplete");
  }
  const to = ctx.to.trim() || account.defaultTo;
  const messageId = await sendLongtailText({
    account,
    to,
    text: ctx.text,
    onPlatformSendDispatch: ctx.onPlatformSendDispatch,
  });
  return { channel: id, messageId, target: { kind: "chat" as const, id: to } };
};

const outbound = {
  deliveryMode: "direct" as const,
  chunker: chunkTextForOutbound,
  chunkerMode: "text" as const,
  textChunkLimit: 4000,
  sanitizeText: ({ text }: { text: string }) => sanitizeAssistantVisibleText(text),
  sendText,
};

export const longtailPlugin: ChannelPlugin<LongtailAccount> = {
  id,
  meta: {
    id,
    label: "Long-tail delivery",
    selectionLabel: "Long-tail delivery (send-only)",
    docsPath: "/channels/longtail",
    blurb: "Send to Rocket.Chat, Zulip, Webex, Gotify, Pushover, or ntfy.",
    order: 95,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: false,
    threads: false,
    reactions: false,
    edit: false,
    unsend: false,
    reply: false,
    effects: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ["channels.longtail"] },
  configSchema: LongtailChannelConfigSchema,
  config: {
    ...config,
    isConfigured,
    unconfiguredReason: () => "Set provider and the credentials required by that provider.",
  },
  messaging: {
    targetPrefixes: ["longtail"],
    normalizeTarget: (target) => target.replace(/^longtail:/i, "").trim(),
    inferTargetChatType: ({ to }) => to.startsWith("dm/") || to.startsWith("person/") ? "direct" : "group",
    targetResolver: { looksLikeId: (target) => Boolean(target.trim()), hint: "<provider target>" },
  },
  directory: createEmptyChannelDirectoryAdapter(),
  status: createComputedAccountStatusAdapter<LongtailAccount>({
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID),
    resolveAccountSnapshot: ({ account }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: isConfigured(account),
      extra: { provider: account.provider || null },
    }),
  }),
  message: createChannelMessageAdapterFromOutbound({ id, outbound }),
  outbound,
};
