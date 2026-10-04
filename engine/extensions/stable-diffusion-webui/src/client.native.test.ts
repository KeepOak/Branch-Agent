import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadUndiciModule } from "../../../src/infra/net/undici-dispatcher-options.js";
import {
  buildWebUiPayload,
  generateWebUiImage,
  resolveWebUiNetworkPolicy,
  WEBUI_DEFAULTS,
} from "./client.js";
const fixture = vi.hoisted(() => ({
  dns: {} as Record<string, string>,
  onLookup: undefined as ((hostname: string) => void) | undefined,
}));
vi.mock("node:dns/promises", async (original) => {
  const actual = await original<typeof import("node:dns/promises")>();
  return {
    ...actual,
    lookup: vi.fn(async (hostname: string) => {
      fixture.onLookup?.(hostname);
      const address = fixture.dns[hostname];
      if (!address) {
        throw new Error(`Unrecognized offline DNS fixture: ${hostname}`);
      }
      return [{ address, family: address.includes(":") ? 6 : 4 }];
    }),
  };
});
const PNG = Buffer.from("89504e470d0a1a0a", "hex");
const payload = (images = [PNG.toString("base64")]) => ({
  images,
  info: JSON.stringify({
    seed: 42,
    width: 1024,
    height: 1024,
    infotexts: ["prompt\nSteps: 22, Seed: 42"],
  }),
  parameters: WEBUI_DEFAULTS,
});
const request = (extra = {}) => ({
  baseUrl: "http://127.0.0.1:7860",
  prompt: "a detailed landscape",
  model: "configured",
  maxImageBytes: 1024,
  timeoutMs: 1000,
  ...extra,
});
function installTransport(fetch: typeof globalThis.fetch) {
  // An unmarked facade forces the real guard to resolve and validate DNS.
  // Both runtime transports are recognized synthetic fixtures, never native IO.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  vi.mocked(loadUndiciModule(["fetch"]).fetch).mockImplementation(
    (input, init) =>
      fetch(input as RequestInfo, init as RequestInit) as unknown as ReturnType<
        typeof import("undici").fetch
      >,
  );
}
function installHttp(body: unknown = payload(), status = 200) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith("/sdapi/v1/txt2img") || init?.method !== "POST") {
      throw new Error("Unrecognized offline HTTP fixture");
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  installTransport(fetch);
  return fetch;
}
beforeEach(() => {
  fixture.onLookup = undefined;
  fixture.dns = {
    "127.0.0.1": "127.0.0.1",
    localhost: "127.0.0.1",
    webui: "10.0.0.8",
    "public.example.com": "93.184.216.34",
    "rebind.example.com": "127.0.0.1",
    "private.example.com": "10.0.0.25",
    "metadata.example.com": "169.254.169.254",
  };
  for (const name of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "BRANCH_PROXY_ACTIVE",
    "BRANCH_DEBUG_PROXY_ENABLED",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.spyOn(loadUndiciModule(["fetch"]), "fetch").mockImplementation(() => {
    throw new Error("Native network forbidden");
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("Automatic1111 native client, real host guard and readers", () => {
  it("preserves exact pinned defaults and prompt whitespace", async () => {
    const fetch = installHttp();
    const result = await generateWebUiImage(
      request({ prompt: "hello\nworld", parameters: { negative_prompt: "blur" } }),
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      ...WEBUI_DEFAULTS,
      prompt: "hello\nworld",
      negative_prompt: "blur",
    });
    expect(result.images[0]?.buffer).toEqual(PNG);
    expect(result.images[0]?.metadata).toMatchObject({
      seed: 42,
      negative_prompt: "blur",
      info: "Steps: 22, Seed: 42",
    });
    expect(result.metadata?.generationInfo).toMatchObject({ seed: 42 });
  });
  it("preserves configured txt2img parameters, caller count and size", async () => {
    const fetch = installHttp(
      payload([PNG.toString("base64"), `data:image/png;base64,${PNG.toString("base64")}`]),
    );
    const result = await generateWebUiImage(
      request({
        count: 2,
        size: "512x768",
        parameters: { sampler_name: "Euler a", seed: 12, steps: 35, cfg_scale: 7, enable_hr: true },
      }),
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      width: 512,
      height: 768,
      batch_size: 2,
      sampler_name: "Euler a",
      seed: 12,
      steps: 35,
      enable_hr: true,
    });
    expect(result.images).toHaveLength(2);
  });
  it.each(["http://127.0.0.1:7860", "http://localhost:7860", "http://webui:7860"])(
    "allows configured local endpoint %s using real host policy",
    async (baseUrl) => {
      const fetch = installHttp();
      await expect(generateWebUiImage(request({ baseUrl }))).resolves.toHaveProperty("images");
      expect(fetch).toHaveBeenCalledOnce();
      expect(resolveWebUiNetworkPolicy(baseUrl)).not.toHaveProperty("allowPrivateNetwork", true);
    },
  );
  it("allows public configured endpoint with actual public DNS checks", async () => {
    installHttp();
    await expect(
      generateWebUiImage(request({ baseUrl: "https://public.example.com/prefix" })),
    ).resolves.toHaveProperty("images");
  });
  it("blocks public-looking FQDN DNS rebinding before HTTP", async () => {
    const fetch = installHttp();
    await expect(
      generateWebUiImage(request({ baseUrl: "http://rebind.example.com" })),
    ).rejects.toThrow(/private|blocked/i);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains explicit private FQDN origin opt-in", async () => {
    installHttp();
    await expect(
      generateWebUiImage(
        request({ baseUrl: "http://private.example.com", allowPrivateNetwork: true }),
      ),
    ).resolves.toHaveProperty("images");
  });
  it.each(["http://rebind.example.com", "http://metadata.example.com"])(
    "blocks rebinding to loopback/metadata even with private origin opt-in: %s",
    async (baseUrl) => {
      const fetch = installHttp();
      await expect(
        generateWebUiImage(request({ baseUrl, allowPrivateNetwork: true })),
      ).rejects.toThrow(/private|blocked/i);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("rejects redirects before credential/body replay", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 307, headers: { location: "http://169.254.169.254/latest" } }),
    );
    installTransport(fetch);
    await expect(generateWebUiImage(request())).rejects.toThrow(/redirect/i);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    "file:///tmp/image",
    "http://user:pass@localhost:7860",
    "http://localhost:7860?secret=x",
    "http://localhost:7860#x",
  ])("rejects invalid base URL %s without HTTP", async (baseUrl) => {
    const fetch = installHttp();
    await expect(generateWebUiImage(request({ baseUrl }))).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("redacts reflected active bearer and custom header secrets in HTTP errors", async () => {
    installHttp({ error: "echo synthetic-token-a and custom-secret-b" }, 401);
    const pending = generateWebUiImage(
      request({
        headers: { Authorization: "Bearer synthetic-token-a", "X-Session": "custom-secret-b" },
      }),
    );
    const error = await pending.catch((failure: unknown) => String(failure));
    expect(error).not.toContain("synthetic-token-a");
    expect(error).not.toContain("custom-secret-b");
    expect(error).toContain("401");
  });
  it("redacts reflected credentials in malformed JSON diagnostics", async () => {
    installTransport(
      vi.fn(
        async () =>
          new Response("invalid custom-secret-b", {
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    const e = await generateWebUiImage(
      request({ headers: { "X-Session": "custom-secret-b" } }),
    ).catch((error: unknown) => String(error));
    expect(e).not.toContain("custom-secret-b");
    expect(e).toMatch(/JSON/i);
  });
  it("redacts credential reflection in successful metadata", async () => {
    installHttp({
      ...payload(),
      info: JSON.stringify({ infotexts: ["custom-secret-b"], note: "custom-secret-b" }),
    });
    const r = await generateWebUiImage(request({ headers: { "X-Session": "custom-secret-b" } }));
    expect(JSON.stringify(r.metadata)).not.toContain("custom-secret-b");
    expect(JSON.stringify(r.images[0]?.metadata)).not.toContain("custom-secret-b");
  });
  it("preserves valid image when donor metadata parsing fails", async () => {
    installHttp({ ...payload(), info: "not json" });
    expect((await generateWebUiImage(request())).metadata?.generationInfo).toEqual({});
  });
  it.each([
    { images: [] },
    { images: ["invalid base64!"] },
    { images: [12] },
    { images: [PNG.toString("base64"), PNG.toString("base64")] },
  ])("rejects malformed image result %j", async (body) => {
    installHttp(body);
    await expect(generateWebUiImage(request())).rejects.toThrow(/invalid/i);
  });
  it("enforces decoded image and JSON envelope limits", async () => {
    installHttp(payload([Buffer.alloc(1025).toString("base64")]));
    await expect(generateWebUiImage(request())).rejects.toThrow(/oversized/i);
    installHttp({ padding: "x".repeat(1_050_000) });
    await expect(generateWebUiImage(request())).rejects.toThrow(/exceeds/i);
  });
  it("redacts transport errors reflecting active custom credentials", async () => {
    installTransport(
      vi.fn(async () => {
        throw new Error("transport reflected custom-secret-b");
      }),
    );
    const failure = await generateWebUiImage(
      request({ headers: { "X-Session": "custom-secret-b" } }),
    ).catch((error: unknown) => String(error));
    expect(failure).not.toContain("custom-secret-b");
    expect(failure).toContain("transport reflected");
  });
  it("propagates caller abort during actual DNS preflight before HTTP", async () => {
    const fetch = installHttp();
    const controller = new AbortController();
    const reason = new Error("DNS caller cancelled");
    fixture.onLookup = () => controller.abort(reason);
    await expect(generateWebUiImage(request({ signal: controller.signal }))).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("propagates already-aborted reason before DNS/HTTP", async () => {
    const fetch = installHttp();
    const controller = new AbortController();
    const reason = new Error("caller stopped");
    controller.abort(reason);
    await expect(generateWebUiImage(request({ signal: controller.signal }))).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("propagates pending HTTP abort through actual guard", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    installTransport(
      vi.fn(
        async (_input, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
            controller.abort(reason);
          }),
      ),
    );
    await expect(generateWebUiImage(request({ signal: controller.signal }))).rejects.toBe(reason);
  });
  it("propagates abort through a stalled response body reader", async () => {
    const controller = new AbortController();
    const reason = new Error("body cancelled");
    let started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    installTransport(
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode("{"));
                started();
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    const pending = generateWebUiImage(request({ signal: controller.signal }));
    await ready;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
  it("bounds pending requests by actual transport deadline", async () => {
    installTransport(
      vi.fn(
        async (_input, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      ),
    );
    await expect(generateWebUiImage(request({ timeoutMs: 10 }))).rejects.toThrow(
      /timed?\s*out|timeout|aborted/i,
    );
  });
  it.each([
    { count: 0 },
    { count: 5 },
    { parameters: { steps: 0 } },
    { parameters: { cfg_scale: Number.NaN } },
    { parameters: { negative_prompt: 2 } },
    { size: "bad" },
    { parameters: { n_iter: 2 } },
  ])("rejects invalid input %j", (extra) => {
    expect(() => buildWebUiPayload({ prompt: "x", ...extra })).toThrow();
  });
});
