import { installPinnedHostnameTestHooks } from "branch/plugin-sdk/test-media-understanding";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildMurfSpeechProvider } from "./speech-provider.js";
import { MURF_VOICES } from "./src/voices.js";

const provider = buildMurfSpeechProvider();
const req = {
  text: "hello",
  cfg: {},
  providerConfig: { apiKey: "fixture" },
  target: "audio-file" as const,
  timeoutMs: 1000,
};
describe("Murf actual speech provider hooks", () => {
  installPinnedHostnameTestHooks();
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("remains unconfigured without a key and resolves the donor environment variable", () => {
    vi.stubEnv("MURF_API_KEY", "");
    expect(provider.isConfigured({ providerConfig: {}, timeoutMs: 1000 })).toBe(false);
    vi.stubEnv("MURF_API_KEY", "fixture");
    expect(provider.isConfigured({ providerConfig: {}, timeoutMs: 1000 })).toBe(true);
  });
  it("uses strict host secret resolution for unresolved references", () => {
    vi.stubEnv("MURF_API_KEY", "");
    expect(() =>
      provider.resolveConfig!({
        cfg: {},
        timeoutMs: 1000,
        rawConfig: {
          providers: {
            murf: { apiKey: { source: "env", provider: "default", id: "MURF_OPAQUE_FIXTURE" } },
          },
        },
      }),
    ).toThrow();
  });
  it("preserves the exact source voice catalog locally without HTTP", async () => {
    const fetch = vi.fn(() => {
      throw new Error("voice discovery must be local");
    });
    vi.stubGlobal("fetch", fetch);
    const voices = await provider.listVoices!({});
    expect(voices.map((voice) => voice.id)).toEqual([...MURF_VOICES]);
    expect(voices[0]).toEqual({
      id: "en-UK-hazel",
      name: "en-UK-hazel",
      locale: "en",
      gender: "neutral",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("merges per-call properties over configured source options through real guarded HTTP", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        expect(JSON.parse(init.body as string)).toEqual({
          text: "hello",
          voiceId: "en-US-cooper",
          modelVersion: "GEN1",
          rate: 2,
          pitch: 3,
          format: "FLAC",
        });
        return new Response(JSON.stringify({ audioFile: "https://audio.example.com/a.flac" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/flac" } });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await provider.synthesize({
      ...req,
      providerConfig: { apiKey: "fixture", properties: { rate: 1, pitch: 3 } },
      providerOverrides: {
        voiceId: "en-US-cooper",
        modelVersion: "GEN1",
        properties: { rate: 2, format: "FLAC" },
      },
    });
    expect(result).toEqual({
      audioBuffer: Buffer.from([1]),
      outputFormat: "FLAC",
      fileExtension: ".flac",
      voiceCompatible: false,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("fails before HTTP when no credential exists", async () => {
    vi.stubEnv("MURF_API_KEY", "");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(provider.synthesize({ ...req, providerConfig: {} })).rejects.toThrow(
      "MURF_API_KEY is not set",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
