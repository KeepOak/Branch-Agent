import assert from "node:assert/strict";
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-entry";
import type { SpeechProviderPlugin } from "branch/plugin-sdk/speech-provider";
import { installPinnedHostnameTestHooks } from "branch/plugin-sdk/test-media-understanding";
import { afterEach, test, vi } from "vitest";

installPinnedHostnameTestHooks();
const plugin = (await import("./index.js")).default;
let provider: SpeechProviderPlugin;
await plugin.register({
  registerSpeechProvider: (value) => {
    if (typeof value === "function") {
      throw new Error("PlayAI entry must register its concrete speech provider");
    }
    provider = value;
  },
} as BranchPluginApi);
const savedApiKey = process.env.PLAYAI_API_KEY;
const savedUserId = process.env.PLAYAI_USER_ID;
delete process.env.PLAYAI_API_KEY;
delete process.env.PLAYAI_USER_ID;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.PLAYAI_API_KEY;
  delete process.env.PLAYAI_USER_ID;
});
process.on("exit", () => {
  if (savedApiKey !== undefined) {
    process.env.PLAYAI_API_KEY = savedApiKey;
  }
  if (savedUserId !== undefined) {
    process.env.PLAYAI_USER_ID = savedUserId;
  }
});
const cfg = { apiKey: "fixture-key", userId: "fixture-user" };
function fixtureFetch(implementation: typeof fetch) {
  const fetchMock = vi.fn(implementation);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

test("readiness requires both explicit credentials, including environment fallback", () => {
  for (const providerConfig of [
    {},
    { apiKey: "key" },
    { userId: "user" },
    { apiKey: " ", userId: " " },
  ]) {
    assert.equal(provider.isConfigured({ providerConfig, timeoutMs: 1000 }), false);
  }
  assert.equal(provider.isConfigured({ providerConfig: cfg, timeoutMs: 1000 }), true);
  process.env.PLAYAI_API_KEY = "fixture-env-key";
  process.env.PLAYAI_USER_ID = "fixture-env-user";
  assert.equal(provider.isConfigured({ providerConfig: {}, timeoutMs: 1000 }), true);
});
test("config preserves donor defaults, aliases and secret resolution paths", () => {
  const normalized = provider.resolveConfig!({
    cfg: {},
    rawConfig: { providers: { playai: cfg } },
    timeoutMs: 1000,
  });
  assert.equal(normalized.apiKey, cfg.apiKey);
  assert.equal(normalized.userId, cfg.userId);
  assert.equal(normalized.model, "PlayDialog");
  assert.equal(
    normalized.voice,
    "s3://voice-cloning-zero-shot/baf1ef41-36b6-428c-9bdf-50ba54682bd8/original/manifest.json",
  );
  assert.throws(
    () =>
      provider.resolveConfig!({
        cfg: {},
        rawConfig: {
          providers: {
            "playai-speech": {
              apiKey: { source: "env", provider: "default", id: "PLAYAI_API_KEY" },
            },
          },
        },
        timeoutMs: 1000,
      }),
    /tts.providers.playai-speech.apiKey/,
  );
});
test("registered provider uses exact overrides and truthful MP3 result through actual host boundary", async () => {
  let body: unknown;
  fixtureFetch(async (_url: unknown, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
  });
  const result = await provider.synthesize({
    cfg: {},
    providerConfig: cfg,
    target: "audio-file",
    text: "hello",
    timeoutMs: 1000,
    providerOverrides: { model: "Play3.0-mini", voice: "explicit-voice" },
  });
  assert.deepEqual(body, { text: "hello", model: "Play3.0-mini", voice: "explicit-voice" });
  assert.deepEqual(result, {
    audioBuffer: Buffer.from([1, 2, 3]),
    outputFormat: "mp3",
    fileExtension: ".mp3",
    voiceCompatible: false,
  });
  const streamed = await provider.streamSynthesize!({
    cfg: {},
    providerConfig: cfg,
    target: "voice-note",
    text: "hello",
    timeoutMs: 1000,
  });
  assert.equal(streamed.voiceCompatible, false);
  assert.equal(streamed.fileExtension, ".mp3");
  assert.deepEqual(
    Buffer.from(await new Response(streamed.audioStream).arrayBuffer()),
    Buffer.from([1, 2, 3]),
  );
  await streamed.release!();
});
test("registered synthesis enforces host configured byte cap", async () => {
  fixtureFetch(
    async () => new Response(new Uint8Array(2000), { headers: { "Content-Type": "audio/mpeg" } }),
  );
  await assert.rejects(
    provider.synthesize({
      cfg: { agents: { defaults: { mediaMaxMb: 0.001 } } },
      providerConfig: cfg,
      target: "audio-file",
      text: "hello",
      timeoutMs: 1000,
    }),
    /exceeds/,
  );
});
test("missing userId fails before any HTTP request", async () => {
  const fetch = fixtureFetch(async () => {
    throw new Error("unexpected transport");
  });
  await assert.rejects(
    provider.synthesize({
      cfg: {},
      providerConfig: { apiKey: "key" },
      target: "audio-file",
      text: "hi",
      timeoutMs: 1000,
    }),
    /userId missing/,
  );
  assert.equal(fetch.mock.calls.length, 0);
});
test("static voices preserve catalog and inherited Talk voice/model controls", async () => {
  const voices = await provider.listVoices!({ timeoutMs: 1000 });
  assert.equal(voices.length, 15);
  assert.equal(voices[0]!.name, "Angelo");
  const config = provider.resolveTalkConfig!({
    cfg: {},
    baseTtsConfig: { providers: { playai: cfg } },
    talkProviderConfig: { voiceId: "talk-voice", modelId: "Play3.0-mini", userId: "talk-user" },
    timeoutMs: 1000,
  });
  assert.equal(config.voice, "talk-voice");
  assert.equal(config.model, "Play3.0-mini");
  assert.equal(config.apiKey, "fixture-key");
  assert.equal(config.userId, "talk-user");
});

test("registered provider forwards supplied parent signal to actual stalled HTTP body", async () => {
  fixtureFetch(
    async () =>
      new Response(new ReadableStream<Uint8Array>(), { headers: { "Content-Type": "audio/mpeg" } }),
  );
  const controller = new AbortController();
  const request = {
    cfg: {},
    providerConfig: cfg,
    target: "audio-file" as const,
    text: "hello",
    timeoutMs: 1000,
    signal: controller.signal,
  };
  const pending = provider.synthesize(request);
  setTimeout(() => controller.abort(new Error("parent canceled")), 20);
  await assert.rejects(pending, /parent canceled/);
});
