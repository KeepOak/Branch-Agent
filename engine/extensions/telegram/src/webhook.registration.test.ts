import fs from "node:fs/promises";
import os from "node:os";
import nodePath from "node:path";

import type { Api } from "grammy";
import { closeBranchStateDatabaseForTest } from "branch/plugin-sdk/channel-ingress-test-runtime";

import {
  onDiagnosticEvent,
  waitForDiagnosticEventsDrained,
} from "branch/plugin-sdk/diagnostic-runtime";

import {
  logWebhookReceived,
  startDiagnosticHeartbeat,
  stopDiagnosticHeartbeat,
} from "branch/plugin-sdk/logging-core";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "branch/plugin-sdk/runtime-config-snapshot";
import { closeBranchStateDatabaseAsync } from "branch/plugin-sdk/sqlite-runtime-testing";
import { importFreshModule } from "branch/plugin-sdk/test-fixtures";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { installTelegramIngressQueueRuntime } from "./runtime-state.test-support.js";

import { clearTelegramRuntimeForTest as clearTelegramRuntime } from "./runtime.test-support.js";

import { openTelegramIngressQueue } from "./telegram-ingress-spool.js";

import {
  expectMockMessageContains,
  expectStatusCall,
  expectWebhookBotScopesAborted,
  requireMockCall,
  requireRecord,
  telegramMessageUpdate,
  waitForWebhookState,
} from "./test-support/webhook-fixtures.js";
import {
  createTelegramWebhookTestGateway,
  getServerPort,
  webhookUrl,
} from "./test-support/webhook-gateway.js";
import { postWebhookJson } from "./test-support/webhook-http.js";
import { registerTelegramWebhookRegistrationTests } from "./test-support/webhook-registration.js";

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
  it.each([
    { binding: "standalone", enabled: false },
    { binding: "standalone", enabled: true },
    { binding: "unrelated", enabled: false },
    { binding: "late", enabled: false },
    { binding: "runtime", enabled: false },
    { binding: "source", enabled: false },
  ] as const)(
    "respects $binding diagnostics (enabled=$enabled) and preserves the host heartbeat",
    async ({ binding, enabled }) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
      const events: string[] = [];
      const unsubscribe = onDiagnosticEvent((event) => events.push(event.type));
      startDiagnosticHeartbeat({}, { sampleLiveness: () => null });
      const config = { diagnostics: { enabled } };
      const followsRuntime = binding === "runtime" || binding === "source";
      if (followsRuntime) {
        setRuntimeConfigSnapshot(binding === "runtime" ? config : { ...config }, config);
      } else if (binding === "unrelated") {
        setRuntimeConfigSnapshot(
          { diagnostics: { enabled: true } },
          { logging: { level: "debug" } },
        );
      }
      try {
        await withStartedWebhook(
          {
            secret: TELEGRAM_SECRET,
            path: TELEGRAM_WEBHOOK_PATH,
            config: binding === "source" ? structuredClone(config) : config,
          },
          async ({ port, server }) => {
            if (binding === "late") {
              setRuntimeConfigSnapshot({ diagnostics: { enabled: true } });
            }
            let expectedEvents = 0;
            for (const currentEnabled of followsRuntime ? [false, true, false] : [enabled]) {
              if (followsRuntime) {
                setRuntimeConfigSnapshot({ diagnostics: { enabled: currentEnabled } });
              }
              const response = await postWebhookJson({
                url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
                payload: "{}",
              });
              expect(response.status).toBe(401);
              await waitForDiagnosticEventsDrained();
              expectedEvents += currentEnabled ? 1 : 0;
              expect(events.filter((event) => event === "webhook.received")).toHaveLength(
                expectedEvents,
              );
            }
            expect(server.listening).toBe(true);
            expect(initSpy).toHaveBeenCalledOnce();
          },
        );
        logWebhookReceived({ channel: "host" });
        await vi.advanceTimersByTimeAsync(30_000);
        await waitForDiagnosticEventsDrained();
        expect(events.filter((event) => event === "diagnostic.heartbeat")).toHaveLength(1);
      } finally {
        clearRuntimeConfigSnapshot();
        stopDiagnosticHeartbeat();
        unsubscribe();
      }
    },
  );
  it("registers the Gateway route and advertises the configured webhook", async () => {
    initSpy.mockClear();
    createTelegramBotSpy.mockClear();
    const runtimeLog = vi.fn();
    const setStatus = vi.fn();
    const cfg = { bindings: [] };
    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        accountId: "opie",
        ownerAgentId: "ops",
        config: cfg,
        runtime: { log: runtimeLog, error: vi.fn(), exit: vi.fn() },
        setStatus,
      },
      async ({ port }) => {
        const botParams = requireRecord(
          requireMockCall(createTelegramBotSpy, 0, "createTelegramBot")[0],
          "createTelegramBot params",
        );
        expect(botParams.accountId).toBe("opie");
        expect(botParams.ownerAgentId).toBe("ops");
        expect(requireRecord(botParams.config, "telegram config").bindings).toEqual([]);
        expect(botParams.telegramTransport).toBeDefined();
        const notFound = await fetch(`http://127.0.0.1:${port}/not-the-webhook`);
        expect(notFound.status).toBe(404);
        expect(notFound.headers.get("x-branch-delivery-accepted")).toBeNull();
        expect(initSpy).toHaveBeenCalledTimes(1);
        expect(setWebhookSpy).toHaveBeenCalled();
        const registration = requireRecord(
          requireMockCall(setWebhookSpy, 0, "setWebhook")[1],
          "webhook registration",
        );
        expect(registration.allowed_updates).toEqual(
          expect.arrayContaining(["message_reaction", "channel_post"]),
        );
        expect(registration.allowed_updates).not.toContain("stopped_message_generation");
        expectMockMessageContains(runtimeLog, "telegram webhook Gateway route");
        expectMockMessageContains(runtimeLog, "/telegram-webhook");
        expectMockMessageContains(runtimeLog, "webhook advertised to telegram on http://");
        expect(setStatus).toHaveBeenNthCalledWith(1, {
          mode: "webhook",
          connected: false,
          lastConnectedAt: null,
          lastEventAt: null,
          lastTransportActivityAt: null,
        });
        const connectedStatus = requireRecord(
          requireMockCall(setStatus, 1, "setStatus")[0],
          "connected status",
        );
        expect(connectedStatus.mode).toBe("webhook");
        expect(connectedStatus.connected).toBe(true);
        expect(connectedStatus.running).toBe(true);
        expect(connectedStatus).toHaveProperty("terminalDisconnect", undefined);
        expect(typeof connectedStatus.lastConnectedAt).toBe("number");
        expect(typeof connectedStatus.lastEventAt).toBe("number");
        expect(connectedStatus.lifecycle).toBe("ready");
        expect(connectedStatus.lastError).toBeNull();
      },
    );
  });

  it.each([
    { name: "omitted host", configured: { port: 8787 }, host: "127.0.0.1" },
    { name: "explicit wildcard", configured: { port: 8787, host: "0.0.0.0" }, host: "0.0.0.0" },
    { name: "explicit address", configured: { port: 8787, host: "127.0.0.2" }, host: "127.0.0.2" },
  ])(
    "prepares the legacy listener for $name and accepts its signed callback",
    async ({ configured, host }) => {
      await withStartedWebhook(
        {
          secret: TELEGRAM_SECRET,
          path: TELEGRAM_WEBHOOK_PATH,
          legacyWebhook: configured,
        },
        async ({ port }) => {
          const endpoint = { port: 8787, host };
          expect(gateway.registry.httpRoutes[0]?.legacyListeners).toEqual([
            { ...endpoint, health: { path: "/healthz" } },
          ]);
          legacyListenerForRequest.mockReturnValue(endpoint);
          const response = await postWebhookJson({
            url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
            payload: JSON.stringify(telegramMessageUpdate(809, "legacy bind address")),
            secret: TELEGRAM_SECRET,
          });
          expect(response.status).toBe(200);
        },
      );
    },
  );

  it("routes duplicate module copies by secret and rejects ambiguous accounts", async () => {
    const [firstModule, secondModule] = await Promise.all([
      importFreshModule<typeof import("./webhook.js")>(
        import.meta.url,
        "./webhook.js?scope=telegram-webhook-first",
      ),
      importFreshModule<typeof import("./webhook.js")>(
        import.meta.url,
        "./webhook.js?scope=telegram-webhook-second",
      ),
    ]);
    expect(firstModule.startTelegramWebhook).not.toBe(secondModule.startTelegramWebhook);
    const statusA = vi.fn();
    const statusB = vi.fn();
    const base = {
      token: TELEGRAM_TOKEN,
      path: TELEGRAM_WEBHOOK_PATH,
      ...requireWebhookQueueScope(),
      publicUrl: webhookUrl(getServerPort(gatewayServer), TELEGRAM_WEBHOOK_PATH),
    };
    const first = await firstModule.startTelegramWebhook({
      ...base,
      accountId: "first",
      secret: "first-secret",
      setStatus: statusA,
    });
    const second = await secondModule.startTelegramWebhook({
      ...base,
      accountId: "second",
      secret: "second-secret",
      legacyWebhook: { port: 8787, host: "127.0.0.1" },
      setStatus: statusB,
    });
    try {
      statusA.mockClear();
      statusB.mockClear();
      const url = webhookUrl(getServerPort(gatewayServer), TELEGRAM_WEBHOOK_PATH);
      const accepted = await postWebhookJson({
        url,
        payload: JSON.stringify(telegramMessageUpdate(801, "second account")),
        secret: "second-secret",
      });
      expect(accepted.status).toBe(200);
      expect(statusA).not.toHaveBeenCalled();
      expect(statusB).toHaveBeenCalled();
      const ambiguous = await secondModule.startTelegramWebhook({
        ...base,
        accountId: "ambiguous",
        secret: "second-secret",
        legacyWebhook: { port: 8788, host: "127.0.0.1" },
      });
      try {
        const rejected = await postWebhookJson({
          url,
          payload: JSON.stringify(telegramMessageUpdate(802, "ambiguous account")),
          secret: "second-secret",
        });
        expect(rejected.status).toBe(401);
        legacyListenerForRequest.mockReturnValue({ port: 8787, host: "127.0.0.1" });
        statusB.mockClear();
        const legacyAccepted = await postWebhookJson({
          url,
          payload: JSON.stringify(telegramMessageUpdate(804, "legacy account")),
          secret: "second-secret",
        });
        expect(legacyAccepted.status).toBe(200);
        expect(statusB).toHaveBeenCalled();
        legacyListenerForRequest.mockReturnValue({ port: 8789, host: "127.0.0.1" });
        const wrongEndpoint = await postWebhookJson({
          url,
          payload: JSON.stringify(telegramMessageUpdate(805, "wrong legacy endpoint")),
          secret: "second-secret",
        });
        expect(wrongEndpoint.status).toBe(404);
      } finally {
        legacyListenerForRequest.mockReturnValue(undefined);
        await ambiguous.stop();
      }
      await first.stop();
      expect(gateway.registry.httpRoutes).toHaveLength(1);
      const remaining = await postWebhookJson({
        url,
        payload: JSON.stringify(telegramMessageUpdate(803, "remaining account")),
        secret: "second-secret",
      });
      expect(remaining.status).toBe(200);
    } finally {
      await first.stop();
      await second.stop();
    }
    expect(gateway.registry.httpRoutes).toHaveLength(0);
  });

  it("aborts bot fetches and account-owned work when the webhook stops", async () => {
    const callerAbort = new AbortController();
    const started = await startTelegramWebhook({
      token: TELEGRAM_TOKEN,
      secret: TELEGRAM_SECRET,
      abortSignal: callerAbort.signal,
      path: TELEGRAM_WEBHOOK_PATH,
      ...requireWebhookQueueScope(),
    });

    try {
      const botParams = requireRecord(
        requireMockCall(createTelegramBotSpy, 0, "createTelegramBot")[0],
        "createTelegramBot params",
      );
      const fetchAbortSignal = botParams.fetchAbortSignal;
      const accountAbortSignal = botParams.accountAbortSignal;
      expect(fetchAbortSignal).toBeInstanceOf(AbortSignal);
      expect(accountAbortSignal).toBeInstanceOf(AbortSignal);
      if (
        !(fetchAbortSignal instanceof AbortSignal) ||
        !(accountAbortSignal instanceof AbortSignal)
      ) {
        throw new Error("expected bot fetch and account abort signals");
      }
      const fetchAborted = new Promise<void>((resolve) => {
        fetchAbortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
      const accountAborted = new Promise<void>((resolve) => {
        accountAbortSignal.addEventListener("abort", () => resolve(), { once: true });
      });

      await started.stop();

      await expect(Promise.all([fetchAborted, accountAborted])).resolves.toEqual([
        undefined,
        undefined,
      ]);
      expect(callerAbort.signal.aborted).toBe(false);
    } finally {
      await started.stop();
      callerAbort.abort();
    }
  });

  registerTelegramWebhookRegistrationTests({
    gateway,
    setWebhookSpy,
    stopSpy,
    transportCloseSpies,
    startWebhookStartupFixture,
    requireWebhookQueueScope,
    token: TELEGRAM_TOKEN,
    secret: TELEGRAM_SECRET,
    path: TELEGRAM_WEBHOOK_PATH,
  });

  it("retries transient getMe startup init failures before starting the account", async () => {
    const runtimeLog = vi.fn();
    const setStatus = vi.fn();
    initSpy.mockRejectedValueOnce(new TypeError("fetch failed")).mockResolvedValueOnce(undefined);

    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
        runtime: { log: runtimeLog, error: vi.fn(), exit: vi.fn() },
        setStatus,
        webhookRegistrationRetryPolicy: {
          initialMs: 0,
          maxMs: 0,
          factor: 1,
          jitter: 0,
        },
      },
      async ({ port }) => {
        const response = await postWebhookJson({
          url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
          payload: JSON.stringify(telegramMessageUpdate(806, "startup webhook")),
          secret: TELEGRAM_SECRET,
        });
        expect(response.status).toBe(200);
        expect(response.headers.get("x-branch-delivery-accepted")).toBe("durable");
      },
    );

    expect(initSpy).toHaveBeenCalledTimes(2);
    expect(runtimeLog).toHaveBeenCalledWith("telegram getMe retry 1 scheduled in 0ms");
    expectStatusCall(setStatus, { lifecycle: "recovering" });
    expect(setWebhookSpy).toHaveBeenCalledTimes(1);
  });

  it("closes its transport when bot creation fails before initialization", async () => {
    const creationError = new Error("bot setup failed");
    createTelegramBotSpy.mockImplementationOnce(() => {
      throw creationError;
    });

    await expect(startWebhookStartupFixture(requireWebhookQueueScope())).rejects.toBe(
      creationError,
    );

    expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
    expect(initSpy).not.toHaveBeenCalled();
    expect(setWebhookSpy).not.toHaveBeenCalled();
    expectWebhookBotScopesAborted(createTelegramBotSpy);
  });

  it("preserves the initialization failure when bot shutdown also fails", async () => {
    const runtimeError = vi.fn();
    const setStatus = vi.fn();
    const initializationError = Object.assign(new Error("unauthorized"), { error_code: 401 });
    initSpy.mockRejectedValueOnce(initializationError);
    stopSpy.mockRejectedValueOnce(new Error("bot stop failed"));

    await expect(
      startWebhookStartupFixture({
        path: TELEGRAM_WEBHOOK_PATH,
        ...requireWebhookQueueScope(),
        runtime: { log: vi.fn(), error: runtimeError, exit: vi.fn() },
        setStatus,
      }),
    ).rejects.toBe(initializationError);

    expect(setWebhookSpy).not.toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalledOnce();
    expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
    expect(deleteWebhookSpy).not.toHaveBeenCalled();
    expectWebhookBotScopesAborted(createTelegramBotSpy);
    expectMockMessageContains(runtimeError, "telegram webhook bot stop failed: bot stop failed");
    expectStatusCall(setStatus, { lifecycle: "blocked", lastError: "unauthorized" });
  });

  it("releases startup resources when another plugin owns its Gateway route", async () => {
    gateway.registry.httpRoutes.push({
      path: TELEGRAM_WEBHOOK_PATH,
      pluginId: "other",
      auth: "plugin",
      match: "exact",
      handler: () => true,
    });
    await expect(
      startTelegramWebhook({
        token: TELEGRAM_TOKEN,
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
        ...requireWebhookQueueScope(),
      }),
    ).rejects.toThrow(/route reuse denied/);
    expect(setWebhookSpy).not.toHaveBeenCalled();
    expect(stopSpy).toHaveBeenCalledOnce();
    expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
    expectWebhookBotScopesAborted(createTelegramBotSpy);
  });

  it("releases an advertised route when opening its durable ingress queue fails", async () => {
    const abort = new AbortController();
    const setStatus = vi.fn();
    const queueError = new Error("state database unavailable");
    installTelegramIngressQueueRuntime(() => webhookStateDir ?? os.tmpdir(), queueError);

    try {
      await expect(
        startWebhookStartupFixture({
          path: TELEGRAM_WEBHOOK_PATH,
          ...requireWebhookQueueScope(),
          abortSignal: abort.signal,
          setStatus,
        }),
      ).rejects.toBe(queueError);

      expect(setWebhookSpy).toHaveBeenCalledOnce();
      expect(stopSpy).toHaveBeenCalledOnce();
      expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
      expect(deleteWebhookSpy).not.toHaveBeenCalled();
      expectWebhookBotScopesAborted(createTelegramBotSpy);
      expectStatusCall(setStatus, { lastError: "state database unavailable" });
      expect(setStatus).toHaveBeenLastCalledWith({ mode: "webhook", connected: false });

      expect(gateway.registry.httpRoutes).toHaveLength(0);
    } finally {
      abort.abort();
      expect(transportCloseSpies[0]).toHaveBeenCalledOnce();
    }
  });

  it("registers webhook with certificate when webhookCertPath is provided", async () => {
    setWebhookSpy.mockClear();
    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
        webhookCertPath: "/path/to/cert.pem",
      },
      async () => {
        const setWebhookCall = requireMockCall(setWebhookSpy, 0, "setWebhook");
        expect(typeof setWebhookCall[0]).toBe("string");
        const options = requireRecord(setWebhookCall[1], "setWebhook options");
        const certificate = options.certificate as
          | { path?: string; fileData?: string; filename?: string }
          | undefined;
        if (!certificate) {
          throw new Error("expected Telegram webhook certificate payload");
        }
        if (certificate && "path" in certificate && typeof certificate.path === "string") {
          expect(certificate.path).toBe("/path/to/cert.pem");
        } else {
          expect(certificate.fileData).toBe("/path/to/cert.pem");
          expect(certificate.filename).toBe("cert.pem");
        }
      },
    );
  });

  it("acks before webhook update processing finishes", async () => {
    const slowUpdate = telegramMessageUpdate(2, "slow");
    const setStatus = vi.fn();
    let finishWork: (() => void) | undefined;
    let workStarted = false;
    let workFinished = false;
    handleUpdateSpy.mockImplementationOnce(async (update: unknown) => {
      expect(update).toEqual(telegramMessageUpdate(2, "slow"));
      workStarted = true;
      await new Promise<void>((resolve) => {
        finishWork = resolve;
      });
      workFinished = true;
    });

    await withStartedWebhook(
      {
        secret: TELEGRAM_SECRET,
        path: TELEGRAM_WEBHOOK_PATH,
        setStatus,
      },
      async ({ port }) => {
        setStatus.mockClear();
        const receivedAfter = Date.now();
        const response = await postWebhookJson({
          url: webhookUrl(port, TELEGRAM_WEBHOOK_PATH),
          payload: JSON.stringify(slowUpdate),
          secret: TELEGRAM_SECRET,
          timeoutMs: 1_000,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get("x-branch-delivery-accepted")).toBe("durable");
        expect(await response.text()).toBe("");
        await waitForWebhookState(() => expect(workStarted).toBe(true));
        expect(workFinished).toBe(false);
        const receivedStatus = requireRecord(
          requireMockCall(setStatus, 0, "setStatus")[0],
          "webhook activity status",
        );
        expect(receivedStatus).toEqual({ lastEventAt: expect.any(Number) });
        expect(receivedStatus.lastEventAt).toBeGreaterThanOrEqual(receivedAfter);

        finishWork?.();
        await waitForWebhookState(() => expect(workFinished).toBe(true));
      },
    );
  });
});
