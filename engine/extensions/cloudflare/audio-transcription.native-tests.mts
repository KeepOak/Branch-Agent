import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test, after } from "node:test";
import { fileURLToPath } from "node:url";

// The archived Mastra test uses live audio and credentials. These fixtures exercise
// its listen result through the actual adapter and plugin entry, replacing only
// host HTTP and unrelated R2 dependencies. No network or device is opened.
const globals = globalThis as typeof globalThis & { cloudflareTestHttp?: Record<string, Function> };
const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const hostHttp = asModule(
  [
    "assertOkOrThrowHttpError",
    "postJsonRequest",
    "readProviderJsonObjectResponse",
    "resolveProviderHttpRequestConfigWithOriginTrust",
    "requireTranscriptionText",
  ].map((name) => `export const ${name} = (...args) => globalThis.cloudflareTestHttp.${name}(...args);`).join("\n"),
);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "branch/plugin-sdk/provider-http") {
      return { url: hostHttp, shortCircuit: true };
    }
    if (specifier === "branch/plugin-sdk/plugin-entry") {
      return { url: asModule("export const definePluginEntry = (entry) => entry;"), shortCircuit: true };
    }
    if (specifier === "./api.js" && context.parentURL?.endsWith("/cloudflare/index.ts")) {
      return { url: asModule('export const r2StorageProvider = { id: "r2" };'), shortCircuit: true };
    }
    if (specifier.startsWith("./") && specifier.endsWith(".js") && context.parentURL?.includes("/cloudflare/")) {
      const url = new URL(specifier.replace(/\.js$/, ".ts"), context.parentURL);
      if (existsSync(url)) {
        return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
});
after(() => {
  hooks.deregister();
  delete globals.cloudflareTestHttp;
});
const { transcribeCloudflareAudio, DEFAULT_CLOUDFLARE_AUDIO_MODEL } = await import("./audio-transcription.ts");
const { cloudflareMediaUnderstandingProvider: provider } = await import("./media-understanding-provider.ts");
const { default: plugin } = await import("./index.ts");

function fixture(payload: unknown = { success: true, result: { text: " fixture transcript " } }, status = 200) {
  const calls: Array<Record<string, any>> = [];
  let releases = 0;
  let requestConfig: Record<string, any> = {};
  const fetchFn = async () => { throw new Error("Unexpected network fetch"); };
  globals.cloudflareTestHttp = {
    resolveProviderHttpRequestConfigWithOriginTrust(input: Record<string, any>) {
      requestConfig = input;
      return {
        baseUrl: (input.baseUrl ?? input.defaultBaseUrl).replace(/\/$/, ""),
        headers: new Headers({ ...input.defaultHeaders, ...input.headers }),
        allowPrivateNetwork: false,
        dispatcherPolicy: undefined,
      };
    },
    async postJsonRequest(input: Record<string, any>) {
      input.signal?.throwIfAborted();
      calls.push(input);
      return {
        response: new Response(JSON.stringify(payload), { status }),
        release: async () => { releases += 1; },
      };
    },
    async assertOkOrThrowHttpError(response: Response, message: string) {
      if (!response.ok) throw new Error(`${message}: HTTP ${response.status}`);
    },
    async readProviderJsonObjectResponse(response: Response) { return await response.json(); },
    requireTranscriptionText(text: string | undefined, message: string) {
      if (!text?.trim()) throw new Error(message);
      return text.trim();
    },
  };
  return {
    calls,
    get releases() { return releases; },
    get requestConfig() { return requestConfig; },
    request: {
      buffer: Buffer.from([0, 1, 2, 255]),
      fileName: "fixture.ogg",
      apiKey: "fixture-token",
      timeoutMs: 2000,
      query: { account_id: "fixture-account" },
      fetchFn: fetchFn as typeof fetch,
    },
  };
}

test("transcribes through the registered provider with pinned model and base64 payload", async () => {
  const f = fixture();
  assert.deepEqual(await provider.transcribeAudio!(f.request), {
    text: "fixture transcript", model: DEFAULT_CLOUDFLARE_AUDIO_MODEL,
  });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.url, "https://api.cloudflare.com/client/v4/accounts/fixture-account/ai/run/@cf/openai/whisper-large-v3-turbo");
  assert.deepEqual(f.calls[0]!.body, { audio: "AAEC/w==" });
  assert.equal(f.calls[0]!.headers.get("authorization"), "Bearer fixture-token");
  assert.equal(f.calls[0]!.headers.get("content-type"), "application/json");
  assert.equal(f.calls[0]!.fetchFn, f.request.fetchFn);
  assert.equal(f.calls[0]!.timeoutMs, 2000);
  assert.equal(f.releases, 1);
});

test("preserves configured model, endpoint, headers, account ID and host transport policy", async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const request = { auth: { kind: "header" as const, name: "x-fixture", value: "fixture" } };
  await transcribeCloudflareAudio({ ...f.request, model: " @cf/openai/whisper ", baseUrl: "https://fixture.invalid/v4/", headers: { "x-test": "yes" }, signal, request, query: { account_id: "a/b" } });
  assert.equal(f.calls[0]!.url, "https://fixture.invalid/v4/accounts/a%2Fb/ai/run/@cf/openai/whisper");
  assert.equal(f.calls[0]!.headers.get("x-test"), "yes");
  assert.equal(f.calls[0]!.signal, signal);
  assert.equal(f.requestConfig.request, request);
  assert.equal(f.requestConfig.provider, "cloudflare");
  assert.equal(f.requestConfig.transport, "media-understanding");
});

for (const payload of [{ success: false, result: { text: "ignore" } }, { result: {} }, { result: { text: 2 } }, { result: { text: " " } }, { result: [] }]) {
  test(`rejects unsuccessful or missing transcript and releases transport: ${JSON.stringify(payload)}`, async () => {
    const f = fixture(payload);
    await assert.rejects(transcribeCloudflareAudio(f.request), /failed|missing text/);
    assert.equal(f.releases, 1);
  });
}

test("releases the host transport after HTTP failure", async () => {
  const f = fixture({}, 503);
  await assert.rejects(transcribeCloudflareAudio(f.request), /HTTP 503/);
  assert.equal(f.releases, 1);
  assert.equal(f.calls.length, 1);
});

test("releases the host transport after malformed JSON", async () => {
  const f = fixture();
  globals.cloudflareTestHttp!.readProviderJsonObjectResponse = async () => { throw new SyntaxError("fixture invalid JSON"); };
  await assert.rejects(transcribeCloudflareAudio(f.request), /invalid JSON/);
  assert.equal(f.releases, 1);
});

test("forwards an already aborted request without uploading audio", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort(new Error("fixture cancelled"));
  await assert.rejects(transcribeCloudflareAudio({ ...f.request, signal: controller.signal }), /fixture cancelled/);
  assert.equal(f.calls.length, 0);
});

test("supports pinned account environment option, preserving configured account precedence", async () => {
  const previous = process.env.CLOUDFLARE_ACCOUNT_ID;
  try {
    process.env.CLOUDFLARE_ACCOUNT_ID = "fixture-env-account";
    const f = fixture();
    await transcribeCloudflareAudio({ ...f.request, query: undefined });
    assert.match(f.calls[0]!.url, /accounts\/fixture-env-account\/ai/);
    await transcribeCloudflareAudio(f.request);
    assert.match(f.calls[1]!.url, /accounts\/fixture-account\/ai/);
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    await assert.rejects(transcribeCloudflareAudio({ ...f.request, query: undefined }), /requires account_id/);
    assert.equal(f.calls.length, 2);
  } finally {
    if (previous === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
    else process.env.CLOUDFLARE_ACCOUNT_ID = previous;
  }
});

test("uses pinned token environment option while preserving configured key resolution", () => {
  const previous = process.env.CLOUDFLARE_AI_API_KEY;
  try {
    process.env.CLOUDFLARE_AI_API_KEY = " fixture-env-token ";
    assert.deepEqual(provider.resolveAuth!({ provider: "cloudflare" }), { kind: "api-key", apiKey: "fixture-env-token", source: "env: CLOUDFLARE_AI_API_KEY" });
    assert.equal(provider.resolveAuth!({ provider: "cloudflare", providerConfig: { baseUrl: "https://fixture.invalid", apiKey: { source: "env", provider: "default", id: "FIXTURE_KEY" }, models: [] } }), undefined);
    delete process.env.CLOUDFLARE_AI_API_KEY;
    assert.equal(provider.resolveAuth!({ provider: "cloudflare" }), undefined);
  } finally {
    if (previous === undefined) delete process.env.CLOUDFLARE_AI_API_KEY;
    else process.env.CLOUDFLARE_AI_API_KEY = previous;
  }
});

test("actual plugin registration and manifest expose audio alongside R2 storage", () => {
  const media: unknown[] = [];
  const storage: unknown[] = [];
  plugin.register!({ registerStorageProvider: (entry: unknown) => storage.push(entry), registerMediaUnderstandingProvider: (entry: unknown) => media.push(entry) } as never);
  assert.deepEqual(media, [provider]);
  assert.equal(storage.length, 1);
  assert.deepEqual(provider.capabilities, ["audio"]);
  assert.equal(provider.defaultModels?.audio, DEFAULT_CLOUDFLARE_AUDIO_MODEL);
  const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("./branch.plugin.json", import.meta.url)), "utf8"));
  assert.deepEqual(manifest.contracts.mediaUnderstandingProviders, [provider.id]);
  assert.deepEqual(manifest.contracts.storageProviders, ["r2"]);
});
