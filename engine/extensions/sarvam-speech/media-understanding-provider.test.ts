import { afterEach, describe, expect, it, vi } from "vitest";
import { sarvamMediaUnderstandingProvider as provider } from "./media-understanding-provider.js";
afterEach(() => vi.unstubAllEnvs());
describe("Sarvam production transcription provider", () => {
  it("requires actual resolved config or env auth, without synthetic no-key enablement", () => {
    vi.stubEnv("SARVAM_API_KEY", "");
    expect(provider.resolveAuth?.({ provider: "sarvam-speech" })).toBeUndefined();
    vi.stubEnv("SARVAM_API_KEY", "fixture-env");
    expect(provider.resolveAuth?.({ provider: "sarvam-speech" })).toEqual({
      kind: "api-key",
      apiKey: "fixture-env",
      source: "env:SARVAM_API_KEY",
    });
  });
  it("registers audio and pinned default model", () => {
    expect(provider.capabilities).toEqual(["audio"]);
    expect(provider.defaultModels).toEqual({ audio: "saarika:v2.5" });
  });
  it("uses host auth plus all transcription options through actual client", async () => {
    const controller = new AbortController();
    const text = await provider.transcribeAudio?.({
      apiKey: "legacy",
      auth: { kind: "api-key", apiKey: "resolved-fixture" },
      baseUrl: "https://8.8.8.8",
      buffer: Buffer.from("audio"),
      fileName: "fixture.mp3",
      mime: "audio/mpeg",
      model: "saaras:v3",
      language: "hi-IN",
      query: { mode: "translate" },
      timeoutMs: 3000,
      signal: controller.signal,
      fetchFn: (async (_url, init) => {
        expect(new Headers(init?.headers).get("api-subscription-key")).toBe("resolved-fixture");
        expect((init!.body as FormData).get("model")).toBe("saaras:v3");
        expect((init!.body as FormData).get("mode")).toBe("translate");
        expect((init!.body as FormData).get("language_code")).toBe("hi-IN");
        return new Response(JSON.stringify({ transcript: "hello" }));
      }) as typeof fetch,
    });
    expect(text).toEqual({ text: "hello", model: "saaras:v3" });
  });
  it("propagates cancellation before upload through provider", async () => {
    const controller = new AbortController();
    controller.abort(new Error("canceled"));
    await expect(
      provider.transcribeAudio?.({
        apiKey: "fixture",
        baseUrl: "https://8.8.8.8",
        buffer: Buffer.from("audio"),
        fileName: "fixture.wav",
        timeoutMs: 3000,
        signal: controller.signal,
      }),
    ).rejects.toThrow("canceled");
  });
});
