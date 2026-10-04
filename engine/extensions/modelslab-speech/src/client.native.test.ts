// Offline cases derived from VOICE-0033 donor index.test.ts SHA256
// 1e7d7448cecc4aff822ea4954fd4934bf7f2033298cf040f3959910db003d46c.
import { describe, expect, it, vi } from "vitest";
import {
  MODELSLAB_TTS_URL,
  MODELSLAB_FETCH_URL,
  MODELSLAB_VOICES,
  modelsLabTTS,
} from "./client.js";
const lookupFn = async () => [{ address: "93.184.216.34", family: 4 }];
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const audio = () =>
  new Response(Buffer.from("fixture-audio"), { headers: { "content-type": "audio/mpeg" } });
const params = {
  text: "Hello world",
  apiKey: "fixture-secret-value",
  maxBytes: 1024,
  timeoutMs: 15_000,
};
function fixture(...responses: Response[]) {
  const fetchFn = vi.fn<typeof fetch>();
  for (const response of responses) {
    fetchFn.mockResolvedValueOnce(response);
  }
  return { fetchFn, lookupFn };
}

describe("ModelsLab guarded offline client", () => {
  it("requires the key and retains the donor six-voice catalog", async () => {
    await expect(modelsLabTTS({ ...params, apiKey: "" })).rejects.toThrow(
      "MODELSLAB_API_KEY is not set",
    );
    expect(MODELSLAB_VOICES.map((v) => v.voiceId)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
  it("sends key in JSON with exact donor defaults, then downloads without credentials", async () => {
    const transport = fixture(
      json({ status: "success", output: "https://cdn.modelslab.com/audio.mp3" }),
      audio(),
    );
    const result = await modelsLabTTS(params, transport);
    expect(result).toEqual({
      audioBuffer: Buffer.from("fixture-audio"),
      outputFormat: "audio/mpeg",
      fileExtension: ".mp3",
      voiceCompatible: false,
    });
    expect(transport.fetchFn.mock.calls[0]?.[0]).toBe(MODELSLAB_TTS_URL);
    const init = transport.fetchFn.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      key: params.apiKey,
      prompt: params.text,
      language: "english",
      voice_id: 1,
      speed: 1,
    });
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
    expect(transport.fetchFn.mock.calls[1]?.[1]?.body).toBeUndefined();
    expect([...new Headers(transport.fetchFn.mock.calls[1]?.[1]?.headers)]).toEqual([]);
  });
  it.each([
    ["alloy", 1],
    ["echo", 2],
    ["fable", 3],
    ["onyx", 4],
    ["nova", 5],
    ["shimmer", 6],
    ["10", 10],
    ["unknown", 1],
    ["", 1],
    [" nova ", 1],
  ] as const)(
    "retains %s mapping, arbitrary numeric donor IDs and explicit language/speed",
    async (speaker, voiceId) => {
      const transport = fixture(
        json({ status: "success", output: "https://cdn.modelslab.com/audio.mp3" }),
        audio(),
      );
      await modelsLabTTS({ ...params, speaker, language: "french", speed: 0.75 }, transport);
      expect(JSON.parse(String(transport.fetchFn.mock.calls[0]?.[1]?.body))).toEqual({
        key: params.apiKey,
        prompt: params.text,
        language: "french",
        voice_id: voiceId,
        speed: 0.75,
      });
    },
  );
  it("waits before polling, preserves key-only poll POST, and encodes request ID as one path segment", async () => {
    const transport = fixture(
      json({ status: "processing", request_id: "req/123" }),
      json({ status: "success", output: "https://cdn.modelslab.com/audio.mp3" }),
      audio(),
    );
    const start = Date.now();
    await modelsLabTTS(params, transport);
    expect(Date.now() - start).toBeGreaterThanOrEqual(4_900);
    expect(transport.fetchFn.mock.calls[1]?.[0]).toBe(`${MODELSLAB_FETCH_URL}req%2F123`);
    expect(transport.fetchFn.mock.calls[1]?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(transport.fetchFn.mock.calls[1]?.[1]?.body))).toEqual({
      key: params.apiKey,
    });
  });
  it.each([
    [{ status: "processing" }, "without request_id"],
    [{ status: "success" }, "no audio URL"],
    [{ status: "other" }, "invalid status"],
    [[], "malformed JSON"],
    [{ status: "error", message: "Invalid API key" }, "Invalid API key"],
  ])(
    "preserves provider failure semantics and rejects malformed payloads %j",
    async (payload, message) => {
      await expect(modelsLabTTS(params, fixture(json(payload)))).rejects.toThrow(String(message));
    },
  );
  it("scrubs body-auth reflection from HTTP diagnostics and provider errors", async () => {
    for (const response of [
      json({ message: params.apiKey }, 401),
      json({ status: "error", message: params.apiKey }),
    ]) {
      const transport = fixture(response);
      const error = await modelsLabTTS(params, transport).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(`${error.message}${JSON.stringify(error)}`).not.toContain(params.apiKey);
    }
  });
  it("scrubs encoded body-auth reflections before HTTP metadata is retained", async () => {
    const key = "opaque body/key?credential=%+value";
    const encoded = encodeURIComponent(key);
    const error = await modelsLabTTS(
      { ...params, apiKey: key },
      fixture(
        new Response(encoded, {
          status: 401,
          headers: { "x-request-id": encoded },
        }),
      ),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain(encoded);
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain(key);
  });
  it("scrubs a body credential cut by the host HTTP error prefix limit", async () => {
    const key = "opaque-secret-prefix-" + "a".repeat(17_000);
    const error = await modelsLabTTS(
      { ...params, apiKey: key },
      fixture(json({ message: key }, 401)),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain("opaque-secret-prefix-");
  });
  it("omits parser causes for malformed key-reflecting JSON", async () => {
    const error = await modelsLabTTS(
      params,
      fixture(new Response(params.apiKey, { headers: { "content-type": "application/json" } })),
    ).catch((e) => e);
    expect(error.message).toContain("malformed JSON");
    expect(error.cause).toBeUndefined();
  });
  it("blocks a private output URL before download", async () => {
    const transport = fixture(json({ status: "success", output: "https://127.0.0.1/audio" }));
    await expect(modelsLabTTS(params, transport)).rejects.toThrow();
    expect(transport.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("rejects cross-origin POST redirects before replaying body credentials", async () => {
    const transport = fixture(
      new Response(null, { status: 307, headers: { location: "https://evil.example/steal" } }),
    );
    await expect(modelsLabTTS(params, transport)).rejects.toThrow();
    expect(transport.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("rejects non-HTTPS output and non-audio error payloads", async () => {
    const transport = fixture(
      json({ status: "success", output: "http://cdn.modelslab.com/audio.mp3" }),
    );
    await expect(modelsLabTTS(params, transport)).rejects.toThrow();
    expect(transport.fetchFn).toHaveBeenCalledTimes(1);
    await expect(
      modelsLabTTS(
        params,
        fixture(
          json({ status: "success", output: "https://cdn.modelslab.com/audio.mp3" }),
          json({ error: "bad" }),
        ),
      ),
    ).rejects.toThrow();
  });
  it("enforces the caller byte cap", async () => {
    const transport = fixture(
      json({ status: "success", output: "https://cdn.modelslab.com/audio.mp3" }),
      audio(),
    );
    await expect(modelsLabTTS({ ...params, maxBytes: 3 }, transport)).rejects.toThrow(
      "exceeds 3 bytes",
    );
  });
  it("cancels the donor poll wait without issuing the poll", async () => {
    const controller = new AbortController();
    const transport = fixture(json({ status: "processing", request_id: 123 }));
    const result = modelsLabTTS({ ...params, signal: controller.signal }, transport);
    const rejection = expect(result).rejects.toThrow("parent cancelled");
    await vi.waitFor(() => expect(transport.fetchFn).toHaveBeenCalledTimes(1));
    controller.abort(new Error("parent cancelled"));
    await rejection;
    expect(transport.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("exhausts one total deadline during polling", async () => {
    const transport = fixture(json({ status: "processing", request_id: 123 }));
    await expect(modelsLabTTS({ ...params, timeoutMs: 80 }, transport)).rejects.toThrow();
    expect(transport.fetchFn).toHaveBeenCalledTimes(1);
  });
  it("rejects an already-cancelled request without touching transport", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled before synthesis"));
    const transport = fixture();
    await expect(modelsLabTTS({ ...params, signal: controller.signal }, transport)).rejects.toThrow(
      "cancelled before synthesis",
    );
    expect(transport.fetchFn).not.toHaveBeenCalled();
  });
  it("does not reset the deadline when audio download begins", async () => {
    const transport = fixture(
      json({ status: "success", output: "https://cdn.modelslab.com/audio.mp3" }),
      new Response(new ReadableStream({ start() {} }), {
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    await expect(modelsLabTTS({ ...params, timeoutMs: 200 }, transport)).rejects.toThrow();
    expect(transport.fetchFn).toHaveBeenCalledTimes(2);
  });
  it("enforces the deadline while a success or error body stalls", async () => {
    for (const status of [200, 401]) {
      const transport = fixture(
        new Response(new ReadableStream({ start() {} }), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
      await expect(modelsLabTTS({ ...params, timeoutMs: 80 }, transport)).rejects.toThrow();
    }
  });
});
