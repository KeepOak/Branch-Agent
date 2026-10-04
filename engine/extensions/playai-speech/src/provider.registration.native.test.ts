import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import { runPluginRegisterSyncInRegistry } from "../../../src/plugins/loader-module-runtime.js";
import { createPluginRecord } from "../../../src/plugins/loader-records.js";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import { createTestPluginRegistry } from "../../../src/plugins/registry-runtime.test-helpers.js";
import catalog from "../capability-catalog.js";
import plugin from "../index.js";

test("actual manifest and entry register through production loader and registrar", () => {
  const root = path.dirname(fileURLToPath(new URL("../index.ts", import.meta.url)));
  const loaded = loadPluginManifest(root);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  assert.equal(loaded.ok, true);
  const builder = createTestPluginRegistry();
  const record = createPluginRecord({
    id: plugin.id,
    source: path.join(root, "index.ts"),
    rootDir: root,
    origin: "bundled",
    enabled: true,
    configSchema: true,
    contracts: loaded.manifest.contracts,
  });
  builder.registry.plugins.push(record);
  const api = builder.createApi(record, { config: {} });
  runPluginRegisterSyncInRegistry(plugin.register, api, builder.registry, plugin.id);
  assert.deepEqual(builder.registry.diagnostics, []);
  assert.deepEqual(record.speechProviderIds, ["playai-speech", "playai"]);
  assert.equal(builder.registry.speechProviders.length, 1);
  const provider = builder.registry.speechProviders[0]!.provider;
  assert.equal(provider.id, "playai-speech");
  assert.deepEqual(provider.aliases, ["playai"]);
  assert.equal(typeof provider.synthesize, "function");
  assert.equal(typeof provider.streamSynthesize, "function");
  assert.equal(provider.synthesizeTelephony, undefined);
  assert.deepEqual(provider.models, ["PlayDialog", "Play3.0-mini"]);
  assert.equal(catalog.speechProviders[0]!.id, provider.id);
  assert.equal(loaded.manifest.capabilityCatalogEntry, "./capability-catalog.ts");
  assert.deepEqual(loaded.manifest.contracts?.speechProviders, ["playai-speech", "playai"]);
});
