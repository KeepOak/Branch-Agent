import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { ProviderHttpError } from "branch/plugin-sdk/provider-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceInfoQuestSeconds,
  resolveInfoQuestCredential,
  runInfoQuestFetch,
  runInfoQuestSearch,
} from "./client.js";
const offline = vi.hoisted(() => ({
  runtimeFetch: vi.fn<typeof fetch>(),
  dns: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("node:dns/promises", async (original) => ({
  ...(await original<typeof import("node:dns/promises")>()),
  lookup: offline.dns,
}));
vi.mock("../../../src/infra/net/undici-runtime.js", async (original) => {
  const actual = await original<typeof import("../../../src/infra/net/undici-runtime.js")>();
  return {
    ...actual,
    loadUndiciRuntimeDeps: () => ({
      ...actual.loadUndiciRuntimeDeps(),
      fetch: offline.runtimeFetch,
    }),
  };
});
const key = "synthetic-infoquest-key+/=short";
function config(
  mode: "webSearch" | "webFetch" | "imageSearch" = "webSearch",
  extra: Record<string, unknown> = {},
): BranchConfig {
  return {
    plugins: {
      entries: {
        infoquest: {
          enabled: true,
          config: {
            webSearch: { apiKey: key },
            webFetch: { apiKey: key },
            imageSearch: { apiKey: key },
            [mode]: { apiKey: key, ...extra },
          },
        },
      },
    },
  };
}
const fetchMock = vi.fn<typeof fetch>();
function answer(payload: unknown, status = 200, headers?: HeadersInit) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status, headers }));
}
function body() {
  return JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<string, unknown>;
}
function native(results: Record<string, unknown> = {}) {
  return { search_result: { results: [{ content: { results } }] } };
}
function empty() {
  answer({ search_result: { results: [] } });
}
beforeEach(() => {
  fetchMock.mockReset();
  offline.runtimeFetch.mockReset().mockImplementation(() => {
    throw new Error("FORBIDDEN native-network fallback");
  });
  offline.dns.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INFOQUEST_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("InfoQuest pinned native HTTP via actual host guards/readers", () => {
  it.each([
    ["10", 10],
    [" 10 ", 10],
    ["-1", -1],
    [10, 10],
    [10, 10],
    ["", -1],
    ["off", -1],
    [2.5, -1],
    [true, -1],
    [null, -1],
    [{ seconds: 10 }, -1],
    [Infinity, -1],
    ["1_000", 1000],
    ["3.5", -1],
  ])("coerces pinned timeout %j -> %i", (value, expected) => {
    expect(coerceInfoQuestSeconds(value)).toBe(expected);
  });
  it("sends pinned native search defaults, headers and organic/news citations", async () => {
    answer(
      native({
        organic: [
          { title: "Page", desc: "Description", url: "https://example.com/page" },
          { title: "Duplicate", url: "https://example.com/page" },
          { url: "javascript:alert(1)" },
        ],
        top_stories: {
          items: [
            {
              title: "News",
              source: "Publisher",
              time_frame: "2 hours ago",
              url: "https://example.com/news",
            },
            { title: "Already page", url: "https://example.com/page" },
            { url: "https://example.com/no-title" },
          ],
        },
      }),
    );
    const result = await runInfoQuestSearch({ cfg: config(), query: "query" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://search.infoquest.bytepluses.com/");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    expect(body()).toEqual({ format: "JSON", query: "query" });
    expect(result).toMatchObject({
      provider: "infoquest",
      count: 2,
      externalContent: { untrusted: true, wrapped: true },
    });
    const rows = result.results as Record<string, unknown>[];
    expect(rows[0]).toMatchObject({ type: "page", url: "https://example.com/page" });
    expect(rows[0]?.snippet).toBe(rows[0]?.desc);
    expect(rows[0]?.title).toContain("EXTERNAL_UNTRUSTED_CONTENT");
    expect(rows[1]).toMatchObject({ type: "news", url: "https://example.com/news" });
    expect(rows[1]?.source).toContain("Publisher");
    expect(rows[1]?.time_frame).toContain("2 hours ago");
  });
  it("keeps all returned rows without invented count/limit request parameters", async () => {
    answer(
      native({
        organic: Array.from({ length: 27 }, (_, i) => ({ url: `https://example.com/${i}` })),
      }),
    );
    expect((await runInfoQuestSearch({ cfg: config(), query: "x" })).count).toBe(27);
    expect(body()).toEqual({ format: "JSON", query: "x" });
  });
  it.each([-1, 0, -10, "off", null, true])(
    "omits disabled or invalid search filter %j",
    async (value) => {
      empty();
      await runInfoQuestSearch({
        cfg: config("webSearch", { search_time_range: value }),
        query: "x",
      });
      expect(body()).not.toHaveProperty("time_range");
    },
  );
  it("uses positive search range without inventing an image-style upper cap", async () => {
    empty();
    await runInfoQuestSearch({
      cfg: config("webSearch", { search_time_range: "400" }),
      query: "x",
      site: "example.com",
    });
    expect(body()).toEqual({ format: "JSON", query: "x", time_range: 400, site: "example.com" });
  });
  it("native image default is i and image URLs deduplicate independently", async () => {
    answer(
      native({
        images_results: [
          { original: "https://example.com/img.jpg", title: "Image" },
          { original: "https://example.com/img.jpg" },
          { title: "Missing" },
          { original: "file:///private" },
        ],
      }),
    );
    const result = await runInfoQuestSearch({ cfg: config(), query: "cat", images: true });
    expect(body()).toEqual({
      format: "JSON",
      query: "cat",
      search_type: "Images",
      image_size: "i",
    });
    expect(result).toMatchObject({ count: 1, search_type: "Images" });
    expect((result.results as Record<string, unknown>[])[0]).toMatchObject({
      image_url: "https://example.com/img.jpg",
    });
  });
  it.each([
    [1, "l"],
    [365, "m"],
    ["30", "i"],
  ])("sends valid image range %j/size %s", async (range, size) => {
    empty();
    await runInfoQuestSearch({
      cfg: config("imageSearch", { image_search_time_range: range, image_size: size }),
      query: "x",
      images: true,
      site: "flickr.com",
    });
    expect(body()).toMatchObject({
      time_range: Number(range),
      image_size: size,
      site: "flickr.com",
    });
  });
  it.each([-1, 0, 366, 400, 2.5, "off"])(
    "omits invalid image range %j and invalid size",
    async (range) => {
      empty();
      await runInfoQuestSearch({
        cfg: config("imageSearch", { image_search_time_range: range, image_size: "x" }),
        query: "x",
        images: true,
      });
      expect(body()).toEqual({ format: "JSON", query: "x", search_type: "Images" });
    },
  );
  it.each([false, true])(
    "preserves raw envelope fallback and wrong-format error (images %j)",
    async (images) => {
      answer({ type: "search", results: [] });
      expect((await runInfoQuestSearch({ cfg: config(), query: "x", images })).response).toContain(
        '"type":"search"',
      );
      answer({ content: "wrong" });
      await expect(runInfoQuestSearch({ cfg: config(), query: "x", images })).rejects.toThrow(
        "API return wrong format",
      );
    },
  );
  it.each([{ search_result: { results: null } }, { search_result: { results: [{}] } }, []])(
    "rejects malformed native envelope %j",
    async (payload) => {
      answer(payload);
      await expect(runInfoQuestSearch({ cfg: config(), query: "x" })).rejects.toThrow(
        /malformed|must be an array/,
      );
    },
  );
  it.each([{ reader_result: "<p>Content</p>" }, { content: "<p>Content</p>" }])(
    "native crawl content/reader fallback %j",
    async (payload) => {
      answer(payload);
      const result = await runInfoQuestFetch({ cfg: config(), url: "https://example.com" });
      expect(body()).toEqual({ url: "https://example.com", format: "HTML" });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://reader.infoquest.bytepluses.com/");
      expect(result.text).toContain("# Untitled\n\nContent");
    },
  );
  it("coerces all three remote crawl controls independently of local timeout", async () => {
    answer({ reader_result: "<p>Content</p>" });
    await runInfoQuestFetch({
      cfg: config("webFetch", { fetch_time: "5", timeout: "10", navigation_timeout: "30" }),
      url: "https://example.com",
    });
    expect(body()).toEqual({
      url: "https://example.com",
      format: "HTML",
      fetch_time: 5,
      timeout: 10,
      navi_timeout: 30,
    });
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it("handles raw HTML/plain text/unknown JSON and respects Unicode donor 4096 output", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<title>Article</title><p>" + "😀".repeat(5000) + "</p>"),
    );
    const result = await runInfoQuestFetch({ cfg: config(), url: "https://example.com" });
    expect(result.text).toContain("# Article\n\n");
    expect(result.text).toContain("😀".repeat(4085));
    expect(result.truncated).toBe(true);
    fetchMock.mockResolvedValueOnce(new Response("plain text"));
    expect(
      (await runInfoQuestFetch({ cfg: config(), url: "https://example.com", maxChars: 14 }))
        .truncated,
    ).toBe(true);
    answer({ unexpected: "raw JSON" });
    expect((await runInfoQuestFetch({ cfg: config(), url: "https://example.com" })).text).toContain(
      "raw JSON",
    );
  });
  it.each([
    "",
    "   ",
    JSON.stringify({ reader_result: "" }),
    JSON.stringify({ reader_result: 123 }),
  ])("rejects empty or nontext crawl response %j", async (text) => {
    fetchMock.mockResolvedValueOnce(new Response(text));
    await expect(runInfoQuestFetch({ cfg: config(), url: "https://example.com" })).rejects.toThrow(
      /no result|must be text/,
    );
  });
  it("retains donor crawl status exactly 200", async () => {
    answer({ reader_result: "wrong" }, 201);
    await expect(runInfoQuestFetch({ cfg: config(), url: "https://example.com" })).rejects.toThrow(
      "201",
    );
  });
  it("redacts active credential body/code/requestId before diagnostic truncation", async () => {
    answer({ error: { message: "x".repeat(495) + key, code: key } }, 401, { "x-request-id": key });
    const error = await runInfoQuestSearch({ cfg: config(), query: "x" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect(String(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain("synthetic-info");
  });
  it("omits credential-bearing parser causes, redacts encoded transport reflections", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"' + key));
    let error = await runInfoQuestSearch({ cfg: config(), query: "x" }).catch((e: unknown) => e);
    expect(String(error)).toContain("malformed JSON");
    expect((error as Error).cause).toBeUndefined();
    fetchMock.mockRejectedValueOnce(new Error("connect " + key + " " + encodeURIComponent(key)));
    error = await runInfoQuestSearch({ cfg: config(), query: "x" }).catch((e: unknown) => e);
    expect(String(error)).not.toContain(key);
    expect(String(error)).not.toContain(encodeURIComponent(key));
  });
  it("redacts truncated active credential prefix at host body boundary", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(16 * 1024 - 4) + key, { status: 503 }));
    const error = await runInfoQuestSearch({ cfg: config(), query: "x" }).catch((e: unknown) => e);
    expect(JSON.stringify(error)).not.toContain("synt");
  });
  it("enforces inherited 16 MiB cap and cancels the owned body", async () => {
    const cancel = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
          },
          cancel,
        }),
      ),
    );
    await expect(runInfoQuestSearch({ cfg: config(), query: "x" })).rejects.toThrow("exceeds");
    expect(cancel).toHaveBeenCalled();
  });
  it.each([false, true])(
    "local transport waits stop at 30 sec independently of remote settings (images %j)",
    async (images) => {
      vi.useFakeTimers();
      fetchMock.mockImplementationOnce(
        async (_input, init) =>
          await new Promise<Response>((_r, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("fixture timeout")), {
              once: true,
            });
          }),
      );
      const pending = runInfoQuestSearch({ cfg: config(), query: "x", images });
      const rejected = expect(pending).rejects.toThrow(/timeout|timed out/i);
      await vi.advanceTimersByTimeAsync(29999);
      expect(fetchMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
    },
  );
  it("keeps 30 sec deadline through crawl body after headers arrive", async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} })));
    const pending = runInfoQuestFetch({
      cfg: config("webFetch", { timeout: 900 }),
      url: "https://example.com",
    });
    const rejected = expect(pending).rejects.toThrow(/timeout|timed out/i);
    await vi.advanceTimersByTimeAsync(30000);
    await rejected;
    expect(body().timeout).toBe(900);
  });
  it("caller abort wins before request, after response and during body", async () => {
    const stopped = new AbortController();
    stopped.abort(new Error("superseded"));
    await expect(
      runInfoQuestSearch({ cfg: config(), query: "x", signal: stopped.signal }),
    ).rejects.toThrow("superseded");
    expect(fetchMock).not.toHaveBeenCalled();
    const active = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      active.abort(new Error("response retired"));
      return new Response("{}");
    });
    await expect(
      runInfoQuestSearch({ cfg: config(), query: "x", signal: active.signal }),
    ).rejects.toThrow("response retired");
    const streaming = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} })));
    const pending = runInfoQuestSearch({ cfg: config(), query: "x", signal: streaming.signal });
    const rejected = expect(pending).rejects.toThrow("stop body");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    streaming.abort(new Error("stop body"));
    await rejected;
  });
  it.each([
    "http://127.0.0.1",
    "http://169.254.169.254/latest",
    "file:///etc/passwd",
    "https://user:pass@example.com",
  ])("blocks hosted private target %s", async (url) => {
    await expect(runInfoQuestFetch({ cfg: config(), url })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("blocks private target/API DNS and cross-origin credential POST replay", async () => {
    offline.dns.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    await expect(
      runInfoQuestFetch({ cfg: config(), url: "https://example.com" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 307, headers: { location: "https://example.com/leak" } }),
    );
    await expect(runInfoQuestSearch({ cfg: config(), query: "x" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("actual pinned API DNS with real Undici constructors fails closed on private addresses", async () => {
    // An unrecognized ambient sentinel forces the genuine pinned-DNS path. The
    // runtime HTTP fixture remains a recognized vi.fn, and native networking is forbidden.
    vi.stubGlobal("fetch", () => {
      throw new Error("FORBIDDEN ambient native-network fallback");
    });
    offline.dns.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    await expect(runInfoQuestSearch({ cfg: config(), query: "x" })).rejects.toThrow(
      /private|blocked/i,
    );
    expect(offline.runtimeFetch).not.toHaveBeenCalled();
    offline.runtimeFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ search_result: { results: [] } })),
    );
    await expect(runInfoQuestSearch({ cfg: config(), query: "x" })).resolves.toMatchObject({
      count: 0,
    });
    expect(offline.dns).toHaveBeenCalledWith("search.infoquest.bytepluses.com", { all: true });
    expect(offline.runtimeFetch).toHaveBeenCalledOnce();
    expect(offline.runtimeFetch.mock.calls[0]?.[1]).toHaveProperty("dispatcher");
  });
  it("normalizes independent credentials and env refs; no key fails before network", async () => {
    vi.stubEnv("INFOQUEST_API_KEY", " env-key ");
    expect(resolveInfoQuestCredential(config(), "webSearch")).toBe(key);
    expect(resolveInfoQuestCredential(config("webSearch", { apiKey: "  " }), "webSearch")).toBe(
      "env-key",
    );
    vi.stubEnv("INFOQUEST_FIXTURE", "reference-key");
    expect(
      resolveInfoQuestCredential(
        config("webSearch", {
          apiKey: { source: "env", provider: "default", id: "INFOQUEST_FIXTURE" },
        }),
        "webSearch",
      ),
    ).toBe("reference-key");
    expect(
      resolveInfoQuestCredential(
        config("webSearch", { apiKey: { source: "exec", provider: "fixture", id: "x" } }),
        "webSearch",
      ),
    ).toBeUndefined();
    vi.stubEnv("INFOQUEST_API_KEY", "");
    await expect(runInfoQuestSearch({ query: "x" })).rejects.toThrow("not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
