import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSarvamSpeechProvider } from "./speech-provider.js";
const provider = buildSarvamSpeechProvider();
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("Sarvam production speech provider", () => {
  it("has unchanged no-key configuration behavior and supports explicit/env credentials", () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    expect(provider.isConfigured({ providerConfig: {}, timeoutMs: 100 })).toBe(false);
    expect(provider.isConfigured({ providerConfig: { apiKey: "fixture" }, timeoutMs: 100 })).toBe(
      true,
    );
    vi.stubEnv("SARVAM_API_KEY", "fixture-env");
    expect(provider.isConfigured({ providerConfig: {}, timeoutMs: 100 })).toBe(true);
  });
  it("normalizes host-resolved secret config and refuses unresolved references", () => {
    expect(
      provider.resolveConfig?.({
        cfg: {},
        timeoutMs: 100,
        rawConfig: { providers: { sarvam: { apiKey: "fixture", model: "bulbul:v2" } } },
      }),
    ).toMatchObject({ apiKey: "fixture", model: "bulbul:v2" });
    expect(() =>
      provider.resolveConfig?.({
        cfg: {},
        timeoutMs: 100,
        rawConfig: {
          providers: {
            "sarvam-speech": {
              apiKey: { source: "env", provider: "default", id: "SARVAM_API_KEY" },
            },
          },
        },
      }),
    ).toThrow();
  });
  it("preserves inherited Talk key unless Talk supplies a resolved replacement", () => {
    expect(
      provider.resolveTalkConfig?.({
        cfg: {},
        timeoutMs: 100,
        baseTtsConfig: {
          providers: { "sarvam-speech": { apiKey: "base-fixture", model: "bulbul:v2" } },
        },
        talkProviderConfig: { voiceId: "arya" },
      }),
    ).toMatchObject({ apiKey: "base-fixture", model: "bulbul:v2", speaker: "arya" });
  });
  it("lists the exact pinned 46 voices without a paid request", async () => {
    const voices = await provider.listVoices?.({});
    expect(voices).toHaveLength(46);
    expect(voices?.[0]?.id).toBe("shubh");
    expect(voices?.[39]?.id).toBe("anushka");
  });
  it("actual synthesize honors model overrides and host media byte cap", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init: RequestInit) => {
        expect(JSON.parse(String(init.body))).toMatchObject({
          model: "bulbul:v2",
          speaker: "anushka",
          pace: 0.3,
          output_audio_codec: "mp3",
        });
        return new Response(JSON.stringify({ audios: [Buffer.from("audio").toString("base64")] }));
      }),
    );
    const result = await provider.synthesize({
      text: "hi",
      cfg: {},
      providerConfig: { apiKey: "fixture", baseUrl: "https://8.8.8.8" },
      providerOverrides: { model: "bulbul:v2", pace: 0.3, output_audio_codec: "mp3" },
      target: "audio-file",
      timeoutMs: 3000,
    });
    expect(result).toEqual({
      audioBuffer: Buffer.from("audio"),
      outputFormat: "mp3",
      fileExtension: ".mp3",
      voiceCompatible: false,
    });
    await expect(
      provider.synthesize({
        text: "hi",
        cfg: { agents: { defaults: { mediaMaxMb: 1 / 1024 / 1024 } } },
        providerConfig: {
          apiKey: "fixture",
          baseUrl: "https://8.8.8.8",
          model: "bulbul:v2",
          pace: 0.3,
          output_audio_codec: "mp3",
        },
        target: "audio-file",
        timeoutMs: 3000,
      }),
    ).rejects.toThrow("exceeds 1 bytes");
  });
  it("forwards additive host cancellation through actual synthesize body consumption", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        queueMicrotask(() => controller.abort(new Error("host caller canceled")));
        return new Response(new ReadableStream());
      }),
    );
    const request = {
      text: "hello",
      cfg: {},
      providerConfig: { apiKey: "fixture", baseUrl: "https://8.8.8.8" },
      target: "audio-file" as const,
      timeoutMs: 3000,
      signal: controller.signal,
    };
    await expect(provider.synthesize(request)).rejects.toThrow("host caller canceled");
  });
});
