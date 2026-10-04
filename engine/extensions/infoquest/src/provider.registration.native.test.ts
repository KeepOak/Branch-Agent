import { readFileSync } from "node:fs";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createPluginRecord } from "../../../src/plugins/loader-records.js";
import { collectPublicArtifactFactories } from "../../../src/plugins/public-artifact-factories.js";
import { createPluginRegistry } from "../../../src/plugins/registry.js";
import type { PluginRuntime } from "../../../src/plugins/runtime/types.js";
import { resolveWebFetchDefinition } from "../../../src/web-fetch/runtime.js";
import { executeWebSearchCandidates } from "../../../src/web-search/runtime-execution.js";
import plugin, {
  createInfoQuestWebSearchProvider,
  createInfoQuestWebFetchProvider,
} from "../index.js";
const fixture = vi.hoisted(() => ({
  fetches: [] as import("../../../src/plugins/types.js").PluginWebFetchProviderEntry[],
  dns: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
// Only loader discovery is supplied from the real host registry below. Host
// selection, credential contracts, callbacks, guards and readers stay actual.
vi.mock("../../../src/plugins/web-fetch-providers.runtime.js", () => ({
  resolvePluginWebFetchProviders: () => fixture.fetches,
  resolveRuntimeWebFetchProviders: () => fixture.fetches,
}));
vi.mock("node:dns/promises", async (original) => ({
  ...(await original<typeof import("node:dns/promises")>()),
  lookup: fixture.dns,
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
const cfg: BranchConfig = {
  plugins: {
    entries: {
      infoquest: {
        enabled: true,
        config: {
          webSearch: { apiKey: "synthetic-search" },
          webFetch: { apiKey: "synthetic-fetch" },
          imageSearch: { apiKey: "synthetic-image" },
        },
      },
    },
  },
  tools: { web: { fetch: { provider: "infoquest" } } },
};
const fetchMock = vi.fn<typeof fetch>();
function registered() {
  const builder = createPluginRegistry({
    logger: { info() {}, warn() {}, error() {} },
    runtime: {} as PluginRuntime,
    activateGlobalSideEffects: false,
  });
  const record = createPluginRecord({
    id: "infoquest",
    source: new URL("../index.ts", import.meta.url).pathname,
    origin: "bundled",
    enabled: true,
    configSchema: true,
    contracts: {
      tools: ["infoquest_image_search"],
      webSearchProviders: ["infoquest"],
      webFetchProviders: ["infoquest"],
    },
  });
  builder.registry.plugins.push(record);
  plugin.register(builder.createApi(record, { config: cfg }));
  fixture.fetches = builder.registry.webFetchProviders.map((entry) =>
    Object.assign({}, entry.provider, { pluginId: entry.pluginId }),
  );
  return { builder, record };
}
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INFOQUEST_API_KEY", "");
  fixture.fetches = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("actual index registers manifest search/fetch contracts and named image tool in real registry", () => {
  const { builder, record } = registered();
  const manifest = JSON.parse(
    readFileSync(new URL("../branch.plugin.json", import.meta.url), "utf8"),
  ) as { contracts: { webSearchProviders: string[]; webFetchProviders: string[] } };
  expect(record.webSearchProviderIds).toEqual(manifest.contracts.webSearchProviders);
  expect(record.webFetchProviderIds).toEqual(manifest.contracts.webFetchProviders);
  expect(record.toolNames).toEqual(["infoquest_image_search"]);
  expect(builder.registry.tools).toHaveLength(1);
  expect(builder.registry.diagnostics).toEqual([]);
});
it("actual host search candidate executes real registered client", async () => {
  const { builder } = registered();
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ search_result: { results: [] } })));
  const result = await executeWebSearchCandidates({
    candidates: builder.registry.webSearchProviders.map((entry) =>
      Object.assign({}, entry.provider, { pluginId: entry.pluginId }),
    ),
    config: cfg,
    args: { query: "topic" },
    allowFallback: false,
  });
  expect(result).toMatchObject({ provider: "infoquest", result: { count: 0 } });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://search.infoquest.bytepluses.com/");
});
it("actual host fetch selects registered provider, executes guarded crawl and wraps content", async () => {
  registered();
  const selected = resolveWebFetchDefinition({ config: cfg, preferRuntimeProviders: true });
  expect(selected?.provider.id).toBe("infoquest");
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ reader_result: "<p>Native crawl.</p>" })),
  );
  expect(await selected?.definition.execute({ url: "https://example.com" })).toMatchObject({
    provider: "infoquest",
    extractMode: "markdown",
  });
  expect(fetchMock.mock.calls[0]?.[0]).toBe("https://reader.infoquest.bytepluses.com/");
});
it("registered image tool factory executes separate image protocol", async () => {
  const { builder } = registered();
  const tool = builder.registry.tools[0]?.factory({ config: cfg, assertInvocationCurrent() {} });
  expect(tool && !Array.isArray(tool) && tool.name).toBe("infoquest_image_search");
  if (!tool || Array.isArray(tool)) {
    throw new Error("missing real image factory");
  }
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ search_result: { results: [] } })));
  await expect(tool.execute("fixture", { query: "portrait" })).resolves.toMatchObject({
    details: { search_type: "Images", count: 0 },
  });
  expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
    search_type: "Images",
    image_size: "i",
  });
});
it("real host current-turn fence prevents dispatch and stale return", async () => {
  const { builder } = registered();
  const candidates = builder.registry.webSearchProviders.map((entry) =>
    Object.assign({}, entry.provider, { pluginId: entry.pluginId }),
  );
  await expect(
    executeWebSearchCandidates({
      candidates,
      config: cfg,
      args: { query: "x" },
      assertCurrent() {
        throw new Error("caller retired");
      },
      allowFallback: false,
    }),
  ).rejects.toThrow("caller retired");
  expect(fetchMock).not.toHaveBeenCalled();
  let retired = false;
  fetchMock.mockImplementationOnce(async () => {
    retired = true;
    return new Response(JSON.stringify({ search_result: { results: [] } }));
  });
  await expect(
    executeWebSearchCandidates({
      candidates,
      config: cfg,
      args: { query: "x" },
      assertCurrent() {
        if (retired) {
          throw new Error("caller retired after");
        }
      },
      allowFallback: false,
    }),
  ).rejects.toThrow("caller retired after");
});

it("actual public artifact collector recognizes exported search/fetch factories", () => {
  const mod = { createInfoQuestWebSearchProvider, createInfoQuestWebFetchProvider };
  for (const suffix of ["WebSearchProvider", "WebFetchProvider"]) {
    const providers = collectPublicArtifactFactories({
      mod,
      suffix,
      isArtifact: (value): value is { id: string } =>
        typeof value === "object" && value !== null && "id" in value,
    });
    expect(providers.map((provider) => provider.id)).toEqual(["infoquest"]);
  }
});
