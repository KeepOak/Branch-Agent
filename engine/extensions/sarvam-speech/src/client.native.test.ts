import { describe, expect, it } from "vitest";
import { buildSarvamSpeechPayload, sarvamTextToSpeech, sarvamSpeechToText } from "./client.js";
const base = { apiKey: "fixture-sarvam-key", baseUrl: "https://8.8.8.8", timeoutMs: 3000 };
const audio = Buffer.from("offline-audio");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function transport(
  fn: (url: string, init: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return ((url, init) => Promise.resolve(fn(String(url), init ?? {}))) as typeof fetch;
}
describe("Sarvam actual guarded HTTP client offline", () => {
  it("preserves exact v3 defaults and authentication with first audio decoding", async () => {
    const fetchFn = transport((url, init) => {
      expect(url).toBe("https://8.8.8.8/text-to-speech");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("api-subscription-key")).toBe(base.apiKey);
      expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
      expect(JSON.parse(String(init.body))).toEqual({
        text: "Hello",
        target_language_code: "en-IN",
        model: "bulbul:v3",
        speaker: "shubh",
      });
      return json({ audios: [audio.toString("base64"), "ignored"] });
    });
    expect(await sarvamTextToSpeech({ ...base, text: "Hello", fetchFn })).toEqual(audio);
  });
  it("preserves v2 model-dependent default speaker and all pinned v2 properties", () => {
    expect(
      buildSarvamSpeechPayload({
        text: "hi",
        model: "bulbul:v2",
        language: "hi-IN",
        properties: {
          pace: 0.3,
          pitch: -0.75,
          loudness: 3,
          enable_preprocessing: false,
          speech_sample_rate: 8000,
          output_audio_codec: "mulaw",
        },
      }),
    ).toEqual({
      text: "hi",
      target_language_code: "hi-IN",
      model: "bulbul:v2",
      speaker: "anushka",
      pace: 0.3,
      pitch: -0.75,
      loudness: 3,
      enable_preprocessing: false,
      speech_sample_rate: 8000,
      output_audio_codec: "mulaw",
    });
  });
  it("preserves v3-beta compatibility and exact property values", () => {
    expect(
      buildSarvamSpeechPayload({
        text: "hi",
        model: "bulbul:v3-beta",
        speaker: "ritu",
        properties: {
          pace: 2,
          temperature: 0.01,
          dict_id: "dictionary",
          output_audio_codec: "flac",
          speech_sample_rate: 48000,
        },
      }),
    ).toMatchObject({ speaker: "ritu", pace: 2, temperature: 0.01, dict_id: "dictionary" });
  });
  it.each([
    { model: "bulbul:v2", speaker: "shubh" },
    { model: "bulbul:v3", speaker: "anushka" },
    { model: "bulbul:v1" },
    { language: "fr-FR" },
    { properties: { pace: 0.49 } },
    { properties: { temperature: Number.NaN } },
    { properties: { pitch: 0 } },
    { model: "bulbul:v2", properties: { temperature: 0.6 } },
    { properties: { speech_sample_rate: 1234 } },
    { properties: { output_audio_codec: "ogg" } },
  ])("rejects incompatible models, voices and pinned ranges before HTTP: %j", async (values) => {
    let calls = 0;
    await expect(
      sarvamTextToSpeech({
        ...base,
        text: "hi",
        ...values,
        fetchFn: transport(() => {
          calls++;
          return json({});
        }),
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it.each([{}, { audios: [] }, { audios: ["!"] }, { audios: [44] }])(
    "rejects absent/malformed base64 audio %j",
    async (result) => {
      await expect(
        sarvamTextToSpeech({ ...base, text: "hi", fetchFn: transport(() => json(result)) }),
      ).rejects.toThrow();
    },
  );
  it("caps decoded audio before allocation", async () => {
    await expect(
      sarvamTextToSpeech({
        ...base,
        text: "hi",
        maxBytes: 2,
        fetchFn: transport(() => json({ audios: [audio.toString("base64")] })),
      }),
    ).rejects.toThrow("exceeds 2 bytes");
  });
  it("preserves default STT multipart fields and WAV mime", async () => {
    const fetchFn = transport(async (url, init) => {
      expect(url).toBe("https://8.8.8.8/speech-to-text");
      const form = init.body as FormData;
      expect(form.get("model")).toBe("saarika:v2.5");
      expect(form.get("language_code")).toBe("unknown");
      expect(form.has("mode")).toBe(false);
      const file = form.get("file") as Blob;
      expect(file.type).toBe("audio/wav");
      expect(Buffer.from(await file.arrayBuffer())).toEqual(audio);
      expect(new Headers(init.headers).has("content-type")).toBe(false);
      return json({ transcript: "नमस्ते" });
    });
    expect(await sarvamSpeechToText({ ...base, buffer: audio, fetchFn })).toEqual({
      text: "नमस्ते",
      model: "saarika:v2.5",
    });
  });
  it("preserves saaras mode/language and mp3 request", async () => {
    const fetchFn = transport((_url, init) => {
      const form = init.body as FormData;
      expect(form.get("model")).toBe("saaras:v3");
      expect(form.get("language_code")).toBe("ta-IN");
      expect(form.get("mode")).toBe("codemix");
      expect((form.get("file") as Blob).type).toBe("audio/mpeg");
      return json({ transcript: "hello" });
    });
    await sarvamSpeechToText({
      ...base,
      buffer: audio,
      model: "saaras:v3",
      languageCode: "ta-IN",
      filetype: "mp3",
      mode: "codemix",
      fetchFn,
    });
  });
  it("preserves donor mode forwarding for saarika", async () => {
    await sarvamSpeechToText({
      ...base,
      buffer: audio,
      mode: "translate",
      fetchFn: transport((_url, init) => {
        expect((init.body as FormData).get("mode")).toBe("translate");
        return json({ transcript: "hello" });
      }),
    });
  });
  it("fails STT HTTP errors and redacts actual overridden credentials and request ID", async () => {
    const secret = "fixture-override-secret";
    await expect(
      sarvamSpeechToText({
        ...base,
        buffer: audio,
        headers: { "api-subscription-key": secret },
        fetchFn: transport(
          () =>
            new Response(JSON.stringify({ message: secret }), {
              status: 401,
              headers: { "x-request-id": secret },
            }),
        ),
      }),
    ).rejects.toThrow(/Sarvam AI API Error.*401/);
    try {
      await sarvamTextToSpeech({
        ...base,
        text: "hi",
        headers: { "api-subscription-key": secret },
        fetchFn: transport(() => json({ message: secret }, 403)),
      });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
  it("does not retain reflected credential in malformed JSON causes", async () => {
    try {
      await sarvamTextToSpeech({
        ...base,
        text: "hi",
        fetchFn: transport(() => new Response(base.apiKey)),
      });
      throw new Error("Expected malformed JSON rejection");
    } catch (error) {
      expect(String(error)).toContain("malformed JSON");
      expect((error as Error).cause).toBeUndefined();
    }
  });
  it.each([200, 401])(
    "aborts stalled success/error body reads after headers (%i)",
    async (status) => {
      const controller = new AbortController();
      let canceled = false;
      const task = sarvamTextToSpeech({
        ...base,
        text: "hi",
        signal: controller.signal,
        fetchFn: transport(() => {
          queueMicrotask(() => controller.abort(new Error("caller canceled")));
          return new Response(
            new ReadableStream({
              cancel() {
                canceled = true;
              },
            }),
            { status },
          );
        }),
      });
      await expect(task).rejects.toThrow("caller canceled");
      expect(canceled).toBe(true);
    },
  );
  it.each([200, 401])("shares absolute host deadline with response body (%i)", async (status) => {
    await expect(
      sarvamTextToSpeech({
        ...base,
        timeoutMs: 25,
        text: "hi",
        fetchFn: transport(() => new Response(new ReadableStream(), { status })),
      }),
    ).rejects.toThrow(/timed out|Timeout/);
  });
  it("rejects already canceled requests before transport", async () => {
    const controller = new AbortController();
    controller.abort(new Error("already canceled"));
    let called = false;
    await expect(
      sarvamSpeechToText({
        ...base,
        buffer: audio,
        signal: controller.signal,
        fetchFn: transport(() => {
          called = true;
          return json({});
        }),
      }),
    ).rejects.toThrow("already canceled");
    expect(called).toBe(false);
  });
  it("rejects unsafe base URL before credential-bearing transport", async () => {
    let called = false;
    await expect(
      sarvamTextToSpeech({
        ...base,
        baseUrl: "http://127.0.0.1",
        text: "hi",
        fetchFn: transport(() => {
          called = true;
          return json({});
        }),
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  });
  it.each([{ model: "saarika:v1" }, { languageCode: "en" }, { mode: "fake" }, { filetype: "aac" }])(
    "rejects invalid STT options %j",
    async (values) => {
      await expect(
        sarvamSpeechToText({
          ...base,
          buffer: audio,
          ...values,
          fetchFn: transport(() => json({})),
        }),
      ).rejects.toThrow();
    },
  );
  it("rejects oversized upload and missing transcript", async () => {
    await expect(
      sarvamSpeechToText({
        ...base,
        buffer: audio,
        maxBytes: 1,
        fetchFn: transport(() => json({})),
      }),
    ).rejects.toThrow("upload exceeds");
    await expect(
      sarvamSpeechToText({
        ...base,
        buffer: audio,
        fetchFn: transport(() => json({ text: "wrong field" })),
      }),
    ).rejects.toThrow("missing transcript");
  });
});
