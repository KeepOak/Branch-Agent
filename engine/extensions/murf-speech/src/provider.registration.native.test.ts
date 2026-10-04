import path from "node:path";
import { fileURLToPath } from "node:url";
import { installPinnedHostnameTestHooks } from "branch/plugin-sdk/test-media-understanding";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPluginRegisterSyncInRegistry } from "../../../src/plugins/loader-module-runtime.js";
import { createPluginRecord } from "../../../src/plugins/loader-records.js";
import { loadPluginManifest } from "../../../src/plugins/manifest.js";
import { createTestPluginRegistry } from "../../../src/plugins/registry-runtime.test-helpers.js";
import {
  captureActivePluginRegistrySnapshot,
  restoreActivePluginRegistrySnapshot,
  setActivePluginRegistry,
} from "../../../src/plugins/runtime.js";
import { synthesizeSpeech } from "../../../src/tts/tts-synthesis.js";
import catalog from "../capability-catalog.js";
import entry from "../index.js";

const pluginRoot = path.dirname(fileURLToPath(new URL("../index.ts", import.meta.url)));
describe("Murf production plugin registration", () => {
  installPinnedHostnameTestHooks();
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("loads the actual manifest and registers through the real loader and provider registrar", async () => {
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
    const api = builder.createApi(record, { config: {} });
    runPluginRegisterSyncInRegistry(entry.register, api, builder.registry, entry.id);
    expect(builder.registry.diagnostics).toEqual([]);
    expect(record.speechProviderIds).toEqual(["murf-speech", "murf"]);
    expect(builder.registry.speechProviders).toHaveLength(1);
    const registration = builder.registry.speechProviders[0]!;
    expect(registration.pluginId).toBe("murf-speech");
    expect(registration.provider.id).toBe(catalog.speechProviders[0]!.id);
    expect(registration.provider.aliases).toEqual(["murf"]);
    expect(loaded.manifest.contracts?.speechProviders).toEqual(["murf-speech", "murf"]);
    expect(loaded.manifest.capabilityCatalogEntry).toBe("./capability-catalog.ts");
    const old = process.env.MURF_API_KEY;
    process.env.MURF_API_KEY = "";
    try {
      expect(registration.provider.isConfigured({ providerConfig: {}, timeoutMs: 1000 })).toBe(
        false,
      );
      const fetch = vi.fn(() => {
        throw new Error("catalog must stay offline");
      });
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetch;
      try {
        expect((await registration.provider.listVoices!({}))[0]?.id).toBe("en-UK-hazel");
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        globalThis.fetch = originalFetch;
      }
    } finally {
      if (old === undefined) {
        delete process.env.MURF_API_KEY;
      } else {
        process.env.MURF_API_KEY = old;
      }
    }
  });
  it.each(["explicit", "voice-model"])(
    "reaches the actual host synthesis caller with %s model selection",
    async (selection) => {
      const snapshot = captureActivePluginRegistrySnapshot();
      const builder = createTestPluginRegistry();
      const record = createPluginRecord({
        id: entry.id,
        source: path.join(pluginRoot, "index.ts"),
        rootDir: pluginRoot,
        origin: "bundled",
        enabled: true,
        configSchema: true,
        contracts: { speechProviders: ["murf-speech", "murf"] },
      });
      builder.registry.plugins.push(record);
      runPluginRegisterSyncInRegistry(
        entry.register,
        builder.createApi(record, { config: {} }),
        builder.registry,
        entry.id,
      );
      setActivePluginRegistry(builder.registry);
      const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === "POST"
          ? new Response(JSON.stringify({ audioFile: "https://audio.example.com/host.mp3" }), {
              headers: { "Content-Type": "application/json" },
            })
          : new Response(new Uint8Array([7, 8]), { headers: { "Content-Type": "audio/mpeg" } }),
      );
      vi.stubGlobal("fetch", fetch);
      try {
        const result = await synthesizeSpeech({
          text: "through host",
          disableFallback: true,
          timeoutMs: 1000,
          prefsPath: path.join(pluginRoot, "missing-fixture-prefs.json"),
          cfg: {
            ...(selection === "voice-model"
              ? { agents: { defaults: { voiceModel: { primary: "murf-speech/GEN1" } } } }
              : {}),
            plugins: { allow: ["murf-speech"] },
            tts: {
              provider: "murf-speech",
              providers: {
                "murf-speech": {
                  apiKey: "host-fixture",
                  ...(selection === "explicit" ? { modelVersion: "GEN1" } : {}),
                  voiceId: "en-US-cooper",
                },
              },
            },
          },
        });
        expect(result.success).toBe(true);
        if (!result.success) {
          throw new Error(result.error);
        }
        expect(result.provider).toBe("murf-speech");
        expect(result.audioBuffer).toEqual(Buffer.from([7, 8]));
        expect(result.fileExtension).toBe(".mp3");
        expect(fetch).toHaveBeenCalledTimes(2);
        const calls = fetch.mock.calls as Array<[string, RequestInit | undefined]>;
        expect(JSON.parse(calls[0]![1]!.body as string)).toEqual({
          text: "through host",
          voiceId: "en-US-cooper",
          modelVersion: "GEN1",
        });
      } finally {
        restoreActivePluginRegistrySnapshot(snapshot);
      }
    },
  );
  it.each(["request", "generation-body", "audio-body", "retry"])(
    "carries actual host parent cancellation through %s",
    async (phase) => {
      const snapshot = captureActivePluginRegistrySnapshot();
      const builder = createTestPluginRegistry();
      const record = createPluginRecord({
        id: entry.id,
        source: path.join(pluginRoot, "index.ts"),
        rootDir: pluginRoot,
        origin: "bundled",
        enabled: true,
        configSchema: true,
        contracts: { speechProviders: ["murf-speech", "murf"] },
      });
      builder.registry.plugins.push(record);
      runPluginRegisterSyncInRegistry(
        entry.register,
        builder.createApi(record, { config: {} }),
        builder.registry,
        entry.id,
      );
      setActivePluginRegistry(builder.registry);
      const controller = new AbortController();
      const reason = new Error(`fixture parent aborted ${phase}`);
      const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
        expect(init?.signal).toBeDefined();
        if (phase === "request") {
          return await new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), {
              once: true,
            });
            setTimeout(() => controller.abort(reason), 25);
          });
        }
        if (init?.method === "POST") {
          if (phase === "retry") {
            setTimeout(() => controller.abort(reason), 25);
            return new Response(JSON.stringify({ message: "retry" }), {
              status: 429,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (phase === "generation-body") {
            setTimeout(() => controller.abort(reason), 25);
            return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({ audioFile: "https://audio.example.com/abort.mp3" }),
            { headers: { "Content-Type": "application/json" } },
          );
        }
        setTimeout(() => controller.abort(reason), 25);
        return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          headers: { "Content-Type": "audio/mpeg" },
        });
      });
      vi.stubGlobal("fetch", fetch);
      try {
        await expect(
          synthesizeSpeech({
            text: "cancel through host",
            signal: controller.signal,
            timeoutMs: 1000,
            prefsPath: path.join(pluginRoot, "missing-fixture-prefs.json"),
            cfg: {
              plugins: { allow: ["murf-speech"] },
              tts: {
                provider: "murf-speech",
                providers: { "murf-speech": { apiKey: "host-fixture" } },
              },
            },
          }),
        ).rejects.toBe(reason);
        expect(fetch).toHaveBeenCalledTimes(phase === "audio-body" ? 2 : 1);
      } finally {
        restoreActivePluginRegistrySnapshot(snapshot);
      }
    },
  );
});
