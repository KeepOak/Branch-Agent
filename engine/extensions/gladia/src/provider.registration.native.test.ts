import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildMediaUnderstandingRegistry,
  getMediaUnderstandingProvider,
} from "../../../src/media-understanding/provider-registry.js";
import { createPluginRecord } from "../../../src/plugins/loader-records.js";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import { createTestPluginRegistry } from "../../../src/plugins/registry-runtime.test-helpers.js";
import catalog from "../capability-catalog.js";
import plugin from "../index.js";

test("production entry registers Gladia through the actual host registry and media caller lookup", async () => {
  const loaded = loadPluginManifest(fileURLToPath(new URL("..", import.meta.url)));
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.manifest.contracts?.mediaUnderstandingProviders, ["gladia"]);
  assert.deepEqual(loaded.manifest.setup?.providers?.[0]?.envVars, ["GLADIA_API_KEY"]);
  assert.deepEqual(catalog, {});
  const builder = createTestPluginRegistry();
  const record = createPluginRecord({
    id: "gladia",
    source: "offline-fixture",
    origin: "bundled",
    enabled: true,
    configSchema: true,
    contracts: loaded.manifest.contracts,
  });
  builder.registry.plugins.push(record);
  const api = builder.createApi(record, { config: {} });
  await plugin.register(api);
  assert.deepEqual(record.mediaUnderstandingProviderIds, ["gladia"]);
  assert.equal(builder.registry.mediaUnderstandingProviders.length, 1);
  const registered = builder.registry.mediaUnderstandingProviders[0];
  assert.ok(registered);
  const registry = buildMediaUnderstandingRegistry(undefined, {}, [registered.provider]);
  const provider = getMediaUnderstandingProvider("gladia", registry);
  assert.equal(provider?.id, "gladia");
  assert.deepEqual(provider?.capabilities, ["audio"]);
  assert.deepEqual(provider?.defaultModels, { audio: "gladia" });
});
