import { installPinnedHostnameTestHooks } from "branch/plugin-sdk/test-media-understanding";
import { afterEach, describe, expect, it, vi } from "vitest";
import { synthesizeMurf } from "./client.js";

const params = {
  text: "hello",
  apiKey: "murf-fixture-credential",
  timeoutMs: 3000,
  maxBytes: 1024,
};
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const audio = () =>
  new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
const generated = () => json({ audioFile: "https://audio.example.com/result.mp3" });
function stubSequence(...responses: Response[]) {
  const fetch = vi.fn(async () => {
    const response = responses.shift();
    if (!response) {
      throw new Error("Unexpected fixture request");
    }
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("Murf source client through actual host guards", () => {
  installPinnedHostnameTestHooks();
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps donor defaults and downloads without forwarding the API credential", async () => {
    const fetch = stubSequence(generated(), audio());
    const result = await synthesizeMurf(params);
    expect(result).toEqual({
      audioBuffer: Buffer.from([1, 2, 3]),
      outputFormat: "MP3",
      fileExtension: ".mp3",
      voiceCompatible: false,
    });
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toBe("https://api.murf.ai/v1/speech/generate");
    expect(calls[0]![1].method).toBe("POST");
    expect(new Headers(calls[0]![1].headers).get("api-key")).toBe(params.apiKey);
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({
      voiceId: "en-UK-hazel",
      text: "hello",
      modelVersion: "GEN2",
    });
    expect(new Headers(calls[1]![1]?.headers).get("api-key")).toBeNull();
    expect(calls[0]![1].signal).toBeDefined();
    expect(calls[1]![1].signal).toBeDefined();
  });

  it("retains every donor output property", async () => {
    const fetch = stubSequence(generated(), audio());
    const properties = {
      style: "Conversational",
      rate: -5,
      pitch: 2,
      sampleRate: 48000 as const,
      format: "WAV" as const,
      channelType: "STEREO" as const,
      pronunciationDictionary: { Branch: "branch" },
      encodeAsBase64: true,
      variation: 1,
      audioDuration: 5,
      multiNativeLocale: "en-US",
    };
    const result = await synthesizeMurf({
      ...params,
      modelVersion: "GEN1",
      voiceId: "en-US-cooper",
      properties,
    });
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(JSON.parse(calls[0]![1].body as string)).toEqual({
      voiceId: "en-US-cooper",
      text: "hello",
      modelVersion: "GEN1",
      ...properties,
    });
    expect(result.fileExtension).toBe(".wav");
  });

  it.each([408, 413, 429, 500, 502, 503, 504])("retries donor status %i", async (status) => {
    const fetch = stubSequence(json({ message: "retry" }, status), generated(), audio());
    await synthesizeMurf(params);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("stops after the donor's two retries and redacts reflected credentials", async () => {
    const fetch = stubSequence(
      ...Array.from({ length: 3 }, () => json({ message: `bad ${params.apiKey}` }, 503)),
    );
    await expect(synthesizeMurf(params)).rejects.toThrow(/Murf API Error/);
    expect(fetch).toHaveBeenCalledTimes(3);
    // A fresh failure also checks the actual error body's active credential scrubber.
    stubSequence(json({ message: `bad ${params.apiKey}` }, 400));
    const error = await synthesizeMurf(params).catch((caught: unknown) => caught);
    expect(String(error)).not.toContain(params.apiKey);
    expect(String(error)).toContain("***");
  });

  it("scrubs credential reflections from every retained HTTP diagnostic", async () => {
    stubSequence(
      new Response(JSON.stringify({ message: `bad ${params.apiKey}` }), {
        status: 400,
        headers: { "Content-Type": "application/json", "x-request-id": params.apiKey },
      }),
    );
    const error = await synthesizeMurf(params).catch((caught: unknown) => caught);
    const retained = Object.fromEntries(
      Object.getOwnPropertyNames(error).map((key) => [key, Reflect.get(error as object, key)]),
    );
    expect(retained.status).toBe(400);
    expect(JSON.stringify(retained)).not.toContain(params.apiKey);
  });

  it("cancels before any HTTP request when the caller is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = stubSequence();
    await expect(synthesizeMurf({ ...params, signal: controller.signal })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels a stalled generation JSON body through the real host reader", async () => {
    const controller = new AbortController();
    const fetch = stubSequence(
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const pending = synthesizeMurf({ ...params, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-source statuses", async () => {
    const fetch = stubSequence(json({ message: "unauthorized" }, 401));
    await expect(synthesizeMurf(params)).rejects.toThrow(/unauthorized/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds retry delay with the same operation deadline", async () => {
    const fetch = stubSequence(json({ message: "retry" }, 429));
    await expect(synthesizeMurf({ ...params, timeoutMs: 30 })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels during retry delay before making another request", async () => {
    const controller = new AbortController();
    const fetch = stubSequence(json({ message: "retry" }, 429));
    const pending = synthesizeMurf({ ...params, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels a stalled generated audio body", async () => {
    const controller = new AbortController();
    const fetch = stubSequence(
      generated(),
      new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );
    const pending = synthesizeMurf({ ...params, signal: controller.signal });
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the host configured byte cap", async () => {
    stubSequence(generated(), audio());
    await expect(synthesizeMurf({ ...params, maxBytes: 2 })).rejects.toThrow(/exceeds 2 bytes/);
  });

  it.each([
    "https://127.0.0.1/result.mp3",
    "https://169.254.169.254/result.mp3",
    "http://audio.example.com/a",
    "https://user:secret@audio.example.com/a",
  ])("guards returned URL %s before asset fetch", async (url) => {
    const fetch = stubSequence(json({ audioFile: url }));
    await expect(synthesizeMurf(params)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps credential-bearing POST bodies from crossing origins on redirect", async () => {
    const fetch = stubSequence(
      new Response(null, {
        status: 307,
        headers: { Location: "https://other.example.com/generate" },
      }),
    );
    await expect(synthesizeMurf(params)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("drops parser causes that could contain active credentials", async () => {
    stubSequence(
      new Response(`{invalid:${params.apiKey}`, {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const error = await synthesizeMurf(params).catch((caught: unknown) => caught);
    expect(String(error)).toMatch(/malformed JSON/);
    expect(String(error)).not.toContain(params.apiKey);
    expect((error as Error).cause).toBeUndefined();
  });
});
