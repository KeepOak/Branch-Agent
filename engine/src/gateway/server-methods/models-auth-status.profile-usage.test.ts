import { expectDefined } from "@branch/normalization-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthHealthSummary } from "../../agents/auth-health.js";
import {
  replaceRuntimeAuthProfileStoreSnapshots,
  type AuthProfileStore,
  type RuntimeAuthProfileStore,
} from "../../agents/auth-profiles.js";
import {
  recordAnthropicUnifiedRateLimits,
  resetAnthropicUnifiedRateLimitsForTest,
} from "../../agents/auth-profiles/usage-rate-limits.js";
import { RECORDED_UNIFIED_HEADERS } from "../../agents/auth-profiles/usage-rate-limits.test-support.js";
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
  resetAnthropicUnifiedRateLimitsForTest();
  resetConfigRuntimeState();
});

const PROFILES = [
  "anthropic:one@example.com",
  "anthropic:two@example.com",
  "anthropic:three@example.com",
  "anthropic:four@example.com",
];
const HEADER_WINDOWS = [
  { label: "5h", usedPercent: 9, resetAt: 1_791_764_400_000 },
  { label: "Week", usedPercent: 1, resetAt: 1_792_360_800_000 },
];

function useSetupTokens(): void {
  useStore({
    version: 1,
    profiles: Object.fromEntries(
      PROFILES.map((id, i) => [id, tokenCredential(`fixture-token-${i}`)]),
    ),
    order: { anthropic: PROFILES },
  } as AuthProfileStore);
  useHealth(PROFILES);
}

describe("models.authStatus per-account usage", () => {
  it("gives every setup-token account that made a request its 5h and weekly windows", async () => {
    useSetupTokens();
    for (const profileId of PROFILES.slice(0, 3)) {
      recordAnthropicUnifiedRateLimits({ profileId, headers: RECORDED_UNIFIED_HEADERS, now: NOW });
    }

    const profiles = (await readAuthStatus()).providers[0]?.profiles ?? [];
    expect(profiles.map((profile) => profile.profileId)).toEqual(PROFILES);
    for (const profile of profiles.slice(0, 3)) {
      expect(profile.usage).toEqual({ windows: HEADER_WINDOWS });
    }
    expect(profiles[3]?.usage).toBeUndefined();
  });

  it("prefers each account's usage reading over the header reading", async () => {
    useSetupTokens();
    recordAnthropicUnifiedRateLimits({
      profileId: PROFILES[0],
      headers: RECORDED_UNIFIED_HEADERS,
      now: NOW,
    });
    const oauthWindows = [{ label: "5h", usedPercent: 40, resetAt: NOW + 3_600_000 }];
    mocks.loadProviderUsageSummary.mockResolvedValue({
      updatedAt: NOW,
      providers: [
        {
          provider: "anthropic",
          displayName: "Claude",
          windows: oauthWindows,
          plan: "Max (20x)",
          authProfileId: PROFILES[0],
          inUse: true,
        },
        {
          provider: "anthropic",
          displayName: "Claude",
          windows: [],
          error: "HTTP 403",
          authProfileId: PROFILES[1],
        },
      ],
    });

    await readAuthStatus();
    await vi.waitFor(() => expect(mocks.loadProviderUsageSummary).toHaveBeenCalled());
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    const profiles = (await readAuthStatus()).providers[0]?.profiles ?? [];
    expect(profiles[0]?.usage).toEqual({ windows: oauthWindows, plan: "Max (20x)" });
    expect(profiles[1]?.usage).toBeUndefined();
  });
});
