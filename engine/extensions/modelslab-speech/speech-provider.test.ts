import { capturePluginRegistration } from "branch/plugin-sdk/plugin-test-runtime";
import { installPinnedHostnameTestHooks } from "branch/plugin-sdk/test-media-understanding";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSpeechProviderRegistry } from "../../src/tts/provider-registry-core.js";
import { resolveTtsConfig } from "../../src/tts/tts-settings.js";
import { executeTtsProviderAttempts } from "../../src/tts/tts-synthesis-support.js";
import plugin from "./index.js";

const [provider] = capturePluginRegistration(plugin).speechProviders;
if (!provider) {
  throw new Error("ModelsLab speech provider was not registered");
}
const registry = createSpeechProviderRegistry({
  getProvider: (id) => (id === provider.id ? provider : undefined),
  listProviders: () => [provider],
});
function fakeHttp() {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: "success", output: "https://cdn.modelslab.com/audio.mp3" }),
        {
          headers: { "content-type": "application/json" },
        },
      ),
    )
    .mockResolvedValueOnce(
      new Response(Buffer.from("fixture-audio"), { headers: { "content-type": "audio/mpeg" } }),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
describe("registered ModelsLab provider at host speech boundary", () => {
  installPinnedHostnameTestHooks();
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it("resolves configured selection and actual synthesis through host provider attempts", async () => {
    const fetchMock = fakeHttp();
    const cfg = {
      tts: {
        provider: "modelslab",
        providers: { modelslab: { apiKey: "fixture-credential", voice: "echo" } },
      },
    };
    const result = await executeTtsProviderAttempts({
      cfg,
      config: resolveTtsConfig(cfg),
      providers: [{ provider: "modelslab" }],
      synthesisText: "production boundary",
      target: "audio-file",
      logLabel: "ModelsLab fixture",
      prepareProviderRegistry: async () => registry,
      selectOperation: ({ resolvedProvider }) => ({
        kind: "ready",
        synthesize: (request) => resolvedProvider.provider.synthesize(request),
      }),
      buildSuccess: (value) => value,
    });
    expect(result).toHaveProperty("provider", "modelslab");
    expect(result).toHaveProperty("synthesis.audioBuffer", Buffer.from("fixture-audio"));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      key: "fixture-credential",
      prompt: "production boundary",
      language: "english",
      voice_id: 2,
      speed: 1,
    });
  });
  it("keeps no-key behavior unconfigured and skips transport in the actual host attempt loop", async () => {
    vi.stubEnv("MODELSLAB_API_KEY", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const cfg = { tts: { provider: "modelslab" } };
    const result = await executeTtsProviderAttempts({
      cfg,
      config: resolveTtsConfig(cfg),
      providers: [{ provider: "modelslab" }],
      synthesisText: "no credential",
      target: "audio-file",
      logLabel: "ModelsLab fixture",
      prepareProviderRegistry: async () => registry,
      selectOperation: ({ resolvedProvider }) => ({
        kind: "ready",
        synthesize: (request) => resolvedProvider.provider.synthesize(request),
      }),
      buildSuccess: (value) => value,
    });
    expect(result).toHaveProperty("success", false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses environment credential, request options and host audio byte cap", async () => {
    vi.stubEnv("MODELSLAB_API_KEY", "environment-fixture");
    const fetchMock = fakeHttp();
    await expect(
      provider.synthesize({
        cfg: { agents: { defaults: { mediaMaxMb: 3 / 1024 / 1024 } } },
        text: "test",
        providerConfig: {},
        providerOverrides: { voice: "nova", language: "french", speed: 0.75 },
        timeoutMs: 1000,
        target: "audio-file",
      }),
    ).rejects.toThrow("exceeds 3 bytes");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      key: "environment-fixture",
      voice_id: 5,
      language: "french",
      speed: 0.75,
    });
  });
  it("normalizes resolved secrets and retains alias config defaults", () => {
    const context = {
      cfg: {},
      timeoutMs: 1000,
      rawConfig: { providers: { "modelslab-speech": { apiKey: "fixture", speaker: "6" } } },
    };
    expect(provider.resolveConfig?.(context)).toMatchObject({
      apiKey: "fixture",
      voice: "6",
      language: "english",
      speed: 1,
    });
    expect(() =>
      provider.resolveConfig?.({
        ...context,
        rawConfig: {
          providers: {
            modelslab: {
              apiKey: { source: "file", provider: "fixture", id: "unresolved" },
            },
          },
        },
      }),
    ).toThrow();
  });
});
