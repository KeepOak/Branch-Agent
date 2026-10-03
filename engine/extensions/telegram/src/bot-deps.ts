import {
  resolveApprovalOverGateway,
  type ApprovalResolveResult,
} from "branch/plugin-sdk/approval-gateway-runtime";
import type { ChannelApprovalKind } from "branch/plugin-sdk/approval-handler-runtime";
import type { ExecApprovalReplyDecision } from "branch/plugin-sdk/approval-reply-runtime";
import { recordChannelActivity } from "branch/plugin-sdk/channel-activity-runtime";
import { buildChannelInboundEventContext } from "branch/plugin-sdk/channel-inbound";
import {
  createChannelMessageReplyPipeline,
  deliverStructuredInboundReplyWithMessageSendContext,
} from "branch/plugin-sdk/channel-outbound";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import {
  readChannelAllowFromStore,
  recordInboundSession,
  upsertChannelPairingRequest,
} from "branch/plugin-sdk/conversation-runtime";
import { buildPreparedModelsProviderData } from "branch/plugin-sdk/models-provider-runtime";
import { dispatchReplyWithBufferedBlockDispatcher } from "branch/plugin-sdk/reply-dispatch-runtime";
import { resolveInboundLastRouteSessionKey } from "branch/plugin-sdk/routing";
import { getRuntimeConfig } from "branch/plugin-sdk/runtime-config-snapshot";
import { resolvePinnedMainDmOwnerFromAllowlist } from "branch/plugin-sdk/security-runtime";
import {
  getSessionEntry,
  readSessionUpdatedAt,
  readAmbientTranscriptWatermark,
  resolveAmbientTranscriptWatermarkKey,
  resolveStorePath,
} from "branch/plugin-sdk/session-store-runtime";
import { listSkillCommandsForAgents } from "branch/plugin-sdk/skill-commands-runtime";
import { enqueueRoutedSystemEvent } from "branch/plugin-sdk/system-event-runtime";
import { loadWebMedia } from "branch/plugin-sdk/web-media";
import { syncTelegramMenuCommands } from "./bot-native-command-menu.js";
import {
  deliverReplies,
  deliverStructuredReplies,
  emitTelegramMessageSentHooks,
} from "./bot/delivery.js";
import { createTelegramDraftStream } from "./draft-stream.js";
import { recordOutboundMessageForPromptContext } from "./outbound-message-context.js";
import { editMessageTelegram } from "./send.js";
import { wasSentByBot } from "./sent-message-cache.js";

type ResolveTelegramApprovalParams = {
  cfg: BranchConfig;
  approvalId: string;
  decision: ExecApprovalReplyDecision;
  channel: "telegram";
  senderId?: string | null;
  gatewayUrl?: string;
} & (
  | { approvalKind: ChannelApprovalKind; resolveMethod?: never }
  | { approvalKind?: never; resolveMethod: ChannelApprovalKind }
);

type ResolveTelegramApproval = (
  params: ResolveTelegramApprovalParams,
) => Promise<ApprovalResolveResult | void>;

export type TelegramBotDeps = {
  getRuntimeConfig: typeof getRuntimeConfig;
  resolveStorePath: typeof resolveStorePath;
  getSessionEntry?: typeof getSessionEntry;
  readSessionUpdatedAt?: typeof readSessionUpdatedAt;
  readAmbientTranscriptWatermark?: typeof readAmbientTranscriptWatermark;
  resolveAmbientTranscriptWatermarkKey?: typeof resolveAmbientTranscriptWatermarkKey;
  recordInboundSession?: typeof recordInboundSession;
  recordChannelActivity?: typeof recordChannelActivity;
  resolveInboundLastRouteSessionKey?: typeof resolveInboundLastRouteSessionKey;
  resolvePinnedMainDmOwnerFromAllowlist?: typeof resolvePinnedMainDmOwnerFromAllowlist;
  buildChannelInboundEventContext?: typeof buildChannelInboundEventContext;
  readChannelAllowFromStore: typeof readChannelAllowFromStore;
  upsertChannelPairingRequest: typeof upsertChannelPairingRequest;
  enqueueRoutedSystemEvent: typeof enqueueRoutedSystemEvent;
  dispatchReplyWithBufferedBlockDispatcher: typeof dispatchReplyWithBufferedBlockDispatcher;
  loadWebMedia?: typeof loadWebMedia;
  buildModelsProviderData: typeof buildPreparedModelsProviderData;
  listSkillCommandsForAgents: typeof listSkillCommandsForAgents;
  syncTelegramMenuCommands?: typeof syncTelegramMenuCommands;
  wasSentByBot: (...args: Parameters<typeof wasSentByBot>) => boolean | Promise<boolean>;
  resolveApproval?: ResolveTelegramApproval;
  createTelegramDraftStream?: typeof createTelegramDraftStream;
  deliverReplies?: typeof deliverReplies;
  deliverStructuredReplies?: typeof deliverStructuredReplies;
  deliverStructuredInboundReplyWithMessageSendContext?: typeof deliverStructuredInboundReplyWithMessageSendContext;
  emitTelegramMessageSentHooks?: typeof emitTelegramMessageSentHooks;
  editMessageTelegram?: typeof editMessageTelegram;
  recordOutboundMessageForPromptContext?: typeof recordOutboundMessageForPromptContext;
  createChannelMessageReplyPipeline?: typeof createChannelMessageReplyPipeline;
};

export const defaultTelegramBotDeps: TelegramBotDeps = {
  get getRuntimeConfig() {
    return getRuntimeConfig;
  },
  get resolveStorePath() {
    return resolveStorePath;
  },
  get getSessionEntry() {
    return getSessionEntry;
  },
  get readChannelAllowFromStore() {
    return readChannelAllowFromStore;
  },
  get readSessionUpdatedAt() {
    return readSessionUpdatedAt;
  },
  get readAmbientTranscriptWatermark() {
    return readAmbientTranscriptWatermark;
  },
  get resolveAmbientTranscriptWatermarkKey() {
    return resolveAmbientTranscriptWatermarkKey;
  },
  get recordInboundSession() {
    return recordInboundSession;
  },
  get recordChannelActivity() {
    return recordChannelActivity;
  },
  get resolveInboundLastRouteSessionKey() {
    return resolveInboundLastRouteSessionKey;
  },
  get resolvePinnedMainDmOwnerFromAllowlist() {
    return resolvePinnedMainDmOwnerFromAllowlist;
  },
  get buildChannelInboundEventContext() {
    return buildChannelInboundEventContext;
  },
  get upsertChannelPairingRequest() {
    return upsertChannelPairingRequest;
  },
  get enqueueRoutedSystemEvent() {
    return enqueueRoutedSystemEvent;
  },
  get dispatchReplyWithBufferedBlockDispatcher() {
    return dispatchReplyWithBufferedBlockDispatcher;
  },
  get loadWebMedia() {
    return loadWebMedia;
  },
  get buildModelsProviderData() {
    return buildPreparedModelsProviderData;
  },
  get listSkillCommandsForAgents() {
    return listSkillCommandsForAgents;
  },
  get syncTelegramMenuCommands() {
    return syncTelegramMenuCommands;
  },
  get wasSentByBot() {
    return wasSentByBot;
  },
  get resolveApproval() {
    return resolveApprovalOverGateway as ResolveTelegramApproval;
  },
  get createTelegramDraftStream() {
    return createTelegramDraftStream;
  },
  get deliverReplies() {
    return deliverReplies;
  },
  get deliverStructuredReplies() {
    return deliverStructuredReplies;
  },
  get deliverStructuredInboundReplyWithMessageSendContext() {
    return deliverStructuredInboundReplyWithMessageSendContext;
  },
  get emitTelegramMessageSentHooks() {
    return emitTelegramMessageSentHooks;
  },
  get editMessageTelegram() {
    return editMessageTelegram;
  },
  get recordOutboundMessageForPromptContext() {
    return recordOutboundMessageForPromptContext;
  },
  get createChannelMessageReplyPipeline() {
    return createChannelMessageReplyPipeline;
  },
};
