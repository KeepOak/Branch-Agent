import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_AUDIO_BYTES } from "@branch/media-core/constants";
import { transcribeGladiaAudio, resolveGladiaListenOptions } from "./client.js";

const key = "fixture-gladia-key";
const request = {
  buffer: Buffer.from("offline audio bytes"),
  fileName: "recording.wav",
  mime: "audio/wav",
  apiKey: key,
  baseUrl: "http://127.0.0.1:45678/v2",
  timeoutMs: 2000,
  request: { allowPrivateNetwork: true },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const upload = { audio_url: "https://93.184.216.34/recording.wav" };
function fixture(responses: Response[], calls: { url: string; init: RequestInit }[] = []) {
  return {
    calls,
    fetchFn: (async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const response = responses.shift();
      assert.ok(response, "unexpected transport call");
      return response;
    }) as typeof fetch,
  };
}

test("actual guarded client preserves multipart, nested options, poll payload and exact transcript", async () => {
  const f = fixture([
    json(upload),
    json({ id: "job/id" }),
    json({
      status: "done",
      result: { transcription: { full_transcript: "  unchanged transcript  " } },
    }),
  ]);
  const options = {
    diarization: false,
    diarization_config: { min_speakers: 2, max_speakers: 4 },
    translation: true,
    translation_config: { model: "enhanced" as const, target_languages: ["fr", "de"] },
    detect_language: true,
    enable_code_switching: false,
  };
  assert.deepEqual(await transcribeGladiaAudio({ ...request, ...f, options }), {
    text: "  unchanged transcript  ",
    model: "gladia",
  });
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls[0]);
  assert.ok(f.calls[1]);
  assert.ok(f.calls[2]);
  assert.equal(f.calls[0].url, `${request.baseUrl}/upload/`);
  const form = f.calls[0].init.body as FormData;
  const audio = form.get("audio") as File;
  assert.equal(audio.name, request.fileName);
  assert.equal(audio.type, request.mime);
  assert.deepEqual(Buffer.from(await audio.arrayBuffer()), request.buffer);
  assert.equal(form.get("file"), null);
  assert.ok(f.calls[1]);
  assert.deepEqual(JSON.parse(String(f.calls[1].init.body)), {
    audio_url: upload.audio_url,
    ...options,
  });
  assert.equal(f.calls[2].url, `${request.baseUrl}/pre-recorded/job%2Fid`);
  for (const call of f.calls) {
    assert.equal(new Headers(call.init.headers).get("x-gladia-key"), key);
    assert.ok(call.init.signal instanceof AbortSignal);
  }
});

test("donor default diarization and host query option JSON reach the real job", async () => {
  const f = fixture([
    json(upload),
    json({ id: "job" }),
    json({ status: "done", result: { transcription: { full_transcript: "text" } } }),
  ]);
  await transcribeGladiaAudio({
    ...request,
    ...f,
    query: { translation: false, diarization_config: '{"number_of_speakers":2}' },
  });
  assert.ok(f.calls[1]);
  assert.deepEqual(JSON.parse(String(f.calls[1].init.body)), {
    audio_url: upload.audio_url,
    diarization: true,
    translation: false,
    diarization_config: { number_of_speakers: 2 },
  });
  assert.throws(() => resolveGladiaListenOptions({ diarization: "false" }), /must be a boolean/);
});

test("pending jobs complete after the donor one-second interval", async () => {
  const f = fixture([
    json(upload),
    json({ id: "job" }),
    json({ status: "processing" }),
    json({ status: "done", result: { transcription: { full_transcript: "after polling" } } }),
  ]);
  const started = Date.now();
  assert.deepEqual(await transcribeGladiaAudio({ ...request, ...f }), {
    text: "after polling",
    model: "gladia",
  });
  assert.ok(Date.now() - started >= 950);
  assert.equal(f.calls.length, 4);
});

test("unsafe upload URL is rejected before the credential-bearing job request", async () => {
  for (const audio_url of [
    "http://127.0.0.1/private",
    "http://169.254.169.254/meta",
    "file:///private",
    "https://user:pass@93.184.216.34/a",
  ]) {
    const f = fixture([json({ audio_url })]);
    await assert.rejects(
      transcribeGladiaAudio({ ...request, ...f }),
      /blocked|unsafe|private|Invalid/i,
    );
    assert.equal(f.calls.length, 1);
  }
});

test("upload, job and poll HTTP errors keep normalized status and redact actual header credentials", async () => {
  for (const [prefix, label] of [
    [[], "Upload failed"],
    [[json(upload)], "Transcription failed"],
    [[json(upload), json({ id: "job" })], "Polling failed"],
  ] as const) {
    const f = fixture([
      ...prefix,
      new Response(`reflected ${key}`, {
        status: 429,
        headers: { "x-request-id": "fixture-request" },
      }),
    ]);
    await assert.rejects(transcribeGladiaAudio({ ...request, ...f }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, new RegExp(label));
      assert.match(error.message, /429/);
      assert.ok(!JSON.stringify(error).includes(key));
      assert.ok(!error.message.includes(key));
      return true;
    });
  }
});

test("HTTP diagnostics redact the final caller header instead of the legacy API key", async () => {
  const activeKey = "fixture-final-caller-key";
  const f = fixture([
    new Response(`reflected ${activeKey}`, { status: 401, headers: { "x-request-id": activeKey } }),
  ]);
  await assert.rejects(
    transcribeGladiaAudio({ ...request, ...f, headers: { "x-gladia-key": activeKey } }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /401/);
      assert.ok(!error.message.includes(activeKey));
      assert.ok(!JSON.stringify(error).includes(activeKey));
      return true;
    },
  );
  assert.equal(new Headers(f.calls[0]?.init.headers).get("x-gladia-key"), activeKey);
});

test("invalid returned URL cannot retain a reflected request credential", async () => {
  const f = fixture([json({ audio_url: `invalid ${key}` })]);
  await assert.rejects(transcribeGladiaAudio({ ...request, ...f }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /Unsafe Gladia audio_url/);
    assert.ok(!JSON.stringify(error).includes(key));
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(f.calls.length, 1);
});

test("Gladia failed jobs and absent transcripts preserve donor errors", async () => {
  for (const [payload, message] of [
    [{ status: "error", error: `bad ${key}` }, /Gladia error: bad \*\*\*/],
    [{ status: "error" }, /Gladia error: Unknown/],
    [{ status: "done", result: {} }, /No transcript found/],
  ] as const) {
    const f = fixture([json(upload), json({ id: "job" }), json(payload)]);
    await assert.rejects(transcribeGladiaAudio({ ...request, ...f }), message);
  }
});

test("polling pending state respects the original host deadline instead of resetting it", async () => {
  const f = fixture([json(upload), json({ id: "job" }), json({ status: "processing" })]);
  const start = Date.now();
  await assert.rejects(
    transcribeGladiaAudio({ ...request, ...f, timeoutMs: 60 }),
    /timed out|abort/i,
  );
  assert.ok(Date.now() - start < 1000);
  assert.equal(f.calls.length, 3);
});

test("parent cancellation interrupts the one-second pending wait without another poll", async () => {
  const controller = new AbortController();
  const f = fixture([json(upload), json({ id: "job" }), json({ status: "processing" })]);
  const pending = transcribeGladiaAudio({ ...request, ...f, signal: controller.signal });
  setTimeout(() => controller.abort(new Error("fixture parent cancelled")), 30);
  await assert.rejects(pending, /abort|cancelled/i);
  assert.equal(f.calls.length, 3);
});

test("caller cancellation and deadline cover successful JSON and failed HTTP bodies", async () => {
  for (const status of [200, 500]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const f = fixture([new Response(body, { status })]);
    await assert.rejects(
      transcribeGladiaAudio({ ...request, ...f, timeoutMs: 40 }),
      /timed out|abort/i,
    );
    assert.equal(cancelled, true);
    assert.equal(f.calls.length, 1);
  }
});

test("host JSON byte cap cancels an oversized successful upload response", async () => {
  let cancelled = false;
  let chunk = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunk++ < 20) {
        controller.enqueue(new Uint8Array(1024 * 1024));
      } else {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
    },
  });
  const f = fixture([new Response(body)]);
  await assert.rejects(transcribeGladiaAudio({ ...request, ...f }), /JSON response exceeds/);
  assert.equal(cancelled, true);
  assert.equal(f.calls.length, 1);
});

test("parent abort cancels success and error readers with the original reason", async () => {
  for (const status of [200, 500]) {
    const controller = new AbortController();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const f = fixture([new Response(body, { status })]);
    const pending = transcribeGladiaAudio({ ...request, ...f, signal: controller.signal });
    setTimeout(() => controller.abort(new Error("fixture body cancelled")), 20);
    await assert.rejects(pending, /cancelled/);
    assert.equal(cancelled, true);
  }
});

test("resolved custom credential header and explicit no-auth policy retain host semantics", async () => {
  for (const auth of [
    { mode: "header" as const, headerName: "x-custom-secret", value: "fixture-custom-key" },
    undefined,
  ]) {
    const f = fixture([
      json(upload),
      json({ id: "job" }),
      json({
        status: "done",
        result: { transcription: { full_transcript: "configured transport" } },
      }),
    ]);
    const requestAuth = auth ? undefined : { kind: "none" as const, source: "explicit-fixture" };
    await transcribeGladiaAudio({
      ...request,
      ...f,
      apiKey: "",
      auth: requestAuth,
      request: { allowPrivateNetwork: true, auth },
    });
    const headers = new Headers(f.calls[0]?.init.headers);
    if (auth) {
      assert.equal(headers.get("x-custom-secret"), "fixture-custom-key");
    } else {
      assert.equal(headers.get("x-gladia-key"), null);
    }
  }
});

test("unapproved private base is rejected by the actual guard before fetch", async () => {
  const f = fixture([]);
  await assert.rejects(
    transcribeGladiaAudio({ ...request, ...f, request: undefined }),
    /blocked|private|Invalid/i,
  );
  assert.equal(f.calls.length, 0);
});

test("invalid JSON never retains an actual reflected credential or a parser cause", async () => {
  const f = fixture([new Response(`{"key":"${key}`)]);
  await assert.rejects(transcribeGladiaAudio({ ...request, ...f }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /malformed JSON/);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test("host media cap and donor input requirements reject before transport", async () => {
  const f = fixture([]);
  await assert.rejects(
    transcribeGladiaAudio({ ...request, ...f, buffer: Buffer.alloc(MAX_AUDIO_BYTES + 1) }),
    /exceeds/,
  );
  await assert.rejects(
    transcribeGladiaAudio({ ...request, ...f, fileName: "" }),
    /fileName is required/,
  );
  await assert.rejects(
    transcribeGladiaAudio({ ...request, ...f, mime: "" }),
    /mimeType is required/,
  );
  await assert.rejects(transcribeGladiaAudio({ ...request, ...f, timeoutMs: 0 }), /host timeoutMs/);
  await assert.rejects(transcribeGladiaAudio({ ...request, ...f, apiKey: "" }), /GLADIA_API_KEY/);
  assert.equal(f.calls.length, 0);
});
