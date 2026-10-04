import { afterEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { createCapturedPluginRegistration } from "../../../src/plugins/captured-registration.js";
import { collectPublicArtifactFactories } from "../../../src/plugins/public-artifact-factories.js";
import { createPluginRecord } from "../../../src/plugins/loader-records.js";
import { createProviderRegistrars } from "../../../src/plugins/registry-registrars-providers.js";
import { createPluginRegistryState } from "../../../src/plugins/registry-state.js";
import type { PluginRuntime } from "../../../src/plugins/runtime/types.js";
import { executeWebSearchCandidates } from "../../../src/web-search/runtime-execution.js";
import plugin from "../index.js";
import * as publicArtifact from "../web-search-provider.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Tencent actual plugin and host registration", () => {
  it("exposes the real explicit bundled search factory artifact", () => {
    const providers = collectPublicArtifactFactories({
      mod: publicArtifact,
      suffix: "WebSearchProvider",
      isArtifact: (
        value,
      ): value is ReturnType<typeof publicArtifact.createTencentWsaWebSearchProvider> =>
        value !== null && typeof value === "object" && "id" in value && value.id === "tencent-wsa",
    });
    expect(providers.map((provider) => provider.id)).toEqual(["tencent-wsa"]);
  });
  it("captures the production entry and preserves credential/selection hooks", () => {
    const captured = createCapturedPluginRegistration();
    plugin.register?.(captured.api);
    expect(captured.webSearchProviders).toHaveLength(1);
    const provider = captured.webSearchProviders[0]!;
    expect(provider.id).toBe("tencent-wsa");
    expect(provider.envVars).toEqual(["TENCENTCLOUD_WSA_APIKEY"]);
    const cfg: BranchConfig = {};
    provider.setConfiguredCredentialValue?.(cfg, "configured-fake-key");
    expect(provider.getConfiguredCredentialValue?.(cfg)).toBe("configured-fake-key");
    const selected = provider.applySelectionConfig?.(cfg);
    expect(selected?.plugins?.entries?.["tencent-wsa"]?.enabled).toBe(true);
    const scoped: Record<string, unknown> = {};
    provider.setCredentialValue(scoped, "scoped-fake-key");
    expect(provider.getCredentialValue(scoped)).toBe("scoped-fake-key");
    expect(provider.autoDetectOrder).toBeUndefined();
  });

  it("registers through the real host registrar and executes host-selected Tencent tool", async () => {
    vi.stubEnv("TENCENTCLOUD_WSA_APIKEY", "");
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            Response: {
              Pages: [{ title: "Citation", url: "https://example.com/citation", content: "Text" }],
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const captured = createCapturedPluginRegistration();
    plugin.register?.(captured.api);
    const provider = captured.webSearchProviders[0]!;
    const state = createPluginRegistryState({
      logger: { info() {}, warn() {}, error() {} },
      runtime: {} as PluginRuntime,
      activateGlobalSideEffects: false,
    });
    const record = createPluginRecord({
      id: plugin.id,
      source: "/fixture/tencent/index.ts",
      origin: "bundled",
      enabled: true,
      configSchema: true,
    });
    createProviderRegistrars(state).registerWebSearchProvider(record, provider);
    expect(state.registry.webSearchProviders).toHaveLength(1);
    expect(record.webSearchProviderIds).toEqual(["tencent-wsa"]);
    const registered = state.registry.webSearchProviders[0]!;
    const config: BranchConfig = {};
    provider.setConfiguredCredentialValue?.(config, "host-selected-fake-key");
    const result = await executeWebSearchCandidates({
      candidates: [{ ...registered.provider, pluginId: registered.pluginId }],
      config,
      args: { query: "q" },
      allowFallback: false,
    });
    expect(result.provider).toBe("tencent-wsa");
    expect(result.result).toMatchObject({
      provider: "tencent-wsa",
      count: 1,
      results: [expect.objectContaining({ url: "https://example.com/citation" })],
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
