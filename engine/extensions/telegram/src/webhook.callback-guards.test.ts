// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:extensions/telegram/src/webhook.test.ts (atlas CHAT-APPS-0119). Changed for Branch: resolve the Gateway port selected by the test environment.
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import type { Api } from "grammy";
import { closeBranchStateDatabaseForTest } from "branch/plugin-sdk/channel-ingress-test-runtime";

import { closeBranchStateDatabaseAsync } from "branch/plugin-sdk/sqlite-runtime-testing";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTelegramApprovalCallbackData } from "./approval-callback-data.js";

import { installTelegramIngressQueueRuntime } from "./runtime-state.test-support.js";

import { clearTelegramRuntimeForTest as clearTelegramRuntime } from "./runtime.test-support.js";

import { openTelegramIngressQueue } from "./telegram-ingress-spool.js";
import { writeTelegramSpooledUpdate } from "./telegram-ingress-spool.test-support.js";
import { createTelegramPrivateTopicCallback } from "./test-support/webhook-fixtures.js";
import { createTelegramWebhookTestGateway } from "./test-support/webhook-gateway.js";

const legacyListenerForRequest = vi.hoisted(() =>
  vi.fn((): { port: number; host?: string } | undefined => undefined),
);
vi.mock("branch/plugin-sdk/webhook-ingress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/webhook-ingress")>()),
  getWebhookLegacyListener: legacyListenerForRequest,
}));

const handleUpdateSpy = vi.hoisted(() => vi.fn((..._args: unknown[]): unknown => undefined));
const answerCallbackQuerySpy = vi.hoisted(() => vi.fn(async () => true));
const setWebhookSpy = vi.hoisted(() => vi.fn<Api["setWebhook"]>());
const deleteWebhookSpy = vi.hoisted(() => vi.fn(async () => true));
const initSpy = vi.hoisted(() => vi.fn(async () => undefined));
const stopSpy = vi.hoisted(() => vi.fn());
const webhookBotInfo = vi.hoisted(() => ({
  id: 123,
  is_bot: true as const,
  first_name: "Branch Agent",
  username: "branch_bot",
  has_topics_enabled: false,
}));
const createWebhookBot = vi.hoisted(() => () => ({
  init: initSpy,
  botInfo: webhookBotInfo,
  handleUpdate: handleUpdateSpy,
  api: {
    setWebhook: setWebhookSpy,
    deleteWebhook: deleteWebhookSpy,
    answerCallbackQuery: answerCallbackQuerySpy,
  },
  stop: stopSpy,
}));
const createTelegramBotSpy = vi.hoisted(() => vi.fn(createWebhookBot));
const transportCloseSpies = vi.hoisted(() => [] as Array<ReturnType<typeof vi.fn>>);
const resolveTelegramTransportSpy = vi.hoisted(() =>
  vi.fn(() => {
    const close = vi.fn(async () => undefined);
    transportCloseSpies.push(close);
    return {
      fetch: globalThis.fetch,
      sourceFetch: globalThis.fetch,
      close,
    };
  }),
);

const TELEGRAM_TOKEN = "tok";
const TELEGRAM_SECRET = "secret";
const TELEGRAM_WEBHOOK_PATH = "/hook";

vi.mock("grammy", async () => {
  const actual = await vi.importActual<typeof import("grammy")>("grammy");
  return {
    ...actual,
    API_CONSTANTS: actual.API_CONSTANTS ?? {
      DEFAULT_UPDATE_TYPES: ["message"],
      ALL_UPDATE_TYPES: ["message"],
    },
    InputFile:
      actual.InputFile ??
      class InputFile {
        constructor(public readonly path: string) {}
      },
    GrammyError:
      actual.GrammyError ??
      class GrammyError extends Error {
        description = "";
      },
  };
});

vi.mock("./bot.js", () => ({
  createTelegramBot: createTelegramBotSpy,
}));

vi.mock("./fetch.js", () => ({
  resolveTelegramTransport: resolveTelegramTransportSpy,
}));

const gateway = createTelegramWebhookTestGateway({
  token: TELEGRAM_TOKEN,
  queueScope: requireWebhookQueueScope,
});
const {
  startWebhook: startTelegramWebhook,
  server: gatewayServer,
  pendingRequests: pendingRouteRequests,
  withWebhook: withStartedWebhook,
} = gateway;
let webhookStateDir: string | undefined;

function requireWebhookQueueScope() {
  if (!webhookStateDir) {
    throw new Error("webhook state dir not initialized");
  }
  return { stateDir: webhookStateDir, accountId: "test" };
}

function resetTelegramWebhookMocks(): void {
  legacyListenerForRequest.mockReset().mockReturnValue(undefined);
  handleUpdateSpy.mockReset();
  handleUpdateSpy.mockImplementation((..._args: unknown[]): unknown => undefined);
  answerCallbackQuerySpy.mockReset();
  answerCallbackQuerySpy.mockImplementation(async () => true);

  setWebhookSpy.mockReset();
  deleteWebhookSpy.mockReset();
  deleteWebhookSpy.mockImplementation(async () => true);
  initSpy.mockReset();
  initSpy.mockImplementation(async () => undefined);
  stopSpy.mockReset();
  resolveTelegramTransportSpy.mockClear();
  transportCloseSpies.length = 0;
  webhookBotInfo.has_topics_enabled = false;
  createTelegramBotSpy.mockReset();
  createTelegramBotSpy.mockImplementation(createWebhookBot);
}

beforeAll(() => gateway.listen());
afterAll(() => gateway.close());

beforeEach(async () => {
  gateway.resetRegistry();
  resetTelegramWebhookMocks();
  webhookStateDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), "branch-telegram-webhook-"));
  installTelegramIngressQueueRuntime(() => webhookStateDir ?? os.tmpdir());
  // The production monitor prepares shared state before starting the webhook.
  await openTelegramIngressQueue(requireWebhookQueueScope()).listPending();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  clearTelegramRuntime();
  await closeBranchStateDatabaseAsync();
  closeBranchStateDatabaseForTest();
  const stateDir = webhookStateDir;
  webhookStateDir = undefined;
  if (stateDir) {
    await fs.rm(stateDir, { recursive: true, force: true });
  }
});

describe("startTelegramWebhook", () => {
  it.each([
    {
      name: "a bot callback sender",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        from: { ...callback.from, is_bot: true },
      }),
    },
    {
      name: "an invalid callback sender",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        from: { ...callback.from, id: 0 },
      }),
    },
    {
      name: "a foreign bot-authored message",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        message: {
          ...callback.message,
          from: { ...callback.message.from, id: 999 },
        },
      }),
    },
    {
      name: "an inaccessible callback message",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        message: { ...callback.message, date: 0 },
      }),
    },
    {
      name: "an independent business chat",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        message: { ...callback.message, business_connection_id: "business-1234" },
      }),
    },
    {
      name: "an independent guest chat",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        message: { ...callback.message, guest_query_id: "guest-1234" },
      }),
    },
    {
      name: "a message sent by another chat",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        message: { ...callback.message, sender_chat: { id: -1234, type: "channel" } },
      }),
    },
    {
      name: "a direct-messages topic from another surface",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        message: { ...callback.message, direct_messages_topic: { topic_id: 42 } },
      }),
    },
    {
      name: "an inline callback message",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        inline_message_id: "inline-message-141",
      }),
    },
    {
      name: "an oversized callback payload",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: "x".repeat(65),
      }),
    },
    {
      name: "a missing chat instance",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        chat_instance: "",
      }),
    },
    {
      name: "a reserved question callback",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: "tgq1:ask_0123456789abcdef0123456789abcdef:1",
      }),
    },
    {
      name: "a reserved approval callback",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: "/approve exec:def456 deny",
      }),
    },
    {
      name: "a malformed signed approval decision",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "exec",
          approvalId: "signed-approval",
          decision: "allow-once",
        })?.replace(":o:", ":z:"),
      }),
    },
    {
      name: "a malformed signed approval without a topic",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "exec",
          approvalId: "signed-approval",
          decision: "allow-once",
        })?.replace(":o:", ":z:"),
        message: { ...callback.message, message_thread_id: undefined },
      }),
    },
    {
      name: "a malformed signed approval kind",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "exec",
          approvalId: "signed-approval",
          decision: "allow-once",
        })?.replace(":e:", ":x:"),
      }),
    },
    {
      name: "a signed approval missing its canonical identifier",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "plugin",
          approvalId: "signed-approval",
          decision: "deny",
        })?.replace(/signed-approval$/, ""),
      }),
    },
    {
      name: "a signed approval in another business namespace",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "exec",
          approvalId: "signed-approval",
          decision: "allow-once",
        }),
        message: { ...callback.message, business_connection_id: "business-1234" },
      }),
    },
    {
      name: "a signed approval in another guest namespace",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "plugin",
          approvalId: "signed-approval",
          decision: "deny",
        }),
        message: { ...callback.message, guest_query_id: "guest-1234" },
      }),
    },
    {
      name: "a signed approval from a foreign bot",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "exec",
          approvalId: "signed-approval",
          decision: "allow-once",
        }),
        message: { ...callback.message, from: { ...callback.message.from, id: 999 } },
      }),
    },
    {
      name: "a signed approval from an invalid actor",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "plugin",
          approvalId: "signed-approval",
          decision: "deny",
        }),
        from: { ...callback.from, id: 0 },
      }),
    },
    {
      name: "a signed approval for another chat",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "exec",
          approvalId: "signed-approval",
          decision: "allow-once",
        }),
        message: { ...callback.message, chat: { ...callback.message.chat, id: 9999 } },
      }),
    },
    {
      name: "an inline signed approval",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: buildTelegramApprovalCallbackData({
          type: "approval",
          approvalKind: "exec",
          approvalId: "signed-approval",
          decision: "allow-once",
        }),
        inline_message_id: "inline-message-141",
      }),
    },
    {
      name: "a malformed reserved question callback",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: "tgq1:ask_0123456789abcdef0123456789abcdef:9",
      }),
    },
    {
      name: "a reserved question callback without a topic",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        data: "tgq1:ask_0123456789abcdef0123456789abcdef:1",
        message: { ...callback.message, message_thread_id: undefined },
      }),
    },
    {
      name: "an ordinary callback without a topic",
      mutate: (callback: ReturnType<typeof createTelegramPrivateTopicCallback>) => ({
        ...callback,
        message: { ...callback.message, message_thread_id: undefined },
      }),
    },
  ])("does not authorize durable-lane reconciliation for $name", async ({ mutate }) => {
    const laneKey = "telegram:1234:topic:42";
    await writeTelegramSpooledUpdate({
      ...requireWebhookQueueScope(),
      update: {
        update_id: 141,
        callback_query: mutate(createTelegramPrivateTopicCallback(141, webhookBotInfo.id)),
      },
      laneKey,
    });
    await closeBranchStateDatabaseAsync();
    closeBranchStateDatabaseForTest();

    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
      },
      async ({ ingress }) => {
        await ingress.waitForIdle();
        expect(
          await openTelegramIngressQueue(requireWebhookQueueScope()).listFailed?.({ limit: "all" }),
        ).toMatchObject([{ reason: "invalid-event", laneKey }]);
        expect(handleUpdateSpy).not.toHaveBeenCalled();
      },
    );
  });
});
