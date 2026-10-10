import { expectDefined } from "@branch/normalization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthHealthSummary } from "../../agents/auth-health.js";
import {
  replaceRuntimeAuthProfileStoreSnapshots,
  type AuthProfileStore,
  type RuntimeAuthProfileStore,
} from "../../agents/auth-profiles.js";
import { resetConfigRuntimeState } from "../../config/runtime-snapshot.js";
import type { UsageSummary } from "../../infra/provider-usage.types.js";
import { createPluginMetadataSnapshotFixture } from "../../plugins/plugin-metadata.test-support.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

type BuildAuthHealthSummary = typeof import("../../agents/auth-health.js").buildAuthHealthSummary;

const mocks = vi.hoisted(() => ({
  getRuntimeConfig: vi.fn(() => ({})),
  listAgentIds: vi.fn(() => ["main"]),
  resolveAgentDir: vi.fn(() => "/tmp/agent"),
  resolveDefaultAgentId: vi.fn(() => "main"),
  readPreparedCatalog: vi.fn(),
  loadDeferredCatalog: vi.fn(),
  buildAuthHealthSummary: vi.fn<BuildAuthHealthSummary>(),
  loadProviderUsageSummary: vi.fn(async (): Promise<UsageSummary> => ({
    updatedAt: 0,
    providers: [],
  })),
  listProviderUsagePluginDescriptors: vi.fn(() => [
    { provider: "anthropic", displayName: "Claude" },
  ]),
}));

vi.mock("../../config/config.js", () => ({ getRuntimeConfig: mocks.getRuntimeConfig }));
vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: mocks.listAgentIds,
  resolveAgentDir: mocks.resolveAgentDir,
  resolveDefaultAgentId: mocks.resolveDefaultAgentId,
}));
vi.mock("../../agents/auth-health.js", async () => ({
  ...(await vi.importActual<typeof import("../../agents/auth-health.js")>(
    "../../agents/auth-health.js",
  )),
  buildAuthHealthSummary: mocks.buildAuthHealthSummary,
}));
vi.mock("../../infra/provider-usage.load.js", () => ({
  loadProviderUsageSummary: mocks.loadProviderUsageSummary,
}));
vi.mock("../../plugins/provider-runtime.js", () => ({
  listProviderUsagePluginDescriptors: mocks.listProviderUsagePluginDescriptors,
}));
vi.mock("../../secrets/runtime.js", () => ({
  refreshActiveProviderAuthRuntimeSnapshot: vi.fn(async () => false),
}));
vi.mock("../server-model-catalog-auth.js", () => ({
  loadDeferredCatalog: mocks.loadDeferredCatalog,
  readPreparedCatalog: mocks.readPreparedCatalog,
}));

import { clearModelAuthStatusUsageCache } from "./models-auth-status-usage-cache.js";
import { modelsAuthStatusHandlers } from "./models-auth-status.js";
import type { ModelAuthStatusResult } from "./models-auth-status.types.js";

const handler = expectDefined(
  modelsAuthStatusHandlers["models.authStatus"],
  'modelsAuthStatusHandlers["models.authStatus"] test invariant',
);

const NOW = Date.parse("2026-10-09T03:00:00.000Z");

function tokenCredential(token: string) {
  return { type: "token" as const, provider: "anthropic", token };
}

function useStore(store: RuntimeAuthProfileStore): void {
  replaceRuntimeAuthProfileStoreSnapshots([{ agentDir: "/tmp/agent", store }]);
  const snapshot = (agentId: string) => ({
    agentId,
    agentDir: "/tmp/agent",
    workspaceDir: "/tmp/workspace",
    config: {},
    entries: [],
    routeVariants: [],
    authModes: {},
    authStore: store,
    authMaterializations: [],
    metadataSnapshot: createPluginMetadataSnapshotFixture() as never,
  });
  mocks.readPreparedCatalog.mockImplementation(async (_context, agentId: string) =>
    snapshot(agentId),
  );
  mocks.loadDeferredCatalog.mockImplementation(async (_context, agentId: string) =>
    snapshot(agentId),
  );
}

function useHealth(profileIds: string[]): void {
  const profiles = profileIds.map((profileId) => ({
    profileId,
    provider: "anthropic",
    type: "token" as const,
    status: "static" as const,
    source: "store" as const,
    label: profileId,
  }));
  const summary: AuthHealthSummary = {
    now: NOW,
    warnAfterMs: 0,
    profiles,
    providers: [{ provider: "anthropic", status: "static", profiles }],
  };
  mocks.buildAuthHealthSummary.mockReturnValue(summary);
}

async function readAuthStatus(): Promise<ModelAuthStatusResult> {
  const respond = vi.fn();
  await handler({
    req: { type: "req", id: "req-1", method: "models.authStatus", params: {} },
    params: {},
    client: { connect: { scopes: ["operator.admin"] } } as never,
    isWebchatConnect: () => false,
    respond,
    context: { getRuntimeConfig: mocks.getRuntimeConfig } as unknown,
  } as unknown as GatewayRequestHandlerOptions);
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  expect(ok, JSON.stringify(error)).toBe(true);
  return payload as ModelAuthStatusResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  clearModelAuthStatusUsageCache();
  mocks.getRuntimeConfig.mockReturnValue({});
  mocks.listAgentIds.mockReturnValue(["main"]);
  mocks.resolveDefaultAgentId.mockReturnValue("main");
});

afterEach(() => {
  vi.restoreAllMocks();
  resetConfigRuntimeState();
});

describe("models.authStatus limited accounts", () => {
  it("gives a limited subscription its limitedUntil and leaves free ones alone", async () => {
    const limitedUntil = NOW + 30 * 60 * 60 * 1000;
    useStore({
      version: 1,
      profiles: {
        "anthropic:first": tokenCredential("fixture-token-first"),
        "anthropic:second": tokenCredential("fixture-token-second"),
      },
      order: { anthropic: ["anthropic:first", "anthropic:second"] },
      usageStats: {
        "anthropic:first": {
          blockedUntil: limitedUntil,
          blockedReason: "subscription_limit",
          blockedSource: "provider_retry_after",
        },
      },
    } as AuthProfileStore);
    useHealth(["anthropic:first", "anthropic:second"]);

    const provider = (await readAuthStatus()).providers[0];
    const first = provider?.profiles.find((profile) => profile.profileId === "anthropic:first");
    const second = provider?.profiles.find((profile) => profile.profileId === "anthropic:second");
    expect(first?.limitedUntil).toBe(limitedUntil);
    expect(second).toBeDefined();
    expect(second?.limitedUntil).toBeUndefined();
  });

  it("drops limitedUntil once the reset has passed", async () => {
    useStore({
      version: 1,
      profiles: { "anthropic:first": tokenCredential("fixture-token-first") },
      usageStats: {
        "anthropic:first": {
          blockedUntil: NOW - 1_000,
          blockedReason: "subscription_limit",
          blockedSource: "provider_retry_after",
        },
      },
    } as AuthProfileStore);
    useHealth(["anthropic:first"]);

    const provider = (await readAuthStatus()).providers[0];
    expect(provider?.profiles[0]?.profileId).toBe("anthropic:first");
    expect(provider?.profiles[0]?.limitedUntil).toBeUndefined();
  });
});
