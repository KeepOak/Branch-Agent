import assert from "node:assert/strict";
import { Socket } from "node:net";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createPluginRecord } from "../../../src/plugins/loader-records.js";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import { createTestPluginRegistry } from "../../../src/plugins/registry-runtime.test-helpers.js";
import { executeWebSearchCandidates } from "../../../src/web-search/runtime-execution.js";
import { resolveWebSearchProviderId } from "../../../src/web-search/runtime.js";
import plugin from "../index.js";

test("production manifest/index registers real Serply provider and actual host selects/executes it", async (t) => {
  t.mock.method(Socket.prototype, "connect", () => {
    throw new Error("Offline registry fixture forbids native socket transport");
  });
  const loaded = loadPluginManifest(fileURLToPath(new URL("..", import.meta.url)));
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  assert.deepEqual(loaded.manifest.contracts?.webSearchProviders, ["serply"]);
  assert.deepEqual(loaded.manifest.setup?.providers?.[0]?.envVars, ["SERPLY_API_KEY"]);
  const builder = createTestPluginRegistry();
  const record = createPluginRecord({
    id: "serply",
    source: "offline-fixture",
    origin: "bundled",
    enabled: true,
    configSchema: true,
    contracts: loaded.manifest.contracts,
  });
  builder.registry.plugins.push(record);
  const config = {
    tools: { web: { search: { provider: "serply" } } },
    plugins: {
      entries: {
        serply: {
          enabled: true,
          config: { webSearch: { apiKey: "registry-synthetic-key", vertical: "scholar" } },
        },
      },
    },
  };
  await plugin.register(builder.createApi(record, { config }));
  assert.deepEqual(record.webSearchProviderIds, ["serply"]);
  assert.equal(builder.registry.webSearchProviders.length, 1);
  const registered = builder.registry.webSearchProviders[0]!;
  const provider = { ...registered.provider, pluginId: "serply" };
  assert.equal(
    resolveWebSearchProviderId({ config, search: { provider: "serply" }, providers: [provider] }),
    "serply",
  );
  const oldFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      called++;
      assert.equal(new URL(String(input)).pathname, "/v1/scholar/");
      assert.equal(new Headers(init.headers).get("x-api-key"), "registry-synthetic-key");
      return new Response(
        JSON.stringify({
          articles: [
            {
              title: "Real registered provider",
              link: "https://example.org/paper",
              extras: { citations: { count: 4 } },
            },
          ],
        }),
      );
    },
    { mock: {} },
  ) as typeof fetch;
  try {
    const executed = await executeWebSearchCandidates({
      candidates: [provider],
      config,
      args: { query: "offline" },
      allowFallback: false,
    });
    assert.equal(executed.provider, "serply");
    assert.equal(executed.result.vertical, "scholar");
    assert.equal((executed.result.results as Record<string, unknown>[])[0]!.cited_by, 4);
    assert.equal(called, 1);
    const controller = new AbortController();
    controller.abort(new Error("host aborted"));
    await assert.rejects(
      executeWebSearchCandidates({
        candidates: [provider],
        config,
        args: { query: "offline" },
        allowFallback: false,
        signal: controller.signal,
      }),
      /host aborted/,
    );
    assert.equal(called, 1);
  } finally {
    globalThis.fetch = oldFetch;
    mock.restoreAll();
  }
});
