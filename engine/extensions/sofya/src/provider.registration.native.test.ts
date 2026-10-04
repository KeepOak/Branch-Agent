import { readFileSync } from "node:fs";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  BranchPluginApi,
  WebFetchProviderPlugin,
  WebSearchProviderPlugin,
} from "../../../src/plugins/types.js";
import { resolveWebFetchDefinition } from "../../../src/web-fetch/runtime.js";
import { executeWebSearchCandidates } from "../../../src/web-search/runtime-execution.js";
import plugin from "../index.js";

const captured = vi.hoisted(() => ({
  fetchProviders: [] as import("../../../src/plugins/types.js").PluginWebFetchProviderEntry[],
  dns: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
// Discovery is injected from the real index registration, while selection and
// execution run the actual host implementation. No SDK or client mocks.
vi.mock("../../../src/plugins/web-fetch-providers.runtime.js", () => ({
  resolvePluginWebFetchProviders: () => captured.fetchProviders,
  resolveRuntimeWebFetchProviders: () => captured.fetchProviders,
}));
vi.mock("node:dns/promises", async (original) => ({
  ...(await original<typeof import("node:dns/promises")>()),
  lookup: captured.dns,
}));
vi.mock("../../../src/infra/net/undici-runtime.js", async (original) => {
  const actual = await original<typeof import("../../../src/infra/net/undici-runtime.js")>();
  return {
    ...actual,
    loadUndiciRuntimeDeps: () => ({
      ...actual.loadUndiciRuntimeDeps(),
      fetch: vi.fn(() => {
        throw new Error("FORBIDDEN native-network fallback");
      }),
    }),
  };
});

const searches: WebSearchProviderPlugin[] = [];
const fetches: WebFetchProviderPlugin[] = [];
const fetchMock = vi.fn<typeof fetch>();
const cfg: BranchConfig = {
  plugins: {
    entries: {
      sofya: {
        enabled: true,
        config: { webSearch: { apiKey: "synthetic-key" }, webFetch: { apiKey: "synthetic-key" } },
      },
    },
  },
  tools: { web: { fetch: { provider: "sofya" } } },
};
beforeEach(() => {
  searches.length = 0;
  fetches.length = 0;
  captured.fetchProviders = [];
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("SOFYA_API_KEY", "");
  plugin.register?.({
    registerWebSearchProvider(provider: WebSearchProviderPlugin) {
      searches.push(provider);
    },
    registerWebFetchProvider(provider: WebFetchProviderPlugin) {
      fetches.push(provider);
    },
  } as unknown as BranchPluginApi);
  captured.fetchProviders = fetches.map((provider) =>
    Object.assign({}, provider, { pluginId: "sofya" }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("real plugin registers exactly the manifest-declared providers", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../branch.plugin.json", import.meta.url), "utf8"),
  ) as { contracts: { webSearchProviders: string[]; webFetchProviders: string[] } };
  expect(searches.map((provider) => provider.id)).toEqual(manifest.contracts.webSearchProviders);
  expect(fetches.map((provider) => provider.id)).toEqual(manifest.contracts.webFetchProviders);
});
it("executes registered Sofya through actual web-search candidate caller", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        results: [
          { title: "Source", url: "https://example.com/source", content: "Full source content" },
        ],
      }),
    ),
  );
  const result = await executeWebSearchCandidates({
    candidates: searches.map((provider) => Object.assign({}, provider, { pluginId: "sofya" })),
    config: cfg,
    args: { query: "topic", time_range: "month" },
    allowFallback: false,
  });
  expect(result.provider).toBe("sofya");
  expect(result.result).toMatchObject({ provider: "sofya", count: 1 });
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
    query: "topic",
    max_results: 5,
    search_depth: "basic",
    freshness: "month",
  });
});
it("selects and executes registered Sofya through actual web-fetch runtime", async () => {
  const selected = resolveWebFetchDefinition({ config: cfg, preferRuntimeProviders: true });
  expect(selected?.provider.id).toBe("sofya");
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ results: [{ content: "Markdown" }] })),
  );
  await expect(
    selected?.definition.execute({ url: "https://example.com/source" }),
  ).resolves.toMatchObject({ provider: "sofya", extractMode: "markdown" });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://sofya.co/v1/fetch");
});
it("actual caller cancellation wins before dispatch and after provider response", async () => {
  const controller = new AbortController();
  controller.abort(new Error("caller generation retired"));
  await expect(
    executeWebSearchCandidates({
      candidates: searches.map((provider) => Object.assign({}, provider, { pluginId: "sofya" })),
      config: cfg,
      args: { query: "x" },
      signal: controller.signal,
      allowFallback: false,
    }),
  ).rejects.toThrow("caller generation retired");
  expect(fetchMock).not.toHaveBeenCalled();
});
