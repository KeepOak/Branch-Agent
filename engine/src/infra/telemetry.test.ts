import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfigIO } from "../config/io.js";
import type { BranchConfig } from "../config/types.branch.js";
import { createEmptyPluginRegistry } from "../plugins/registry-empty.js";
import * as pluginRuntime from "../plugins/runtime.js";
import { createPluginRecord } from "../plugins/status.test-helpers.js";
import { writeConfigMachineState } from "../state/config-machine-state-write.js";
import { readConfigMachineState } from "../state/config-machine-state.js";
import { closeBranchStateDatabaseAsync } from "../state/branch-state-db.js";
import * as workerStore from "../state/branch-state-worker-store.js";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { useMockHttp } from "../test-utils/mock-http.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../test-utils/branch-test-state.js";
import {
  buildTelemetryPayload,
  checkTelemetryUpdate,
  resolveTelemetryStatus,
} from "./telemetry.js";
import { blockTelemetryPersistence } from "./telemetry.test-support.js";

const NOW = Date.parse("2026-08-23T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
// Update checks reach the telemetry endpoint only for a user who opted in.
const OPTED_IN_CONFIG = { telemetry: { enabled: true } } as const;
const TELEMETRY_URL = "https://telemetry.openclaw.ai/api/latest-version";
const TELEMETRY_STATE_KEY = "telemetry.updateCheck";
const mockHttp = useMockHttp();

function installPluginRegistry(...plugins: Parameters<typeof createPluginRecord>[0][]): void {
  const registry = createEmptyPluginRegistry();
  registry.plugins.push(...plugins.map((plugin) => createPluginRecord(plugin)));
  pluginRuntime.setActivePluginRegistry(registry);
}

function createFeatureConfig(enabled = true): BranchConfig {
  return {
    telemetry: { enabled },
    auth: {
      profiles: {
        "anthropic:private-account": {
          provider: "anthropic",
          mode: "api_key",
          email: "private@example.invalid",
        },
      },
    },
    channels: {
      telegram: { enabled: true, botToken: "private-telegram-token" },
      discord: { enabled: true, token: "private-discord-token" },
      "acme-internal-crm": { enabled: true },
      slack: { enabled: false, botToken: "private-slack-token" },
      defaults: { groupPolicy: "allowlist" },
      modelByChannel: { telegram: { "private-account-id": "openai/private-model" } },
    },
    models: {
      providers: {
        openai: {
          baseUrl: "https://private-provider.example.invalid/v1",
          apiKey: "private-provider-api-key",
          models: [],
        },
        anthropic: {
          baseUrl: "https://private-anthropic.example.invalid/v1",
          apiKey: "private-anthropic-api-key",
          models: [],
        },
        "acme-llm": {
          baseUrl: "https://private-llm.example.invalid/v1",
          models: [],
        },
      },
    },
    plugins: {
      entries: {
        telegram: { enabled: true },
        discord: { enabled: true },
        memory: { enabled: true },
        "acme-internal-crm": { enabled: true },
        "acme-internal-workflows": { enabled: true },
        disabled: { enabled: false },
      },
    },
    gateway: { auth: { mode: "token", token: "private-gateway-token" } },
  };
}

describe("anonymous telemetry", () => {
  let testState: BranchTestState;

  beforeEach(async () => {
    testState = await createBranchTestState({
      layout: "state-only",
      prefix: "branch-telemetry-",
      env: {
        CI: undefined,
        DO_NOT_TRACK: undefined,
        BRANCH_NIX_MODE: undefined,
        BRANCH_NO_AUTO_UPDATE: undefined,
        BRANCH_TELEMETRY_ENDPOINT: undefined,
      },
    });
    installPluginRegistry(
      { id: "telegram", origin: "bundled", channelIds: ["telegram"] },
      { id: "discord", origin: "bundled", channelIds: ["discord"] },
      { id: "memory", origin: "bundled" },
      { id: "acme-internal-crm", channelIds: ["acme-internal-crm"] },
      { id: "acme-internal-workflows" },
      { id: "disabled", origin: "bundled", enabled: false, status: "disabled" },
      { id: "load-error", origin: "bundled", status: "error" },
      { id: "deferred", origin: "bundled", imported: false },
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await closeBranchStateDatabaseAsync();
    await testState.cleanup();
  });

  it("builds deterministic feature facts without credentials, identities, paths, or hostnames", async () => {
    const payload = await buildTelemetryPayload(createFeatureConfig(), { surface: "gateway" });
    const serialized = JSON.stringify(payload);

    expect(payload).toEqual({
      schema: 1,
      version: expect.any(String),
      platform: `${process.platform}-${process.arch}`,
      node: process.versions.node,
      surface: "gateway",
      features: {
        channels: ["discord", "telegram"],
        providerFamilies: ["anthropic", "openai"],
        plugins: ["discord", "memory", "telegram"],
        pluginsEnabled: 5,
        sessionsLast24h: expect.any(Number),
      },
    });
    expect(serialized).not.toMatch(
      /"(?:id|accountId|userId|machineId|installId|token|apiKey|secret|password|prompt|message|host|hostname|baseUrl|path|email|models)"\s*:/iu,
    );
    expect(serialized).not.toContain("private-");
    expect(serialized).not.toContain("acme-internal-crm");
    expect(serialized).not.toContain("acme-internal-workflows");
    expect(serialized).not.toContain("acme-llm");
    expect(serialized).not.toContain("example.invalid");
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain(testState.stateDir);
    expect(payload.features.sessionsLast24h).toBeGreaterThanOrEqual(0);
  });

  it("counts loaded default plugins instead of unloaded config entries and accepts official provider families", async () => {
    installPluginRegistry(
      { id: "whatsapp", origin: "bundled", channelIds: ["whatsapp"] },
      { id: "diagnostics-otel", origin: "bundled" },
    );
    const payload = await buildTelemetryPayload(
      {
        agents: {
          defaults: {
            model: {
              primary: "anthropic/private-model",
              fallbacks: ["openai/private-fallback", "cohere/private-official-model"],
            },
          },
          entries: {
            researcher: { model: "google/private-research-model" },
          },
        },
        channels: { whatsapp: { allowFrom: ["+15555550123"] } },
        plugins: { entries: { "never-loaded": { enabled: true } } },
      },
      { surface: "gateway" },
    );

    expect(payload.features).toMatchObject({
      channels: ["whatsapp"],
      providerFamilies: ["anthropic", "cohere", "google", "openai"],
      plugins: ["diagnostics-otel", "whatsapp"],
      pluginsEnabled: 2,
    });
    expect(JSON.stringify(payload)).not.toContain("private-");
    expect(JSON.stringify(payload)).not.toContain("+15555550123");
  });

  it("classifies configured channels by their loaded plugin owner", async () => {
    installPluginRegistry(
      { id: "public-channel-owner", origin: "bundled", channelIds: ["public-alias"] },
      { id: "acme-internal-crm", channelIds: ["telegram"] },
    );

    const payload = await buildTelemetryPayload(
      { channels: { "public-alias": { enabled: true }, telegram: { enabled: true } } },
      { surface: "gateway" },
    );

    expect(payload.features.channels).toEqual(["public-alias"]);
    expect(payload.features.plugins).toEqual(["public-channel-owner"]);
    expect(payload.features.pluginsEnabled).toBe(2);
    expect(JSON.stringify(payload)).not.toContain("acme-internal-crm");
  });

  it.each([
    { source: "provider map", provider: " OpenAI ", expected: ["openai"] },
    { source: "auth profile", provider: " OpenAI ", expected: ["openai"] },
    { source: "model reference", provider: " OpenAI ", expected: ["openai"] },
    { source: "provider map", provider: " Open AI ", expected: [] },
    { source: "provider map", provider: " Acme-Private ", expected: [] },
  ])(
    "reports loaded $source provider $provider as $expected",
    async ({ source, provider, expected }) => {
      const input: BranchConfig = { plugins: { enabled: false } };
      if (source === "provider map") {
        input.models = {
          providers: { [provider]: { baseUrl: "https://provider.example.invalid/v1", models: [] } },
        };
      } else if (source === "auth profile") {
        input.auth = { profiles: { configured: { provider, mode: "api_key" } } };
      } else {
        input.agents = { defaults: { model: `${provider}/gpt-4o` } };
      }
      await testState.writeConfig(input);
      const config = createConfigIO({
        configPath: testState.configPath,
        env: { BRANCH_STATE_DIR: testState.stateDir },
        homedir: () => testState.home,
        observe: false,
      }).loadConfig();

      // The real loader accepts these spellings without canonicalizing the provider identity.
      if (source === "provider map") {
        expect(Object.keys(config.models?.providers ?? {})).toEqual([provider]);
      } else if (source === "auth profile") {
        expect(config.auth?.profiles?.configured?.provider).toBe(provider);
      }
      expect(
        (await buildTelemetryPayload(config, { surface: "gateway" })).features.providerFamilies,
      ).toEqual(expected);
    },
  );

  it("deduplicates canonical provider families across config maps, auth, and model references", async () => {
    const config: BranchConfig = {
      models: {
        providers: {
          OpenAI: { baseUrl: "https://provider.example.invalid/v1", models: [] },
          " openai ": { baseUrl: "https://provider.example.invalid/v1", models: [] },
        },
      },
      auth: { profiles: { configured: { provider: " OPENAI ", mode: "api_key" } } },
      agents: { defaults: { model: "OpenAI/gpt-4o" } },
    };

    expect(
      (await buildTelemetryPayload(config, { surface: "gateway" })).features.providerFamilies,
    ).toEqual(["openai"]);
  });

  it("uses manifest-owned plugin activation when a CLI has no active runtime registry", async () => {
    const activeRegistry = vi.spyOn(pluginRuntime, "getActivePluginRegistry").mockReturnValue(null);
    try {
      const payload = await buildTelemetryPayload(
        {
          channels: { telegram: { enabled: true } },
          plugins: { allow: ["telegram"] },
        },
        { surface: "cli" },
      );

      expect(payload.features.channels).toEqual(["telegram"]);
      expect(payload.features.plugins).toContain("telegram");
      expect(payload.features.pluginsEnabled).toBe(payload.features.plugins.length);
    } finally {
      activeRegistry.mockRestore();
    }
  });

  it("counts only session creation events from the previous 24 hours", async () => {
    const { recordSessionStateEvent } = await import("../sessions/session-state-events.js");
    const now = Date.now();
    for (const event of [
      { sessionKey: "recent", kind: "created" as const, occurredAt: now - 1000 },
      { sessionKey: "older", kind: "created" as const, occurredAt: now - DAY_MS - 1000 },
      { sessionKey: "other", kind: "run_completed" as const, occurredAt: now - 1000 },
    ]) {
      recordSessionStateEvent(
        {
          ...event,
          agentId: "main",
          actorType: "system",
          summary: "test session event",
        },
        { now: event.occurredAt },
      );
    }

    expect((await buildTelemetryPayload({}, { surface: "gateway" })).features.sessionsLast24h).toBe(
      1,
    );
  });

  it("contacts the telemetry endpoint for the update check only after explicit opt-in", async () => {
    const requests: string[] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]) => {
      requests.push(String(input));
      return new Response(JSON.stringify({ version: "2026.8.24" }), { status: 200 });
    }) as typeof fetch;
    const options = { surface: "gateway" as const, fetchImpl };

    // A default config (never asked) and an explicit refusal both stay offline.
    expect(await checkTelemetryUpdate(() => ({}), { ...options, nowMs: NOW })).toBeNull();
    expect(
      await checkTelemetryUpdate(() => ({ telemetry: { enabled: false } }), {
        ...options,
        nowMs: NOW,
      }),
    ).toBeNull();
    expect(requests).toEqual([]);

    const opted = await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW });
    expect(opted).toEqual({ version: "2026.8.24" });
    expect(requests).toEqual([TELEMETRY_URL]);
  });

  it("sends at most one request per 24 hours and reuses the persisted update result", async () => {
    mockHttp.intercept({
      url: TELEMETRY_URL,
      method: "POST",
      reply: { json: { version: "2026.8.24", note: "A newer release is available." } },
    });
    mockHttp.intercept({
      url: TELEMETRY_URL,
      method: "POST",
      reply: { json: { version: "2026.8.25" } },
    });
    const options = { surface: "gateway" as const, fetchImpl: globalThis.fetch };

    const first = await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW });
    const cached = await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + DAY_MS - 1 });

    expect(first).toEqual({ version: "2026.8.24", note: "A newer release is available." });
    expect(cached).toEqual(first);
    expect(mockHttp.requests()).toHaveLength(1);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual({
      lastPingAt: NOW,
      latestVersion: "2026.8.24",
      note: "A newer release is available.",
    });

    const refreshed = await checkTelemetryUpdate(() => OPTED_IN_CONFIG, {
      ...options,
      nowMs: NOW + DAY_MS + 1,
    });

    expect(refreshed).toEqual({ version: "2026.8.25" });
    expect(mockHttp.requests()).toHaveLength(2);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual({
      lastPingAt: NOW + DAY_MS + 1,
      latestVersion: "2026.8.25",
    });
  });

  it("retains a successful response through write failures and recovers without extending its throttle", async () => {
    const unblock = blockTelemetryPersistence();
    const update = { version: "2026.8.24", note: "A newer release is available." };
    mockHttp.intercept({ url: TELEMETRY_URL, method: "POST", reply: { json: update } });
    mockHttp.intercept({
      url: TELEMETRY_URL,
      method: "POST",
      reply: { json: { version: "2026.8.25" } },
    });
    const options = { surface: "gateway" as const, fetchImpl: globalThis.fetch };

    const first = await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW });
    const retained = await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + 120_000 });

    expect({ first, retained, requests: mockHttp.requests().length }).toEqual({
      first: update,
      retained: update,
      requests: 1,
    });
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toBeUndefined();

    unblock();
    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + 240_000 }),
    ).resolves.toEqual(update);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual({
      lastPingAt: NOW,
      latestVersion: update.version,
      note: update.note,
    });
    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + DAY_MS - 1 }),
    ).resolves.toEqual(update);
    expect(mockHttp.requests()).toHaveLength(1);

    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + DAY_MS }),
    ).resolves.toEqual({
      version: "2026.8.25",
    });
    expect(mockHttp.requests()).toHaveLength(2);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual({
      lastPingAt: NOW + DAY_MS,
      latestVersion: "2026.8.25",
    });
  });

  it.each(["endpoint", "state directory", "implicit home"] as const)(
    "keeps an unpersisted response isolated when the %s changes",
    async (scope) => {
      blockTelemetryPersistence();
      const options = { surface: "gateway" as const, fetchImpl: globalThis.fetch };
      mockHttp.intercept({
        url: TELEMETRY_URL,
        method: "POST",
        reply: { json: { version: "2026.8.24" } },
      });
      await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW });

      let endpoint = TELEMETRY_URL;
      if (scope === "endpoint") {
        endpoint = "https://telemetry.example.invalid/api/latest-version";
        setTestEnvValue("BRANCH_TELEMETRY_ENDPOINT", endpoint);
      } else if (scope === "state directory") {
        setTestEnvValue("BRANCH_STATE_DIR", testState.path("alternate-state"));
      } else {
        deleteTestEnvValue("BRANCH_STATE_DIR");
        setTestEnvValue("BRANCH_HOME", testState.path("alternate-home"));
      }
      mockHttp.intercept({
        url: endpoint,
        method: "POST",
        reply: { json: { version: "2026.8.25" } },
      });

      await expect(
        checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + 120_000 }),
      ).resolves.toEqual({ version: "2026.8.25" });
      expect(mockHttp.requests()).toHaveLength(2);
      testState.applyEnv();

      await expect(
        checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + 240_000 }),
      ).resolves.toEqual({ version: "2026.8.24" });
      expect(mockHttp.requests()).toHaveLength(2);
    },
  );

  it("shares the retained success across equivalent resolved state paths", async () => {
    blockTelemetryPersistence();
    mockHttp.intercept({
      url: TELEMETRY_URL,
      method: "POST",
      reply: { json: { version: "2026.8.24" } },
    });
    const options = { surface: "gateway" as const, fetchImpl: globalThis.fetch };
    await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW });
    setTestEnvValue("BRANCH_STATE_DIR", `${testState.stateDir}/.`);

    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + 120_000 }),
    ).resolves.toEqual({
      version: "2026.8.24",
    });
    expect(mockHttp.requests()).toHaveLength(1);
  });

  it("keeps the request's state destination when the environment changes during HTTP", async () => {
    const unblock = blockTelemetryPersistence();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      setTestEnvValue("BRANCH_STATE_DIR", testState.path("alternate-state"));
      return Response.json({ version: "2026.8.24" });
    });
    const options = { surface: "gateway" as const, fetchImpl };

    await expect(checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW })).resolves.toEqual({
      version: "2026.8.24",
    });
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toBeUndefined();
    testState.applyEnv();
    unblock();

    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + 120_000 }),
    ).resolves.toEqual({
      version: "2026.8.24",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual({
      lastPingAt: NOW,
      latestVersion: "2026.8.24",
    });
  });

  it("does not replace a newer persisted success with a retained older response", async () => {
    const unblock = blockTelemetryPersistence();
    mockHttp.intercept({
      url: TELEMETRY_URL,
      method: "POST",
      reply: { json: { version: "2026.8.24" } },
    });
    const options = { surface: "gateway" as const, fetchImpl: globalThis.fetch };
    await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW });
    unblock();
    const newerState = { lastPingAt: NOW + 60_000, latestVersion: "2026.8.25" };
    writeConfigMachineState(TELEMETRY_STATE_KEY, newerState);

    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + 120_000 }),
    ).resolves.toEqual({
      version: "2026.8.25",
    });
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual(newerState);
    expect(mockHttp.requests()).toHaveLength(1);
  });

  it("preserves a newer durable success written while the request was awaiting HTTP", async () => {
    const newerState = { lastPingAt: NOW + 60_000, latestVersion: "2026.8.25" };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      writeConfigMachineState(TELEMETRY_STATE_KEY, newerState);
      return Response.json({ version: "2026.8.24" });
    });

    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { surface: "gateway", fetchImpl, nowMs: NOW }),
    ).resolves.toEqual({ version: newerState.latestVersion });

    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual(newerState);
  });

  it("uses a newer transaction-selected success instead of sending at the pending timestamp's expiry", async () => {
    const unblock = blockTelemetryPersistence();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ version: "2026.8.24" }))
      .mockResolvedValueOnce(Response.json({ version: "2026.8.26" }));
    const options = { surface: "gateway" as const, fetchImpl };
    await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW });
    unblock();

    const newerState = { lastPingAt: NOW + DAY_MS - 60_000, latestVersion: "2026.8.25" };
    const originalRead = workerStore.runBranchStateWorkerOperation;
    const read = vi
      .spyOn(workerStore, "runBranchStateWorkerOperation")
      .mockImplementationOnce(async (...args) => {
        const snapshot = await originalRead(...args);
        writeConfigMachineState(TELEMETRY_STATE_KEY, newerState);
        return snapshot;
      });
    try {
      const result = await checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + DAY_MS });
      expect({ result, requests: fetchImpl.mock.calls.length }).toEqual({
        result: { version: newerState.latestVersion },
        requests: 1,
      });
      expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual(newerState);
    } finally {
      read.mockRestore();
    }
  });

  it.each([
    { name: "never opted in", config: {} satisfies BranchConfig },
    { name: "explicitly opted out", config: createFeatureConfig(false) },
  ])("sends nothing when $name", async ({ config }) => {
    await expect(
      checkTelemetryUpdate(() => config, {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW,
      }),
    ).resolves.toBeNull();

    expect(mockHttp.requests()).toHaveLength(0);
  });

  it("POSTs exactly the canonical payload only after explicit feature-stats opt-in", async () => {
    const config = createFeatureConfig();
    const expectedBody = JSON.stringify(
      await buildTelemetryPayload(config, { surface: "gateway" }),
    );
    mockHttp.intercept({
      url: TELEMETRY_URL,
      method: "POST",
      requestBody: expectedBody,
      requestHeaders: { "content-type": /^application\/json(?:\s*;.*)?$/u },
      reply: { json: { version: "2026.8.24" } },
    });

    await expect(
      checkTelemetryUpdate(() => config, {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW,
      }),
    ).resolves.toEqual({ version: "2026.8.24" });

    expect(mockHttp.requests()).toHaveLength(1);
  });

  it.each(["1", "true"])(
    "DO_NOT_TRACK=%s sends nothing, even with feature stats opted in",
    async (value) => {
      setTestEnvValue("DO_NOT_TRACK", value);

      await expect(
        checkTelemetryUpdate(() => createFeatureConfig(), {
          surface: "gateway",
          fetchImpl: globalThis.fetch,
          nowMs: NOW,
        }),
      ).resolves.toBeNull();

      expect(mockHttp.requests()).toHaveLength(0);
    },
  );

  it("never sends a request when startup update checks are disabled", async () => {
    await expect(
      checkTelemetryUpdate(() => ({ ...createFeatureConfig(), update: { checkOnStart: false } }), {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW,
      }),
    ).resolves.toBeNull();

    expect(mockHttp.requests()).toHaveLength(0);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toBeUndefined();
  });

  it("never sends a request when BRANCH_NO_AUTO_UPDATE disables update checks", async () => {
    setTestEnvValue("BRANCH_NO_AUTO_UPDATE", "1");

    await expect(
      checkTelemetryUpdate(() => createFeatureConfig(), {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW,
      }),
    ).resolves.toBeNull();

    expect(mockHttp.requests()).toHaveLength(0);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toBeUndefined();
  });

  it("never sends a request from an automated environment", async () => {
    setTestEnvValue("CI", "true");

    await expect(
      checkTelemetryUpdate(() => createFeatureConfig(), {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW,
      }),
    ).resolves.toBeNull();

    expect(mockHttp.requests()).toHaveLength(0);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toBeUndefined();
    expect((await resolveTelemetryStatus(createFeatureConfig())).reason).toBe(
      "automated-environment",
    );
  });

  it("still reports from an automated environment when an endpoint is configured for it", async () => {
    const customEndpoint = "https://telemetry.example.invalid/api/latest-version";
    setTestEnvValue("CI", "true");
    setTestEnvValue("BRANCH_TELEMETRY_ENDPOINT", customEndpoint);
    mockHttp.intercept({
      url: customEndpoint,
      method: "POST",
      reply: { json: { version: "2026.8.24" } },
    });

    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW,
      }),
    ).resolves.toEqual({ version: "2026.8.24" });

    expect(mockHttp.requests()).toHaveLength(1);
  });

  it("never sends a request for Nix-managed installations", async () => {
    setTestEnvValue("BRANCH_NIX_MODE", "1");

    await expect(
      checkTelemetryUpdate(() => createFeatureConfig(), {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW,
      }),
    ).resolves.toBeNull();

    expect(mockHttp.requests()).toHaveLength(0);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toBeUndefined();
  });

  it("never accesses the network in a test environment without an injected fetch", async () => {
    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { surface: "gateway", nowMs: NOW }),
    ).resolves.toBeNull();

    expect(mockHttp.requests()).toHaveLength(0);
  });

  it("uses the configured telemetry endpoint instead of the public endpoint", async () => {
    const customEndpoint = "https://telemetry.example.invalid/api/latest-version";
    setTestEnvValue("BRANCH_TELEMETRY_ENDPOINT", customEndpoint);
    mockHttp.intercept({
      url: customEndpoint,
      method: "POST",
      reply: { json: { version: "2026.8.24" } },
    });

    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { surface: "cli", fetchImpl: globalThis.fetch, nowMs: NOW }),
    ).resolves.toEqual({ version: "2026.8.24" });

    expect(mockHttp.requests().map((request) => request.fullUrl)).toEqual([customEndpoint]);
  });

  it.each([
    { name: "HTTP errors", reply: { status: 503, json: { version: "2026.8.24" } } },
    { name: "a missing version", reply: { json: { note: "Missing required version" } } },
    { name: "a non-string version", reply: { json: { version: 20260824 } } },
    { name: "invalid JSON", reply: { body: "{invalid" } },
    { name: "network failures", reply: new Error("network unavailable") },
  ])("fails silently on $name without stamping a successful ping", async ({ reply }) => {
    mockHttp.intercept({ url: TELEMETRY_URL, method: "POST", reply });

    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW,
      }),
    ).resolves.toBeNull();

    expect(mockHttp.requests()).toHaveLength(1);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toBeUndefined();
    mockHttp.intercept({
      url: TELEMETRY_URL,
      method: "POST",
      reply: { json: { version: "2026.8.24" } },
    });
    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, {
        surface: "gateway",
        fetchImpl: globalThis.fetch,
        nowMs: NOW + 120_000,
      }),
    ).resolves.toEqual({ version: "2026.8.24" });
    expect(mockHttp.requests()).toHaveLength(2);
  });

  it("bounds untrusted remote update notes before display or persistence", async () => {
    mockHttp.intercept({
      url: TELEMETRY_URL,
      method: "POST",
      reply: { json: { version: "2026.8.24", note: "x".repeat(800) } },
    });

    const result = await checkTelemetryUpdate(() => OPTED_IN_CONFIG, {
      surface: "gateway",
      fetchImpl: globalThis.fetch,
      nowMs: NOW,
    });
    const persisted = readConfigMachineState<{ note?: string }>(TELEMETRY_STATE_KEY);

    expect(result?.note).toHaveLength(500);
    expect(persisted?.note).toHaveLength(500);
  });

  it("bounds streamed update responses without replacing the cached result or successful ping", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(120);
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('{"version":"2026.8.25","padding":"'),
      ...Array<Uint8Array>(32).fill(chunk),
      encoder.encode('"}'),
    ][Symbol.iterator]();
    let canceled = false;
    let enqueuedBytes = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks.next();
        if (next.done) {
          controller.close();
        } else {
          enqueuedBytes += next.value.byteLength;
          controller.enqueue(next.value);
        }
      },
      cancel() {
        canceled = true;
      },
    });
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ version: "2026.8.24", padding: "x".repeat(chunk.length) }),
      )
      .mockResolvedValueOnce(new Response(body));
    const options = { surface: "gateway" as const, fetchImpl };

    await expect(checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW })).resolves.toEqual({
      version: "2026.8.24",
    });
    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + DAY_MS + 1 }),
    ).resolves.toEqual({ version: "2026.8.24" });
    expect(canceled).toBe(true);
    expect(enqueuedBytes).toBeLessThan(32 * chunk.length);
    expect(readConfigMachineState(TELEMETRY_STATE_KEY)).toEqual({
      lastPingAt: NOW,
      latestVersion: "2026.8.24",
    });
    await expect(
      checkTelemetryUpdate(() => OPTED_IN_CONFIG, { ...options, nowMs: NOW + DAY_MS + 30_001 }),
    ).resolves.toEqual({ version: "2026.8.24" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
