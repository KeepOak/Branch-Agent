import assert from "node:assert/strict";
import { installPinnedHostnameTestHooks } from "branch/plugin-sdk/test-media-understanding";
import { test, afterEach, vi } from "vitest";

// Controlled DNS and fetch exercise the actual SSRF transport without provider network calls.
installPinnedHostnameTestHooks();
const { DEFAULT_PLAYAI_VOICE, openPlayAIStream, playAITTS, PLAYAI_STREAM_URL } =
  await import("./client.js");
const params = {
  text: "Hello",
  apiKey: "fixture-api-secret",
  userId: "fixture-user-secret",
  timeoutMs: 1000,
  maxBytes: 100,
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function fixture(response: Response) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return response;
    }),
  );
  return requests;
}
const audio = () =>
  new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
test("posts pinned donor body, default Angelo and dual credentials through actual guard", async () => {
  const calls = fixture(audio());
  assert.deepEqual((await playAITTS(params)).audioBuffer, Buffer.from([1, 2, 3]));
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, PLAYAI_STREAM_URL);
  assert.equal(calls[0]!.init?.method, "POST");
  const headers = new Headers(calls[0]!.init?.headers);
  assert.equal(headers.get("authorization"), `Bearer ${params.apiKey}`);
  assert.equal(headers.get("x-user-id"), params.userId);
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    text: "Hello",
    voice: DEFAULT_PLAYAI_VOICE,
    model: "PlayDialog",
  });
  assert.ok(calls[0]!.init?.signal);
});
test("preserves explicit mini model and speaker without adding unsupported options", async () => {
  const calls = fixture(audio());
  await playAITTS({ ...params, model: "Play3.0-mini", voice: "custom-s3-voice" });
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), {
    text: "Hello",
    voice: "custom-s3-voice",
    model: "Play3.0-mini",
  });
});
test("normalizes provider errors and scrubs reflected api key and user ID", async () => {
  fixture(
    new Response(JSON.stringify({ message: `${params.apiKey} ${params.userId} denied` }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await assert.rejects(playAITTS(params), (error: Error) => {
    assert.match(error.message, /PlayAI API Error/);
    assert.match(error.message, /denied/);
    assert.ok(!error.message.includes(params.apiKey));
    assert.ok(!error.message.includes(params.userId));
    return true;
  });
});
test("caps accumulated audio bytes", async () => {
  fixture(audio());
  await assert.rejects(playAITTS({ ...params, maxBytes: 2 }), /exceeds 2 bytes/);
});
test("rejects empty and nonaudio response bodies", async () => {
  fixture(new Response(null, { headers: { "Content-Type": "audio/mpeg" } }));
  await assert.rejects(playAITTS(params), /No response body/);
  fixture(new Response('{"error":"oops"}', { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(playAITTS(params), /malformed audio/);
});
test("streams first audio chunk before synthesis finishes and cancellation releases reader", async () => {
  let canceled = false;
  fixture(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([1]));
        },
        cancel() {
          canceled = true;
        },
      }),
      { headers: { "Content-Type": "audio/mpeg" } },
    ),
  );
  const stream = await openPlayAIStream(params);
  const reader = stream.audioStream.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1]));
  await reader.cancel();
  await stream.release();
  assert.equal(canceled, true);
});
test("caller abort and absolute deadline interrupt stalled audio bodies", async () => {
  const stalled = () =>
    new Response(new ReadableStream<Uint8Array>(), { headers: { "Content-Type": "audio/mpeg" } });
  fixture(stalled());
  const abort = new AbortController();
  const pending = playAITTS({ ...params, signal: abort.signal });
  setTimeout(() => abort.abort(new Error("fixture stop")), 15);
  await assert.rejects(pending, /fixture stop/);
  fixture(stalled());
  const deadline = playAITTS({ ...params, timeoutMs: 20 });
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(deadline, /timeout|aborted/i);
  } finally {
    clearTimeout(keepAlive);
  }
});
test("rejects missing credentials and invalid models before transport", async () => {
  const calls = fixture(audio());
  await assert.rejects(playAITTS({ ...params, apiKey: " " }), /key missing/);
  await assert.rejects(playAITTS({ ...params, userId: " " }), /userId missing/);
  await assert.rejects(playAITTS({ ...params, model: "pretend" }), /Invalid PlayAI/);
  assert.equal(calls.length, 0);
});

test("preserves provider audio MIME instead of adding a request format option", async () => {
  const calls = fixture(
    new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/wav" } }),
  );
  const result = await playAITTS(params);
  assert.equal(result.outputFormat, "wav");
  assert.equal(result.fileExtension, ".wav");
  assert.equal(result.voiceCompatible, false);
  assert.deepEqual(Object.keys(JSON.parse(String(calls[0]!.init?.body))).toSorted(), [
    "model",
    "text",
    "voice",
  ]);
});

test("same absolute deadline bounds stalled provider error bodies", async () => {
  fixture(
    new Response(new ReadableStream<Uint8Array>(), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    }),
  );
  await assert.rejects(playAITTS({ ...params, timeoutMs: 20 }), /timeout|aborted/i);
});
