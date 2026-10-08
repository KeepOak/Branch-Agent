import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMediaUnderstandingRegistry,
  getMediaUnderstandingProvider,
} from "../../src/media-understanding/provider-registry.js";
import { createPluginRecord } from "../../src/plugins/loader-records.js";
import { createTestPluginRegistry } from "../../src/plugins/registry-runtime.test-helpers.js";
import plugin from "./index.js";

test("actual registered provider transcribes through host media registry with resolved request auth", async () => {
  const builder = createTestPluginRegistry();
  const record = createPluginRecord({
    id: "gladia",
    source: "offline-fixture",
    origin: "bundled",
    enabled: true,
    configSchema: true,
  });
  builder.registry.plugins.push(record);
  await plugin.register(builder.createApi(record, { config: {} }));
  const registered = builder.registry.mediaUnderstandingProviders[0];
  assert.ok(registered);
  const registry = buildMediaUnderstandingRegistry(undefined, {}, [registered.provider]);
  const provider = getMediaUnderstandingProvider("gladia", registry);
  assert.ok(provider?.transcribeAudio);
  const calls: { url: string; init: RequestInit }[] = [];
  const responses = [
    { audio_url: "https://93.184.216.34/a.wav" },
    { id: "fixture" },
    { status: "done", result: { transcription: { full_transcript: "host boundary proof" } } },
  ];
  const result = await provider.transcribeAudio({
    buffer: Buffer.from("offline fixture"),
    fileName: "a.wav",
    mime: "audio/wav",
    apiKey: "legacy-ignored",
    auth: { kind: "api-key", apiKey: "actual-fixture-key" },
    baseUrl: "http://127.0.0.1:45678/v2",
    timeoutMs: 2000,
    request: { allowPrivateNetwork: true },
    query: { diarization: false, detect_language: true },
    fetchFn: (async (url: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(responses.shift()));
    }) as typeof fetch,
  });
  assert.deepEqual(result, { text: "host boundary proof", model: "gladia" });
  assert.equal(calls.length, 3);
  assert.equal(new Headers(calls[0]?.init.headers).get("x-gladia-key"), "actual-fixture-key");
  assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), {
    audio_url: "https://93.184.216.34/a.wav",
    diarization: false,
    detect_language: true,
  });
});
