// From openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3:extensions/telegram/src/webhook.test.ts (atlas CHAT-APPS-0119). Changed for Branch: resolve the Gateway port selected by the test environment.
import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import type { Api } from "grammy";
import { closeBranchStateDatabaseForTest } from "branch/plugin-sdk/channel-ingress-test-runtime";

import { createDeferred } from "branch/plugin-sdk/extension-shared";

import { closeBranchStateDatabaseAsync } from "branch/plugin-sdk/sqlite-runtime-testing";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTelegramApprovalCallbackData } from "./approval-callback-data.js";

import { installTelegramIngressQueueRuntime } from "./runtime-state.test-support.js";

import { clearTelegramRuntimeForTest as clearTelegramRuntime } from "./runtime.test-support.js";

import { openTelegramIngressQueue } from "./telegram-ingress-spool.js";
import {
  writeTelegramSpooledUpdate,
  listTelegramSpooledUpdates,
} from "./telegram-ingress-spool.test-support.js";
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
      topicsEnabled: false,
      persistedLaneKey: "telegram:1234:topic:42",
      canonicalLaneKey: "telegram:1234",
    },
    {
      topicsEnabled: true,
      persistedLaneKey: "telegram:1234",
      canonicalLaneKey: "telegram:1234:topic:42",
    },
  ])(
    "replays acknowledged legacy DM lanes after restart when topic capability is $topicsEnabled",
    async ({ topicsEnabled, persistedLaneKey, canonicalLaneKey }) => {
      webhookBotInfo.has_topics_enabled = topicsEnabled;
      const firstUpdate = {
        update_id: 130,
        message: {
          chat: { id: 1234, type: "private" },
          message_id: 1,
          message_thread_id: 42,
          text: "accepted before restart",
        },
      };
      const secondUpdate = {
        update_id: 131,
        message: {
          chat: { id: 1234, type: "private" },
          message_id: 2,
          ...(topicsEnabled ? { message_thread_id: 42 } : {}),
          text: "accepted after the first event",
        },
      };
      await writeTelegramSpooledUpdate({
        ...requireWebhookQueueScope(),
        update: firstUpdate,
        laneKey: persistedLaneKey,
      });
      await writeTelegramSpooledUpdate({
        ...requireWebhookQueueScope(),
        update: secondUpdate,
        laneKey: canonicalLaneKey,
      });
      expect(
        (await openTelegramIngressQueue(requireWebhookQueueScope()).listPending()).map(
          (record) => record.laneKey,
        ),
      ).toEqual([persistedLaneKey, canonicalLaneKey]);
      await closeBranchStateDatabaseAsync();
      closeBranchStateDatabaseForTest();

      const seenUpdateIds: number[] = [];
      const firstUpdateStarted = createDeferred<void>();
      let releaseFirstUpdate: (() => void) | undefined;
      const firstUpdateCompleted = new Promise<void>((resolve) => {
        releaseFirstUpdate = resolve;
      });
      handleUpdateSpy.mockImplementation(async (update: unknown) => {
        const updateId = (update as { update_id: number }).update_id;
        seenUpdateIds.push(updateId);
        if (updateId === firstUpdate.update_id) {
          firstUpdateStarted.resolve();
          await firstUpdateCompleted;
        }
      });

      try {
        await withStartedWebhook(
          {
            secret: TELEGRAM_SECRET,
            path: TELEGRAM_WEBHOOK_PATH,
          },
          async ({ ingress }) => {
            await firstUpdateStarted.promise;
            await ingress.waitForPumpIdle();
            expect(seenUpdateIds).toEqual([130]);

            releaseFirstUpdate?.();
            await ingress.waitForIdle();
            expect(seenUpdateIds).toEqual([130, 131]);
            expect(await listTelegramSpooledUpdates(requireWebhookQueueScope())).toEqual([]);
            expect(
              await openTelegramIngressQueue(requireWebhookQueueScope()).listFailed?.(),
            ).toEqual([]);
            expect(handleUpdateSpy).toHaveBeenCalledTimes(2);
          },
        );
      } finally {
        releaseFirstUpdate?.();
      }
    },
  );

  it.each([
    {
      approvalKind: "exec" as const,
      topicsEnabled: false,
      persistedLaneKey: "telegram:1234:topic:42",
    },
    {
      approvalKind: "plugin" as const,
      topicsEnabled: false,
      persistedLaneKey: "telegram:1234:topic:42",
    },
    { approvalKind: "exec" as const, topicsEnabled: true, persistedLaneKey: "telegram:1234" },
    { approvalKind: "plugin" as const, topicsEnabled: true, persistedLaneKey: "telegram:1234" },
    {
      approvalKind: "exec" as const,
      topicsEnabled: false,
      persistedLaneKey: "telegram:1234",
      hasThread: false,
    },
    {
      approvalKind: "plugin" as const,
      topicsEnabled: false,
      persistedLaneKey: "telegram:1234",
      hasThread: false,
    },
    {
      approvalKind: "exec" as const,
      topicsEnabled: true,
      persistedLaneKey: "telegram:1234",
      hasThread: false,
    },
    {
      approvalKind: "plugin" as const,
      topicsEnabled: true,
      persistedLaneKey: "telegram:1234",
      hasThread: false,
    },
    {
      approvalKind: "exec" as const,
      topicsEnabled: false,
      persistedLaneKey: "telegram:-1234",
      hasThread: false,
      chatId: -1234,
      chatType: "group" as const,
    },
    {
      approvalKind: "plugin" as const,
      topicsEnabled: true,
      persistedLaneKey: "telegram:-1234",
      hasThread: false,
      chatId: -1234,
      chatType: "group" as const,
    },
    {
      approvalKind: "exec" as const,
      topicsEnabled: false,
      persistedLaneKey: "telegram:-1001234",
      hasThread: false,
      chatId: -1001234,
      chatType: "supergroup" as const,
    },
    {
      approvalKind: "plugin" as const,
      topicsEnabled: true,
      persistedLaneKey: "telegram:-1001234",
      hasThread: false,
      chatId: -1001234,
      chatType: "supergroup" as const,
    },
    {
      approvalKind: "exec" as const,
      topicsEnabled: false,
      persistedLaneKey: "telegram:-1001234:topic:42",
      chatId: -1001234,
      chatType: "supergroup" as const,
      isForum: true,
    },
    {
      approvalKind: "plugin" as const,
      topicsEnabled: true,
      persistedLaneKey: "telegram:-1001234:topic:42",
      chatId: -1001234,
      chatType: "supergroup" as const,
      isForum: true,
    },
    {
      approvalKind: "exec" as const,
      topicsEnabled: false,
      persistedLaneKey: "telegram:-1001234:topic:1",
      hasThread: false,
      chatId: -1001234,
      chatType: "supergroup" as const,
      isForum: true,
    },
    {
      approvalKind: "plugin" as const,
      topicsEnabled: true,
      persistedLaneKey: "telegram:-1001234:topic:1",
      hasThread: false,
      chatId: -1001234,
      chatType: "supergroup" as const,
      isForum: true,
    },
  ])(
    "replays acknowledged typed $approvalKind approvals in their privileged lane (chat=$chatType, topics=$topicsEnabled, thread=$hasThread)",
    async ({
      approvalKind,
      topicsEnabled,
      persistedLaneKey,
      hasThread,
      chatId,
      chatType,
      isForum,
    }) => {
      webhookBotInfo.has_topics_enabled = topicsEnabled;
      const callback = createTelegramPrivateTopicCallback(142, webhookBotInfo.id);
      const expectedChatId = chatId ?? callback.message.chat.id;
      const update = {
        update_id: 142,
        callback_query: {
          ...callback,
          message: {
            ...callback.message,
            chat: {
              ...callback.message.chat,
              id: expectedChatId,
              type: chatType ?? callback.message.chat.type,
              ...(isForum ? { is_forum: true } : {}),
            },
            ...(hasThread === false ? { message_thread_id: undefined } : {}),
          },
          data: buildTelegramApprovalCallbackData({
            type: "approval",
            approvalKind,
            approvalId: "signed-approval",
            decision: "allow-once",
          }),
        },
      };
      await writeTelegramSpooledUpdate({
        ...requireWebhookQueueScope(),
        update,
        laneKey: persistedLaneKey,
      });
      await closeBranchStateDatabaseAsync();
      closeBranchStateDatabaseForTest();

      handleUpdateSpy.mockImplementationOnce(async () => {
        expect(
          await openTelegramIngressQueue(requireWebhookQueueScope()).listClaims(),
        ).toMatchObject([{ laneKey: `telegram:${expectedChatId}:approval` }]);
      });

      await withStartedWebhook(
        { secret: TELEGRAM_SECRET, path: TELEGRAM_WEBHOOK_PATH },
        async ({ ingress }) => {
          await ingress.waitForIdle();
          expect(handleUpdateSpy).toHaveBeenCalledOnce();
          expect(handleUpdateSpy).toHaveBeenCalledWith(update);
          expect(await openTelegramIngressQueue(requireWebhookQueueScope()).listFailed?.()).toEqual(
            [],
          );
        },
      );
    },
  );

  it.each([
    {
      topicsEnabled: false,
      persistedLaneKey: "telegram:1234:topic:42",
    },
    {
      topicsEnabled: true,
      persistedLaneKey: "telegram:1234",
    },
    {
      topicsEnabled: false,
      persistedLaneKey: "telegram:1234:topic:42",
      callbackIdentityLength: 128,
    },
  ])(
    "replays legitimate private callbacks after a topic-capability transition ($topicsEnabled)",
    async ({ topicsEnabled, persistedLaneKey, callbackIdentityLength }) => {
      webhookBotInfo.has_topics_enabled = topicsEnabled;
      const update = {
        update_id: 140,
        callback_query: {
          ...createTelegramPrivateTopicCallback(140, webhookBotInfo.id),
          ...(callbackIdentityLength
            ? {
                id: "i".repeat(callbackIdentityLength),
                chat_instance: "c".repeat(callbackIdentityLength),
              }
            : {}),
        },
      };
      await writeTelegramSpooledUpdate({
        ...requireWebhookQueueScope(),
        update,
        laneKey: persistedLaneKey,
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
          expect(handleUpdateSpy).toHaveBeenCalledOnce();
          expect(handleUpdateSpy).toHaveBeenCalledWith(update);
          expect(await openTelegramIngressQueue(requireWebhookQueueScope()).listFailed?.()).toEqual(
            [],
          );
        },
      );
    },
  );
});
