import path from "node:path";
import { fileURLToPath } from "node:url";
import { capturePluginRegistration } from "branch/plugin-sdk/plugin-test-runtime";
import { describe, expect, it, vi } from "vitest";
import { discoverBranchPlugins } from "../../../src/plugins/discovery.js";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import catalog from "../capability-catalog.js";
import plugin from "../index.js";

describe("ModelsLab production registration and discovery contract", () => {
  it("captures the actual entry through the real host API and exposes the same capability catalog", () => {
    const registered = capturePluginRegistration(plugin);
    expect(registered.speechProviders).toHaveLength(1);
    expect(registered.speechProviders[0]?.id).toBe("modelslab");
    expect(registered.speechProviders[0]?.aliases).toEqual(["modelslab-speech"]);
    expect(catalog.speechProviders.map((p) => p.id)).toEqual(["modelslab"]);
    expect(registered.mediaUnderstandingProviders).toHaveLength(0);
  });
  it("loads the real manifest and declared catalog through the production manifest parser", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const loaded = loadPluginManifest(root);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      throw new Error(loaded.error);
    }
    expect(loaded.manifest.id).toBe("modelslab-speech");
    expect(loaded.manifest.capabilityCatalogEntry).toBe("./capability-catalog.ts");
    expect(loaded.manifest.contracts?.speechProviders).toEqual(["modelslab", "modelslab-speech"]);
    expect(loaded.manifest.configSchema).toHaveProperty("properties.apiKey");
  });
  it("discovers the actual new extension from the bundled source tree", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const discovered = discoverBranchPlugins({
      rootScope: "bundled",
      bundledRoot: path.dirname(root),
    });
    const candidate = discovered.candidates.find((entry) => entry.idHint === "modelslab-speech");
    expect(candidate?.rootDir).toBe(root);
    expect(candidate?.source).toBe(path.join(root, "index.ts"));
    expect(candidate?.origin).toBe("bundled");
  });
  it("does not become configured by registration or discovery without a credential", () => {
    vi.stubEnv("MODELSLAB_API_KEY", undefined);
    try {
      const [provider] = capturePluginRegistration(plugin).speechProviders;
      expect(provider?.isConfigured({ providerConfig: {}, timeoutMs: 1000 })).toBe(false);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
