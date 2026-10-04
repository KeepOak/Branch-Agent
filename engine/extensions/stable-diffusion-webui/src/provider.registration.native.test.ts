import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeImageGenerationJob } from "../../../src/agents/tools/image-generate-tool.execution.js";
import type { BranchConfig } from "../../../src/config/types.branch.js";
import { generateImage } from "../../../src/image-generation/runtime.js";
import { loadUndiciModule } from "../../../src/infra/net/undici-dispatcher-options.js";
import { createMediaProviderLookup } from "../../../src/media-generation/provider-registry.js";
import { runPluginRegisterSyncInRegistry } from "../../../src/plugins/loader-module-runtime.js";
import { createPluginRecord } from "../../../src/plugins/loader-records.js";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import { createTestPluginRegistry } from "../../../src/plugins/registry-runtime.test-helpers.js";
import entry from "../index.js";
vi.mock("node:dns/promises", async (original) => ({
  ...(await original<typeof import("node:dns/promises")>()),
  lookup: vi.fn(async (hostname: string) => {
    if (hostname !== "127.0.0.1") {
      throw new Error("Forbidden offline DNS");
    }
    return [{ address: "127.0.0.1", family: 4 }];
  }),
}));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=",
  "base64",
);
const pluginRoot = path.dirname(fileURLToPath(new URL("../index.ts", import.meta.url)));
const cfg: BranchConfig = {
  plugins: {
    entries: {
      "stable-diffusion-webui": {
        config: {
          baseUrl: "http://127.0.0.1:7860",
          headers: { "X-Custom-Key": "synthetic-only-key" },
          parameters: { negative_prompt: "blur", sampler_name: "Euler a" },
        },
      },
    },
  },
  agents: {
    defaults: { mediaModels: { image: { primary: "stable-diffusion-webui/configured" } } },
  },
};
function register() {
  const loaded = loadPluginManifest(pluginRoot);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  const builder = createTestPluginRegistry();
  const record = createPluginRecord({
    id: entry.id,
    source: path.join(pluginRoot, "index.ts"),
    rootDir: pluginRoot,
    origin: "bundled",
    enabled: true,
    configSchema: true,
    contracts: loaded.manifest.contracts,
  });
  builder.registry.plugins.push(record);
  runPluginRegisterSyncInRegistry(
    entry.register,
    builder.createApi(record, { config: cfg }),
    builder.registry,
    entry.id,
  );
  expect(builder.registry.diagnostics).toEqual([]);
  return { builder, record, manifest: loaded.manifest };
}
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
beforeEach(() => {
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "BRANCH_PROXY_ACTIVE",
    "BRANCH_DEBUG_PROXY_ENABLED",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.spyOn(loadUndiciModule(["fetch"]), "fetch").mockImplementation(() => {
    throw new Error("Native network forbidden");
  });
  fetch = vi.fn(async (input, init) => {
    const url = String(input);
    if (url !== "http://127.0.0.1:7860/sdapi/v1/txt2img" || init?.method !== "POST") {
      throw new Error("Forbidden offline HTTP");
    }
    return new Response(
      JSON.stringify({
        images: [PNG.toString("base64")],
        info: JSON.stringify({ seed: 123, infotexts: ["a picture\nSeed: 123"] }),
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  vi.mocked(loadUndiciModule(["fetch"]).fetch).mockImplementation(
    (input, init) =>
      fetch(input as RequestInfo, init as RequestInit) as unknown as ReturnType<
        typeof import("undici").fetch
      >,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("actual Stable Diffusion WebUI registration and image caller", () => {
  it("loads actual manifest/index and registers through real provider registrar", () => {
    const { builder, record, manifest } = register();
    expect(record.imageGenerationProviderIds).toEqual(["stable-diffusion-webui"]);
    expect(manifest.contracts?.imageGenerationProviders).toEqual(["stable-diffusion-webui"]);
    expect(builder.registry.imageGenerationProviders).toHaveLength(1);
    expect(builder.registry.imageGenerationProviders[0]?.pluginId).toBe(entry.id);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["configured primary", "explicit override"])(
    "selects actual registered provider through host image runtime: %s",
    async (selection) => {
      const { builder } = register();
      const providers = builder.registry.imageGenerationProviders.map((r) => r.provider);
      const lookup = createMediaProviderLookup(providers);
      const result = await generateImage(
        {
          cfg,
          prompt: "host landscape",
          ...(selection === "explicit override"
            ? { modelOverride: "stable-diffusion-webui/configured" }
            : {}),
          providerOptions: { "stable-diffusion-webui": { steps: 30, seed: 100 } },
          size: "512x768",
          timeoutMs: 1000,
        },
        lookup,
      );
      expect(result.provider).toBe("stable-diffusion-webui");
      expect(result.images[0]?.buffer).toEqual(PNG);
      expect(result.images[0]?.metadata?.seed).toBe(123);
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
        prompt: "host landscape",
        negative_prompt: "blur",
        sampler_name: "Euler a",
        steps: 30,
        seed: 100,
        width: 512,
        height: 768,
      });
      expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("X-Custom-Key")).toBe(
        "synthetic-only-key",
      );
    },
  );
  it("persists real binary output through canonical image execution and media store", async () => {
    const { builder } = register();
    const result = await executeImageGenerationJob({
      effectiveCfg: cfg,
      prompt: "stored landscape",
      count: 1,
      inputImages: [],
      loadedReferenceImages: [],
      providers: builder.registry.imageGenerationProviders.map((r) => r.provider),
      timeoutMs: 1000,
      filename: "webui-fixture.png",
    });
    expect(result.details.provider).toBe("stable-diffusion-webui");
    const attachments = result.details.attachments as Array<{ path: string; mimeType: string }>;
    expect(attachments).toHaveLength(1);
    const saved = attachments[0]!;
    expect(saved.path).toContain("tool-image-generation");
    expect(saved.mimeType).toBe("image/png");
    expect(await fs.readFile(saved.path)).toEqual(PNG);
    await fs.rm(saved.path, { force: true });
  });
});
