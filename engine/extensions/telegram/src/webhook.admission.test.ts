import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { Api } from "grammy";
import {
  closeBranchStateDatabaseForTest,
  createChannelIngressQueueForTests as createChannelIngressQueue,
} from "branch/plugin-sdk/channel-ingress-test-runtime";

import { createPluginRuntimeMock } from "branch/plugin-sdk/channel-test-helpers";

import { createDeferred } from "branch/plugin-sdk/extension-shared";
import { resolveGatewayPort } from "branch/plugin-sdk/gateway-config-runtime";

import { closeBranchStateDatabaseAsync } from "branch/plugin-sdk/sqlite-runtime-testing";

import { WEBHOOK_RATE_LIMIT_DEFAULTS } from "branch/plugin-sdk/webhook-ingress";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installTelegramIngressQueueRuntime } from "./runtime-state.test-support.js";
import { setTelegramRuntime } from "./runtime.js";
import { clearTelegramRuntimeForTest as clearTelegramRuntime } from "./runtime.test-support.js";
import type { TelegramRuntime } from "./runtime.types.js";
import { openTelegramIngressQueue } from "./telegram-ingress-spool.js";
import {
  writeTelegramSpooledUpdate,
  listTelegramSpooledUpdates,
} from "./telegram-ingress-spool.test-support.js";
import {
  createNearLimitTelegramPayload,
  createTelegramPrivateTopicCallback,
  expectSingleNearLimitUpdate,
  requireMockCall,
  requireRecord,
  telegramMessageUpdate,
  telegramWebhookListenerCases,
  waitForWebhookState,
  type TestTelegramMessageUpdate,
} from "./test-support/webhook-fixtures.js";
import {
  createTelegramWebhookTestGateway,
  getServerPort,
  webhookUrl,
} from "./test-support/webhook-gateway.js";
import {
  postWebhookHeadersOnly,
  postWebhookJson,
  postWebhookPayloadWithChunkPlan,
  postWebhookWithDeclaredLength,
} from "./test-support/webhook-http.js";

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

const WEBHOOK_POST_TIMEOUT_MS = process.platform === "win32" ? 20_000 : 8_000;
const TELEGRAM_TOKEN = "tok";
const TELEGRAM_SECRET = "secret";
const TELEGRAM_WEBHOOK_PATH = "/hook";
const TELEGRAM_WEBHOOK_RATE_LIMIT_BURST = WEBHOOK_RATE_LIMIT_DEFAULTS.maxRequests + 10;

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

// mock-isolation: webhook tests drive the Telegram bot and transport through spy factories, not the real clients.
vi.mock("./bot.js", () => ({
  createTelegramBot: createTelegramBotSpy,
}));

// mock-isolation: webhook tests drive the Telegram bot and transport through spy factories, not the real clients.
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

async function runNearLimitPayloadTestAndExpectUpdate(
  mode: "single" | "random-chunked",
): Promise<void> {
  const seenUpdates: TestTelegramMessageUpdate[] = [];
  handleUpdateSpy.mockImplementationOnce((update: unknown) => {
    seenUpdates.push(update as TestTelegramMessageUpdate);
  });

  const { payload, sizeBytes } = createNearLimitTelegramPayload();
  expect(sizeBytes).toBeLessThan(1_024 * 1_024);
  expect(sizeBytes).toBeGreaterThan(256 * 1_024);
  const expected = JSON.parse(payload) as TestTelegramMessageUpdate;

  await withStartedWebhook(
    {
      secret: TELEGRAM_SECRET,
      path: TELEGRAM_WEBHOOK_PATH,
    },
    async ({ port, ingress }) => {
      const response = await postWebhookPayloadWithChunkPlan({
        port,
        path: TELEGRAM_WEBHOOK_PATH,
        payload,
        secret: TELEGRAM_SECRET,
        mode,
        timeoutMs: WEBHOOK_POST_TIMEOUT_MS,
      });

      expect(response.statusCode).toBe(200);
      // The 200 means durable admission; dispatch reads the ~1 MB row back from
      // SQLite afterward, so join the drain instead of polling a wall-clock budget.
      await ingress.waitForIdle();
      expectSingleNearLimitUpdate({ seenUpdates, expected });
    },
  );
}

describe("startTelegramWebhook", () => {
  it.each(["telegram:9999:topic:42", "telegram:1234:topic:99", "telegram:1234:control"])(
    "rejects persisted DM lanes outside the signed upgrade contract (%s)",
    async (laneKey) => {
      await writeTelegramSpooledUpdate({
        ...requireWebhookQueueScope(),
        update: {
          update_id: 132,
          message: {
            chat: { id: 1234, type: "private" },
            message_id: 1,
            message_thread_id: 42,
            text: "reject mismatched durable identity",
          },
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
            await openTelegramIngressQueue(requireWebhookQueueScope()).listFailed?.({
              limit: "all",
            }),
          ).toMatchObject([{ reason: "invalid-event", laneKey }]);
          expect(handleUpdateSpy).not.toHaveBeenCalled();
          expect(await listTelegramSpooledUpdates(requireWebhookQueueScope())).toEqual([]);
        },
      );
    },
  );

  it("leaves another account's pending ingress untouched", async () => {
    await writeTelegramSpooledUpdate({
      ...requireWebhookQueueScope(),
      update: telegramMessageUpdate(133, "other account pending"),
    });
    const ownUpdate = telegramMessageUpdate(134, "this account receives");
    const delivered = createDeferred<void>();
    handleUpdateSpy.mockImplementationOnce(() => delivered.resolve());

    await withStartedWebhook(
      { accountId: "other", secret: TELEGRAM_SECRET, path: TELEGRAM_WEBHOOK_PATH },
      async ({ port }) => {
        const response = await postWebhookJson({
          url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
          payload: JSON.stringify(ownUpdate),
          secret: TELEGRAM_SECRET,
        });
        expect(response.status).toBe(200);
        await delivered.promise;
        expect(handleUpdateSpy).toHaveBeenCalledWith(ownUpdate);
        expect(handleUpdateSpy).toHaveBeenCalledOnce();
        expect(await listTelegramSpooledUpdates(requireWebhookQueueScope())).toMatchObject([
          { updateId: 133 },
        ]);
        expect(await openTelegramIngressQueue(requireWebhookQueueScope()).listClaims()).toEqual([]);
      },
    );
  });

  it.each([
    {
      name: "a malformed callback query",
      update: {
        update_id: 134,
        callback_query: {
          data: "unrecognized-callback",
          message: {
            chat: { id: 1234, type: "private" },
            message_id: 1,
            message_thread_id: 42,
          },
        },
      },
    },
    {
      name: "a group message",
      update: {
        update_id: 135,
        message: {
          chat: { id: 1234, type: "group" },
          message_id: 1,
          message_thread_id: 42,
          text: "wrong chat kind",
        },
      },
    },
  ])("rejects legacy lane reconciliation for $name", async ({ update }) => {
    const laneKey = "telegram:1234:topic:42";
    await writeTelegramSpooledUpdate({
      ...requireWebhookQueueScope(),
      update,
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

  it("stops claimed completion retries when the webhook stops", async () => {
    vi.useFakeTimers();
    let completeAttempts = 0;
    setTelegramRuntime({
      channel: { inbound: { ingress: createPluginRuntimeMock().channel.inbound.ingress } },
      state: {
        resolveStateDir: () => webhookStateDir ?? os.tmpdir(),
        openChannelIngressQueue: (
          options?: Omit<Parameters<typeof createChannelIngressQueue>[0], "channelId">,
        ) => {
          const queue = createChannelIngressQueue({ ...options, channelId: "telegram" });
          return {
            ...queue,
            complete: async () => {
              completeAttempts += 1;
              throw new Error("persistent completion write failure");
            },
          };
        },
      },
    } as unknown as TelegramRuntime);
    await writeTelegramSpooledUpdate({
      ...requireWebhookQueueScope(),
      update: telegramMessageUpdate(52, "stop retry"),
    });
    const retryScheduled = createDeferred<void>();
    const runtimeLog = vi.fn((message: unknown) => {
      if (
        typeof message === "string" &&
        /completion retry 1 scheduled|tombstone retry 1\//.test(message)
      ) {
        retryScheduled.resolve();
      }
    });
    const started = await startTelegramWebhook({
      token: TELEGRAM_TOKEN,
      secret: TELEGRAM_SECRET,
      path: TELEGRAM_WEBHOOK_PATH,
      ...requireWebhookQueueScope(),
      runtime: { log: runtimeLog, error: vi.fn(), exit: vi.fn() },
    });

    try {
      await retryScheduled.promise;
      await started.stop();
      const attemptsAfterStop = completeAttempts;
      await vi.advanceTimersByTimeAsync(400);

      // Stop must abort in-flight tombstone retries (composed webhookAbortSignal).
      expect(completeAttempts).toBe(attemptsAfterStop);
    } finally {
      await started.stop();
    }
  });

  it("returns non-200 when the webhook update cannot be spooled durably", async () => {
    handleUpdateSpy.mockClear();
    answerCallbackQuerySpy.mockClear();
    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
      },
      async ({ port }) => {
        const response = await postWebhookJson({
          url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
          payload: JSON.stringify({
            callback_query: createTelegramPrivateTopicCallback(33, webhookBotInfo.id),
          }),
          secret: TELEGRAM_SECRET,
        });

        expect(response.status).toBe(500);
        expect(response.headers.get("x-branch-delivery-accepted")).toBeNull();
        expect(answerCallbackQuerySpy).not.toHaveBeenCalled();
        expect(handleUpdateSpy).not.toHaveBeenCalled();
      },
    );
  });

  it("rejects unauthenticated requests before reading the request body", async () => {
    handleUpdateSpy.mockClear();
    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
      },
      async ({ port }) => {
        const response = await postWebhookHeadersOnly({
          port,
          path: TELEGRAM_WEBHOOK_PATH,
          declaredLength: 1_024 * 1_024,
          secret: "wrong-secret",
        });

        expect(response.statusCode).toBe(401);
        expect(response.body).toBe("unauthorized");
        expect(handleUpdateSpy).not.toHaveBeenCalled();
      },
    );
  });

  it("rate limits repeated invalid secret guesses without throttling authenticated delivery", async () => {
    handleUpdateSpy.mockClear();
    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
      },
      async ({ port }) => {
        let saw429 = false;

        for (let i = 0; i < TELEGRAM_WEBHOOK_RATE_LIMIT_BURST; i += 1) {
          const response = await postWebhookJson({
            url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
            payload: JSON.stringify({ update_id: i, message: { text: `guess ${i}` } }),
            secret: `wrong-secret-${String(i).padStart(3, "0")}`,
          });

          if (response.status === 429) {
            saw429 = true;
            expect(response.headers.get("x-branch-delivery-accepted")).toBeNull();
            expect(await response.text()).toBe("Too Many Requests");
            break;
          }

          expect(response.status).toBe(401);
          expect(response.headers.get("x-branch-delivery-accepted")).toBeNull();
          expect(await response.text()).toBe("unauthorized");
        }

        expect(saw429).toBe(true);

        const validResponse = await postWebhookJson({
          url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
          payload: JSON.stringify(telegramMessageUpdate(999, "hello")),
          secret: TELEGRAM_SECRET,
        });
        expect(validResponse.status).toBe(200);
        expect(validResponse.headers.get("x-branch-delivery-accepted")).toBe("durable");
        expect(await validResponse.text()).toBe("");
        await waitForWebhookState(() => expect(handleUpdateSpy).toHaveBeenCalledTimes(1));
      },
    );
  });

  it("does not rate limit authenticated webhook request storms", async () => {
    handleUpdateSpy.mockClear();
    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
      },
      async ({ port }) => {
        for (let i = 0; i < TELEGRAM_WEBHOOK_RATE_LIMIT_BURST; i += 1) {
          const response = await postWebhookJson({
            url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
            payload: JSON.stringify(telegramMessageUpdate(10_000 + i, `valid ${i}`)),
            secret: TELEGRAM_SECRET,
          });
          expect(response.status).toBe(200);
        }
        await waitForWebhookState(() => expect(handleUpdateSpy).toHaveBeenCalled());
      },
    );
  });

  it.each([
    {
      name: "untrusted loopback hops",
      trustedProxy: "127.0.0.1",
      suffix: ", 127.0.0.2",
      otherHopStatus: 401,
    },
    {
      name: "ignored bracketed proxy entries",
      trustedProxy: "[127.0.0.1]",
      suffix: "",
      otherHopStatus: 429,
    },
  ])(
    "isolates legacy auth budgets and preserves $name across account restarts",
    async ({ trustedProxy, suffix, otherHopStatus }) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const endpoint = { port: 9000, host: "127.0.0.1" };
      const base = {
        token: TELEGRAM_TOKEN,
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
        ...requireWebhookQueueScope(),
        config: { gateway: { trustedProxies: [trustedProxy] } },
      };
      let first = await startTelegramWebhook({
        ...base,
        accountId: "first",
        legacyWebhook: endpoint,
      });
      const secondEndpoint = { ...endpoint, port: 9001 };
      let second: typeof first | undefined;
      let shared: typeof first | undefined;
      let updateId = 899;
      const request = async (forwarded: string, secret = "wrong-secret") => {
        const response = await fetch(
          webhookUrl(getServerPort(gatewayServer), TELEGRAM_WEBHOOK_PATH),
          {
            method: "POST",
            headers: { "x-telegram-bot-api-secret-token": secret, "x-forwarded-for": forwarded },
            body: JSON.stringify(telegramMessageUpdate(updateId++, "legacy budget")),
          },
        );
        const body = await response.text();
        return {
          status: response.status,
          body,
          accepted: response.headers.get("x-branch-delivery-accepted"),
        };
      };
      try {
        second = await startTelegramWebhook({
          ...base,
          accountId: "second",
          legacyWebhook: secondEndpoint,
        });
        legacyListenerForRequest.mockReturnValue(endpoint);
        for (let index = 1; index <= 120; index += 1) {
          expect((await request(`198.51.100.${index}${suffix}`)).status).toBe(401);
        }
        expect(await request(`203.0.113.1${suffix}`)).toEqual({
          status: 429,
          body: "Too Many Requests",
          accepted: null,
        });
        shared = await startTelegramWebhook({
          ...base,
          accountId: "shared",
          secret: "shared-secret",
          legacyWebhook: endpoint,
        });
        expect(await request(`203.0.113.1${suffix}`)).toEqual({
          status: 429,
          body: "Too Many Requests",
          accepted: null,
        });
        expect((await request("203.0.113.1, 127.0.0.3")).status).toBe(otherHopStatus);
        expect(await request(`203.0.113.1${suffix}`, "shared-secret")).toEqual({
          status: 200,
          body: "",
          accepted: "durable",
        });
        expect(await request(`203.0.113.1${suffix}`, TELEGRAM_SECRET)).toEqual({
          status: 200,
          body: "",
          accepted: "durable",
        });

        legacyListenerForRequest.mockReturnValue(secondEndpoint);
        expect((await request(`203.0.113.1${suffix}`)).status).toBe(401);
        legacyListenerForRequest.mockReturnValue(undefined);
        expect((await request(`203.0.113.1${suffix}`)).status).toBe(401);

        await shared.stop();
        await first.stop();
        first = await startTelegramWebhook({
          ...base,
          accountId: "first",
          legacyWebhook: endpoint,
        });
        legacyListenerForRequest.mockReturnValue(endpoint);
        expect((await request(`203.0.113.1${suffix}`)).status).toBe(401);
      } finally {
        await first.stop();
        await second?.stop();
        await shared?.stop();
      }
    },
  );

  it("rejects startup when webhook secret is missing", async () => {
    await expect(
      startTelegramWebhook({
        token: "tok",
      }),
    ).rejects.toThrow(/requires a non-empty secret token/i);
  });

  it.each([
    { path: "/hook?token=known", legacyWebhook: false as const },
    { path: "/ready/webhook", legacyWebhook: false as const },
    { path: "/readyz?token=known", legacyWebhook: { port: 8787, host: "127.0.0.1" } },
    { path: "/healthz?token=known", legacyWebhook: { port: 8787, host: "127.0.0.1" } },
    { path: "/%61pi/channels/telegram", legacyWebhook: { port: 8787, host: "127.0.0.1" } },
  ])("preserves exact webhook target $path", async ({ path, legacyWebhook }) => {
    await withStartedWebhook({ secret: TELEGRAM_SECRET, path, legacyWebhook }, async ({ port }) => {
      legacyListenerForRequest.mockReturnValue(legacyWebhook === false ? undefined : legacyWebhook);
      const accepted = await postWebhookJson({
        url: webhookUrl(port, path),
        payload: JSON.stringify(telegramMessageUpdate(807, "exact route")),
        secret: TELEGRAM_SECRET,
      });
      expect(accepted.status).toBe(200);
      const rejected = await postWebhookJson({
        url: webhookUrl(port, `${path}${path.includes("?") ? "&" : "?"}changed=true`),
        payload: JSON.stringify(telegramMessageUpdate(808, "wrong route")),
        secret: TELEGRAM_SECRET,
      });
      expect(rejected.status).toBe(404);
    });
  });

  it.each(telegramWebhookListenerCases)(
    "registers the public URL with $name legacy listener",
    async ({ legacyWebhook, endpoint, publicUrl, advertisedUrl }) => {
      const runtimeLog = vi.fn();
      await withStartedWebhook(
        {
          secret: TELEGRAM_SECRET,
          path: TELEGRAM_WEBHOOK_PATH,
          legacyWebhook,
          publicUrl,
          config: { gateway: { publicOrigin: "https://gateway.example.test" } },
          runtime: { log: runtimeLog, error: vi.fn(), exit: vi.fn() },
        },
        async ({ port }) => {
          expect(gateway.registry.httpRoutes[0]?.legacyListeners).toEqual(
            endpoint ? [{ ...endpoint, health: { path: "/healthz" } }] : undefined,
          );
          expect(port).toBeGreaterThan(0);
          expect(setWebhookSpy).toHaveBeenCalledTimes(1);
          const setWebhookCall = requireMockCall(setWebhookSpy, 0, "setWebhook");
          expect(setWebhookCall[0]).toBe(advertisedUrl);
          expect(requireRecord(setWebhookCall[1], "setWebhook options").secret_token).toBe(
            TELEGRAM_SECRET,
          );
          expect(runtimeLog).toHaveBeenCalledWith(
            `telegram webhook Gateway route ${TELEGRAM_WEBHOOK_PATH} (port ${resolveGatewayPort({ gateway: { publicOrigin: "https://gateway.example.test" } })})`,
          );
        },
      );
    },
  );

  it.each([
    { topicsEnabled: false, shouldSerialize: true },
    { topicsEnabled: true, shouldSerialize: false },
  ])(
    "matches DM session serialization to initialized bot topic capability ($topicsEnabled)",
    async ({ topicsEnabled, shouldSerialize }) => {
      webhookBotInfo.has_topics_enabled = topicsEnabled;
      const seenUpdateIds: number[] = [];
      let releaseFirstUpdate: (() => void) | undefined;
      const firstUpdateCompleted = new Promise<void>((resolve) => {
        releaseFirstUpdate = resolve;
      });
      handleUpdateSpy.mockImplementation(async (update: unknown) => {
        const updateId = (update as { update_id: number }).update_id;
        seenUpdateIds.push(updateId);
        if (updateId === 100) {
          await firstUpdateCompleted;
        }
      });

      await withStartedWebhook(
        {
          secret: TELEGRAM_SECRET,
          path: TELEGRAM_WEBHOOK_PATH,
        },
        async ({ port }) => {
          const url = webhookUrl(port, TELEGRAM_WEBHOOK_PATH);
          const firstUpdate = {
            update_id: 100,
            message: {
              chat: { id: 1234, type: "private" },
              message_id: 1,
              text: "first",
            },
          };
          const secondUpdate = {
            update_id: 101,
            message: {
              chat: { id: 1234, type: "private" },
              message_id: 2,
              message_thread_id: 42,
              text: "second",
            },
          };

          try {
            const firstResponse = await postWebhookJson({
              url,
              payload: JSON.stringify(firstUpdate),
              secret: TELEGRAM_SECRET,
            });
            expect(firstResponse.status).toBe(200);
            await waitForWebhookState(() => expect(seenUpdateIds).toEqual([100]));

            const secondResponse = await postWebhookJson({
              url,
              payload: JSON.stringify(secondUpdate),
              secret: TELEGRAM_SECRET,
            });
            expect(secondResponse.status).toBe(200);

            if (shouldSerialize) {
              await sleep(25);
              expect(seenUpdateIds).toEqual([100]);
            } else {
              await waitForWebhookState(() => expect(seenUpdateIds).toEqual([100, 101]));
            }
          } finally {
            releaseFirstUpdate?.();
          }

          await waitForWebhookState(() => expect(seenUpdateIds).toEqual([100, 101]));
        },
      );
    },
  );

  it("handles near-limit payload with random chunk writes and event-loop yields", async () => {
    await runNearLimitPayloadTestAndExpectUpdate("random-chunked");
  });

  it("handles near-limit payload written in a single request write", async () => {
    await runNearLimitPayloadTestAndExpectUpdate("single");
  });

  it("rejects payloads larger than 1MB before invoking webhook handler", async () => {
    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
      },
      async ({ port }) => {
        const responseOrError = await postWebhookWithDeclaredLength({
          port,
          path: TELEGRAM_WEBHOOK_PATH,
          secret: TELEGRAM_SECRET,
          declaredLength: 1_024 * 1_024 + 2_048,
          body: "{}",
        });

        expect(responseOrError).toEqual({
          kind: "response",
          statusCode: 413,
          body: "Payload too large",
        });
        expect(handleUpdateSpy).not.toHaveBeenCalled();
      },
    );
  });

  it("does not de-register webhook when shutting down", async () => {
    deleteWebhookSpy.mockClear();
    const abort = new AbortController();
    const started = await startTelegramWebhook({
      token: TELEGRAM_TOKEN,
      secret: TELEGRAM_SECRET,
      abortSignal: abort.signal,
      path: TELEGRAM_WEBHOOK_PATH,
      ...requireWebhookQueueScope(),
    });

    await started.stop();
    abort.abort();
    expect(deleteWebhookSpy).toHaveBeenCalledTimes(0);
  });
});
