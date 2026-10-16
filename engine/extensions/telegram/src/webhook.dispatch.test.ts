import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import type { Api } from "grammy";
import {
  closeBranchStateDatabaseForTest,
  createChannelIngressQueueForTests as createChannelIngressQueue,
} from "branch/plugin-sdk/channel-ingress-test-runtime";
import { DEFAULT_INGRESS_ADOPTION_STALL_MS } from "branch/plugin-sdk/channel-outbound";
import { createPluginRuntimeMock } from "branch/plugin-sdk/channel-test-helpers";

import { createDeferred } from "branch/plugin-sdk/extension-shared";

import { closeBranchStateDatabaseAsync } from "branch/plugin-sdk/sqlite-runtime-testing";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createTelegramSpooledReplayDeferredParticipant,
  getTelegramSpooledReplayLifecycle,
  recordTelegramMessageProcessingResult,
} from "./bot-processing-outcome.js";
import { commitTelegramMessageDispatchReplay } from "./message-dispatch-dedupe.js";
import { monitorTelegramProvider } from "./monitor.js";
import { installTelegramIngressQueueRuntime } from "./runtime-state.test-support.js";
import { setTelegramRuntime } from "./runtime.js";
import { clearTelegramRuntimeForTest as clearTelegramRuntime } from "./runtime.test-support.js";
import type { TelegramRuntime } from "./runtime.types.js";
import { openTelegramIngressQueue } from "./telegram-ingress-spool.js";
import {
  writeTelegramSpooledUpdate,
  listTelegramSpooledUpdateClaims,
  listTelegramSpooledUpdates,
} from "./telegram-ingress-spool.test-support.js";
import {
  createTelegramPrivateTopicCallback,
  expectMockMessageContains,
  requireMockCall,
  telegramMessageUpdate,
  waitForWebhookState,
} from "./test-support/webhook-fixtures.js";
import {
  createTelegramWebhookTestGateway,
  getServerPort,
  webhookUrl,
} from "./test-support/webhook-gateway.js";
import { postWebhookJson, yieldWebhookTask } from "./test-support/webhook-http.js";

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

function startWebhookStartupFixture(
  options: Partial<Parameters<typeof startTelegramWebhook>[0]> = {},
) {
  return startTelegramWebhook({
    token: TELEGRAM_TOKEN,
    secret: TELEGRAM_SECRET,
    runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
    ...options,
  });
}

describe("startTelegramWebhook", () => {
  it("answers a durably admitted callback before its same-chat lane drains", async () => {
    const blockingUpdate = {
      update_id: 5,
      message: {
        message_id: 5,
        date: 1_736_380_800,
        from: { id: 111, is_bot: false, first_name: "Ada" },
        chat: { id: 1234, type: "private" },
        text: "slow",
      },
    };
    const callbackUpdate = {
      update_id: 6,
      callback_query: createTelegramPrivateTopicCallback(6, webhookBotInfo.id),
    };
    const seenUpdateIds: number[] = [];
    let releaseBlockingUpdate: (() => void) | undefined;
    const blockingUpdateCompleted = new Promise<void>((resolve) => {
      releaseBlockingUpdate = resolve;
    });
    handleUpdateSpy.mockImplementation(async (update: unknown) => {
      const updateId = (update as { update_id: number }).update_id;
      seenUpdateIds.push(updateId);
      if (updateId === blockingUpdate.update_id) {
        await blockingUpdateCompleted;
      }
    });

    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
      },
      async ({ port }) => {
        const url = webhookUrl(port, TELEGRAM_WEBHOOK_PATH);
        try {
          const blockingResponse = await postWebhookJson({
            url,
            payload: JSON.stringify(blockingUpdate),
            secret: TELEGRAM_SECRET,
          });
          expect(blockingResponse.status).toBe(200);
          await waitForWebhookState(() => expect(seenUpdateIds).toEqual([5]));

          const callbackResponse = await postWebhookJson({
            url,
            payload: JSON.stringify(callbackUpdate),
            secret: TELEGRAM_SECRET,
          });
          expect(callbackResponse.status).toBe(200);
          expect(callbackResponse.headers.get("x-branch-delivery-accepted")).toBe("durable");
          expect(answerCallbackQuerySpy).toHaveBeenCalledWith("callback-6");
          expect(seenUpdateIds).toEqual([5]);
        } finally {
          releaseBlockingUpdate?.();
        }

        await waitForWebhookState(() => expect(seenUpdateIds).toEqual([5, 6]));
      },
    );
  });

  it("bounds shutdown when a webhook handler ignores abort", async () => {
    let releaseWork: (() => void) | undefined;
    handleUpdateSpy.mockImplementationOnce(
      async () =>
        await new Promise<void>((resolve) => {
          releaseWork = resolve;
        }),
    );
    const started = await startWebhookStartupFixture({
      path: TELEGRAM_WEBHOOK_PATH,
      ...requireWebhookQueueScope(),
    });

    try {
      const response = await postWebhookJson({
        url: webhookUrl(getServerPort(started.server), TELEGRAM_WEBHOOK_PATH),
        payload: JSON.stringify(telegramMessageUpdate(3, "stuck")),
        secret: TELEGRAM_SECRET,
      });
      expect(response.status).toBe(200);
      await waitForWebhookState(() => expect(handleUpdateSpy).toHaveBeenCalledOnce());

      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const stopTask = started.stop();
      await vi.advanceTimersByTimeAsync(15_000);
      await stopTask;

      expect(gateway.registry.httpRoutes).toHaveLength(0);
      expect(stopSpy).toHaveBeenCalledOnce();
      expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
    } finally {
      releaseWork?.();
      vi.useRealTimers();
      await started.stop();
    }
  });

  it("continues webhook shutdown after bot stop fails", async () => {
    const runtimeError = vi.fn();
    const setStatus = vi.fn();
    stopSpy.mockRejectedValueOnce(new Error("bot stop failed"));

    const started = await startWebhookStartupFixture({
      path: TELEGRAM_WEBHOOK_PATH,
      ...requireWebhookQueueScope(),
      setStatus,
      runtime: { log: vi.fn(), error: runtimeError, exit: vi.fn() },
    });

    await expect(started.stop()).resolves.toBeUndefined();

    expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
    expect(setStatus).toHaveBeenLastCalledWith({ mode: "webhook", connected: false });
    expectMockMessageContains(runtimeError, "telegram webhook bot stop failed");
  });

  it("joins concurrent stops with abort-driven webhook cleanup", async () => {
    const stopEntered = createDeferred<void>();
    const finishStop = createDeferred<void>();
    stopSpy.mockImplementationOnce(() => {
      stopEntered.resolve();
      return finishStop.promise;
    });
    const abort = new AbortController();
    const started = await startWebhookStartupFixture({
      path: TELEGRAM_WEBHOOK_PATH,
      ...requireWebhookQueueScope(),
      abortSignal: abort.signal,
    });
    abort.abort();
    let stopped = false;
    const stopping = Promise.all([started.stop(), started.stop()]).then(() => {
      stopped = true;
    });
    try {
      await stopEntered.promise;
      expect(stopSpy).toHaveBeenCalledOnce();
      await yieldWebhookTask();
      expect(stopped).toBe(false);
      expect(transportCloseSpies[0]).not.toHaveBeenCalled();
    } finally {
      finishStop.resolve();
      await stopping;
      expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
    }
  });

  it("does not dispatch queued work when the webhook provider starts aborted", async () => {
    vi.stubEnv("BRANCH_STATE_DIR", webhookStateDir);
    await writeTelegramSpooledUpdate({
      ...requireWebhookQueueScope(),
      update: telegramMessageUpdate(62, "not accepted"),
    });
    await monitorTelegramProvider({
      token: TELEGRAM_TOKEN,
      accountId: "test",
      config: {},
      useWebhook: true,
      webhookUrl: webhookUrl(getServerPort(gatewayServer), TELEGRAM_WEBHOOK_PATH),
      webhookPath: TELEGRAM_WEBHOOK_PATH,
      webhookSecret: TELEGRAM_SECRET,
      abortSignal: AbortSignal.abort(new Error("account stopped")),
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
    });

    expect(handleUpdateSpy).not.toHaveBeenCalled();
    expect(setWebhookSpy).not.toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalledOnce();
    expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
    expect(
      (await listTelegramSpooledUpdates(requireWebhookQueueScope())).map((entry) => entry.updateId),
    ).toEqual([62]);
  });

  it.each(["commit", "rollback", "introduction"] as const)(
    "joins accepted %s beyond webhook provider shutdown grace",
    async (operation) => {
      vi.stubEnv("BRANCH_STATE_DIR", webhookStateDir);
      const abort = new AbortController();
      const operationStarted = createDeferred<void>();
      const releaseOperation = createDeferred<void>();
      const recorded = new Set<string>();
      const setStatus = vi.fn();
      let settlement: Promise<void> | undefined;
      handleUpdateSpy.mockImplementationOnce(async () => {
        const participant = createTelegramSpooledReplayDeferredParticipant("held-webhook-work");
        const hold = participant?.beginSettlementHold();
        if (!participant || !hold) {
          throw new Error("Expected accepted webhook settlement ownership");
        }
        settlement = (async () => {
          try {
            if (operation === "introduction") {
              operationStarted.resolve();
              await releaseOperation.promise;
              recorded.add("introduction");
            } else {
              await commitTelegramMessageDispatchReplay({
                requirePersistent: true,
                guard: {
                  claim: async () => ({ kind: "invalid" }),
                  warmup: async () => 0,
                  forget: async (event) => {
                    operationStarted.resolve();
                    await releaseOperation.promise;
                    for (const key of "keys" in event ? (event.keys ?? []) : []) {
                      recorded.delete(key);
                    }
                    return true;
                  },
                },
                claims: ["first", "second"].map((key) => ({
                  keys: [key],
                  commit: async (options) => {
                    if (operation === "commit" && key === "first") {
                      operationStarted.resolve();
                      await releaseOperation.promise;
                    }
                    recorded.add(key);
                    if (operation === "rollback" && key === "second") {
                      options?.onDiskError?.(new Error("synthetic commit failure"));
                    }
                    return true;
                  },
                  release: () => undefined,
                })),
              });
            }
            hold.release("discard-pending");
            participant.settle({ kind: "completed" });
          } catch (error) {
            hold.release("replay-pending");
            participant.settle({ kind: "failed-retryable", error });
          }
        })();
        await settlement;
      });
      let stopped = false;
      const provider = monitorTelegramProvider({
        token: TELEGRAM_TOKEN,
        accountId: "test",
        config: {},
        useWebhook: true,
        webhookUrl: webhookUrl(getServerPort(gatewayServer), TELEGRAM_WEBHOOK_PATH),
        webhookPath: TELEGRAM_WEBHOOK_PATH,
        webhookSecret: TELEGRAM_SECRET,
        abortSignal: abort.signal,
        setStatus,
        runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      }).then(() => {
        stopped = true;
      });
      try {
        await waitForWebhookState(() => expect(setWebhookSpy).toHaveBeenCalledOnce());
        const url = requireMockCall(setWebhookSpy, 0, "setWebhook")[0];
        if (typeof url !== "string") {
          throw new Error("Expected the isolated Gateway webhook URL");
        }
        const response = await postWebhookJson({
          url,
          payload: JSON.stringify(telegramMessageUpdate(61, "held webhook work")),
          secret: TELEGRAM_SECRET,
        });
        expect(response.status).toBe(200);
        await operationStarted.promise;
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        abort.abort();
        await vi.advanceTimersByTimeAsync(16_000);
        expect(stopped).toBe(false);
        expect(stopSpy).toHaveBeenCalledOnce();
        expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
      } finally {
        releaseOperation.resolve();
        await settlement;
        abort.abort();
        await provider;
        vi.useRealTimers();
        await waitForWebhookState(async () =>
          expect(await listTelegramSpooledUpdateClaims(requireWebhookQueueScope())).toEqual([]),
        );
      }
      expect([...recorded]).toEqual(
        operation === "rollback"
          ? []
          : operation === "introduction"
            ? ["introduction"]
            : ["first", "second"],
      );
      expect(
        (await listTelegramSpooledUpdates(requireWebhookQueueScope())).map(
          (entry) => entry.updateId,
        ),
      ).toEqual(operation === "rollback" ? [61] : []);
      expect(setStatus).toHaveBeenLastCalledWith({ mode: "webhook", connected: false });
    },
  );

  it("retains the registered HTTP invocation until durable admission and acknowledgment", async () => {
    let releaseEnqueue: (() => void) | undefined;
    let markEnqueueStarted: (() => void) | undefined;
    const enqueueGate = new Promise<void>((resolve) => {
      releaseEnqueue = resolve;
    });
    const enqueueStarted = new Promise<void>((resolve) => {
      markEnqueueStarted = resolve;
    });
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
            enqueue: async (...args: Parameters<typeof queue.enqueue>) => {
              markEnqueueStarted?.();
              await enqueueGate;
              return await queue.enqueue(...args);
            },
          };
        },
      },
    } as TelegramRuntime);

    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
      },
      async ({ port }) => {
        let responseSettled = false;
        const responseTask = postWebhookJson({
          url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
          payload: JSON.stringify(telegramMessageUpdate(4, "commit gate")),
          secret: TELEGRAM_SECRET,
        }).then((response) => {
          responseSettled = true;
          return response;
        });

        try {
          await enqueueStarted;
          await yieldWebhookTask();
          expect(responseSettled).toBe(false);
          expect(pendingRouteRequests.size).toBe(1);

          releaseEnqueue?.();
          const response = await responseTask;
          expect(response.status).toBe(200);
          expect(response.headers.get("x-branch-delivery-accepted")).toBe("durable");
          expect(await response.text()).toBe("");
          expect(pendingRouteRequests.size).toBe(0);
        } finally {
          releaseEnqueue?.();
        }
      },
    );
  });

  it("durably retries a webhook update after acknowledging Telegram", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const runtimeLog = vi.fn();
    const seenUpdates: unknown[] = [];
    handleUpdateSpy.mockImplementation(async (update: unknown) => {
      seenUpdates.push(update);
      if (seenUpdates.length === 1) {
        recordTelegramMessageProcessingResult({
          kind: "failed-retryable",
          error: new Error("agent turn failed"),
        });
      }
    });
    const payload = JSON.stringify(telegramMessageUpdate(3, "boom"));

    try {
      await withStartedWebhook(
        {
          secret: TELEGRAM_SECRET,
          path: TELEGRAM_WEBHOOK_PATH,
          runtime: { log: runtimeLog, error: vi.fn(), exit: vi.fn() },
        },
        async ({ port }) => {
          const response = await postWebhookJson({
            url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
            payload,
            secret: TELEGRAM_SECRET,
          });

          expect(response.status).toBe(200);
          expect(response.headers.get("x-branch-delivery-accepted")).toBe("durable");
          expect(await response.text()).toBe("");
          await waitForWebhookState(() => expect(seenUpdates).toEqual([JSON.parse(payload)]));
          await waitForWebhookState(async () =>
            expect(await listTelegramSpooledUpdates(requireWebhookQueueScope())).toMatchObject([
              { updateId: 3, attempts: 1, lastError: "agent turn failed" },
            ]),
          );
          expectMockMessageContains(
            runtimeLog,
            "webhook spooled update 3 failed; keeping for retry",
          );
          vi.setSystemTime(Date.now() + 1_100);
          await vi.advanceTimersByTimeAsync(500);
          await waitForWebhookState(() =>
            expect(seenUpdates).toEqual([JSON.parse(payload), JSON.parse(payload)]),
          );
          await waitForWebhookState(async () =>
            expect(await listTelegramSpooledUpdates(requireWebhookQueueScope())).toEqual([]),
          );
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      label: "environment override",
      envValue: "50",
      timeoutMs: 50,
    },
    {
      label: "canonical default",
      envValue: undefined,
      timeoutMs: DEFAULT_INGRESS_ADOPTION_STALL_MS,
    },
  ])("uses the $label for webhook adoption stalls", async ({ envValue, timeoutMs }) => {
    vi.stubEnv("BRANCH_TELEGRAM_SPOOLED_HANDLER_TIMEOUT_MS", envValue);
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let finishUpdate: (() => void) | undefined;
    const active: {
      dispatchStartedAt?: number;
      lifecycle?: NonNullable<ReturnType<typeof getTelegramSpooledReplayLifecycle>>;
    } = {};
    await writeTelegramSpooledUpdate({
      ...requireWebhookQueueScope(),
      update: telegramMessageUpdate(39, "stalled"),
    });
    handleUpdateSpy.mockImplementationOnce(async () => {
      active.dispatchStartedAt = Date.now();
      active.lifecycle = getTelegramSpooledReplayLifecycle();
      await new Promise<void>((resolve) => {
        finishUpdate = resolve;
      });
    });

    const started = await startTelegramWebhook({
      token: TELEGRAM_TOKEN,
      secret: TELEGRAM_SECRET,
      path: TELEGRAM_WEBHOOK_PATH,
      ...requireWebhookQueueScope(),
      runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
    });
    try {
      await waitForWebhookState(() => expect(active.lifecycle).toBeDefined());
      const { dispatchStartedAt, lifecycle } = active;
      if (!lifecycle || dispatchStartedAt === undefined) {
        throw new Error("expected active webhook ingress lifecycle");
      }
      expect(lifecycle.abortSignal.aborted).toBe(false);
      const remainingMs = timeoutMs - (Date.now() - dispatchStartedAt);
      expect(remainingMs).toBeGreaterThan(0);
      await vi.advanceTimersByTimeAsync(remainingMs - 1);
      expect(lifecycle.abortSignal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(lifecycle.abortSignal.aborted).toBe(true);
    } finally {
      finishUpdate?.();
      await started.stop();
    }
  });

  it("retries a timed-out webhook update before later same-lane updates", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    try {
      let finishFirstUpdate: (() => void) | undefined;
      let finishRetry: (() => void) | undefined;
      const seenUpdateIds: number[] = [];
      const firstUpdate = telegramMessageUpdate(40, "slow");
      const secondUpdate = telegramMessageUpdate(41, "blocked");
      await writeTelegramSpooledUpdate({
        ...requireWebhookQueueScope(),
        update: firstUpdate,
      });
      await writeTelegramSpooledUpdate({
        ...requireWebhookQueueScope(),
        update: secondUpdate,
      });
      handleUpdateSpy.mockImplementation(async (update: unknown) => {
        const updateId = (update as { update_id: number }).update_id;
        seenUpdateIds.push(updateId);
        if (updateId === 40) {
          await new Promise<void>((resolve) => {
            if (seenUpdateIds.filter((id) => id === 40).length === 1) {
              finishFirstUpdate = resolve;
            } else {
              finishRetry = resolve;
            }
          });
        }
      });

      const started = await startTelegramWebhook({
        token: TELEGRAM_TOKEN,
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
        ...requireWebhookQueueScope(),
        runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
      });
      try {
        await waitForWebhookState(() => expect(seenUpdateIds).toEqual([40]));
        await vi.advanceTimersByTimeAsync(DEFAULT_INGRESS_ADOPTION_STALL_MS + 10_000);
        await yieldWebhookTask();
        expect(seenUpdateIds).toEqual([40]);

        finishFirstUpdate?.();
        await waitForWebhookState(() => expect(seenUpdateIds).toEqual([40, 40]));
        finishRetry?.();
        await waitForWebhookState(() => expect(seenUpdateIds).toEqual([40, 40, 41]));
      } finally {
        finishFirstUpdate?.();
        finishRetry?.();
        await started.stop();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
