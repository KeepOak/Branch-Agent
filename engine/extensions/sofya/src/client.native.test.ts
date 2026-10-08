import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { ProviderHttpError } from "branch/plugin-sdk/provider-http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceContentLimit,
  coerceMaxResults,
  resolveSearchDepth,
  resolveSofyaCredential,
  runSofyaFetch,
  runSofyaSearch,
} from "./client.js";

const offline = vi.hoisted(() => ({
  dns: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("node:dns/promises", async (original) => ({
  ...(await original<typeof import("node:dns/promises")>()),
  lookup: offline.dns,
}));
// A recognized Vitest global fetch exercises the actual host guard. Native network
// fallback is a test failure even if the guard were to ignore that fake transport.
vi.mock("../../../src/infra/net/undici-runtime.js", async (original) => {
  const actual = await original<typeof import("../../../src/infra/net/undici-runtime.js")>();
  return {
    ...actual,
    loadUndiciRuntimeDeps: () => ({
      ...actual.loadUndiciRuntimeDeps(),
      fetch: vi.fn(() => {
        throw new Error("FORBIDDEN native-network fallback");
      }),
    }),
  };
});

const key = "synthetic-sofya-credential+/=short";
function config(search: Record<string, unknown> = {}): BranchConfig {
  return {
    plugins: {
      entries: {
        sofya: {
          enabled: true,
          config: { webSearch: { apiKey: key, ...search }, webFetch: { apiKey: key } },
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
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
}

describe("Sofya pinned HTTP contract through actual Branch guard", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    offline.dns.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SOFYA_API_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("ports pinned coercion and defaults", () => {
    for (const value of [null, undefined, 0, -3, "oops", Infinity, "1.5", ""]) {
      expect(coerceMaxResults(value)).toBe(5);
    }
    expect(coerceMaxResults("7")).toBe(7);
    expect(coerceMaxResults(999)).toBe(20);
    expect(coerceMaxResults(3.9)).toBe(3);
    expect(coerceContentLimit(0)).toBe(0);
    expect(coerceContentLimit("9")).toBe(9);
    expect(coerceContentLimit(-1)).toBe(2000);
    expect(coerceContentLimit(Infinity)).toBe(2000);
    expect(resolveSearchDepth(" SNIPPETS ")).toBe("snippets");
    expect(resolveSearchDepth("unsupported")).toBe("basic");
  });

  it("sends native POST, bearer header and donor defaults; returns wrapped full content and citations", async () => {
    answer({
      results: [
        {
          title: "Article",
          url: "https://example.com/article",
          content: "Full page",
          description: "Snippet",
        },
      ],
    });
    const result = await runSofyaSearch({ cfg: config(), query: "news" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://sofya.co/v1/search");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      redirect: "manual",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    });
    expect(body()).toEqual({ query: "news", max_results: 5, search_depth: "basic" });
    expect(result).toMatchObject({
      provider: "sofya",
      count: 1,
      total_results: 1,
      externalContent: { untrusted: true, wrapped: true },
    });
    const rows = result.results as { content: string; url: string }[];
    expect(rows[0]?.content).toContain("Full page");
    expect(rows[0]?.content).toContain("EXTERNAL_UNTRUSTED_CONTENT");
    expect(rows[0]?.content).not.toContain("Snippet");
    expect(rows[0]?.url).toBe("https://example.com/article");
  });

  it("caller count wins, filters malformed rows and forwards time-range freshness", async () => {
    answer({
      results: [
        null,
        1,
        { content: "a", url: "https://example.com/a" },
        { description: "b", url: "https://example.com/b" },
        { content: "c" },
      ],
    });
    const result = await runSofyaSearch({
      cfg: config({ maxResults: 1, searchDepth: "snippets" }),
      query: "x",
      count: 2,
      timeRange: "week",
    });
    expect(body()).toEqual({
      query: "x",
      max_results: 2,
      search_depth: "snippets",
      freshness: "week",
    });
    expect(result.count).toBe(2);
    expect((result.results as { content: string }[])[1]?.content).toContain("b");
  });

  it.each([
    [undefined, 2000],
    [12, 12],
    [0, 5000],
    [-1, 2000],
  ])("honors configured content limit %s without inventing a cap", async (limit, length) => {
    answer({ results: [{ content: "a".repeat(5000) }] });
    const result = await runSofyaSearch({
      cfg: config({ contentsMaxCharacters: limit }),
      query: "x",
    });
    expect((result.results as { content: string }[])[0]?.content).toContain("a".repeat(length));
    if (length < 5000) {
      expect((result.results as { content: string }[])[0]?.content).not.toContain(
        "a".repeat(length + 1),
      );
    }
  });

  it("preserves Unicode slicing, coerces numeric content, rejects unsafe citations", async () => {
    answer({
      results: [
        { content: "😀😀😀", url: "javascript:alert(1)" },
        { content: 123, url: "https://user:pass@example.com" },
      ],
    });
    const result = await runSofyaSearch({ cfg: config({ contentsMaxCharacters: 2 }), query: "x" });
    expect((result.results as { content: string; url: string }[])[0]).toMatchObject({ url: "" });
    expect((result.results as { content: string }[])[0]?.content).toContain("😀😀");
    expect((result.results as { content: string }[])[1]?.content).toContain("12");
  });

  it("fetches urls array and maps donor Markdown with 4096 content default", async () => {
    answer({ results: [{ title: "Page", content: "x".repeat(5000), success: true }] });
    const result = await runSofyaFetch({ cfg: config(), url: "https://example.com/page" });
    expect(offline.dns).toHaveBeenCalledWith("example.com", { all: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://sofya.co/v1/fetch");
    expect(body()).toEqual({ urls: ["https://example.com/page"] });
    expect(result.text).toContain("# Page\n\n");
    expect(result.text).toContain("x".repeat(4096));
    expect(result.text).not.toContain("x".repeat(4097));
    expect(result.truncated).toBe(true);
  });

  it("supports Untitled, non-string content and host maxChars", async () => {
    answer({ results: [{ content: 12345 }] });
    const result = await runSofyaFetch({ cfg: config(), url: "https://example.com", maxChars: 12 });
    expect(result.title).toContain("Untitled");
    expect(result.text).toContain("# Untitled");
    expect(result.truncated).toBe(true);
  });

  it.each([{}, { results: [] }, { results: [null] }])(
    "retains empty search behavior: %j",
    async (payload) => {
      answer(payload);
      await expect(runSofyaSearch({ cfg: config(), query: "x" })).resolves.toMatchObject({
        error: "No results found",
        count: 0,
      });
    },
  );
  it.each([{ results: {} }, []])("rejects malformed native envelope: %j", async (payload) => {
    answer(payload);
    await expect(runSofyaSearch({ cfg: config(), query: "x" })).rejects.toThrow(
      /response format|malformed JSON/,
    );
  });
  it.each([{ results: [] }, { results: [{ content: "" }] }])(
    "retains empty fetch failure: %j",
    async (payload) => {
      answer(payload);
      await expect(runSofyaFetch({ cfg: config(), url: "https://example.com" })).rejects.toThrow(
        /No results found|No content found/,
      );
    },
  );

  it("redacts reflected credential in HTTP body, code, request ID and metadata before truncation", async () => {
    answer({ error: { message: `rejected ${key}`, code: key } }, 401, { "x-request-id": key });
    const error = await runSofyaSearch({ cfg: config(), query: "x" }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).status).toBe(401);
    expect(String(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain(key);
  });
  it("omits malformed JSON parser causes containing active credentials", async () => {
    fetchMock.mockResolvedValueOnce(new Response(`{"${key}`));
    const error = await runSofyaSearch({ cfg: config(), query: "x" }).catch(
      (caught: unknown) => caught,
    );
    expect(String(error)).toContain("malformed JSON");
    expect(String(error)).not.toContain(key);
    expect((error as Error).cause).toBeUndefined();
  });
  it("redacts application-level fetch failures before donor preview truncation", async () => {
    answer({ results: [{ success: false, error: "x".repeat(495) + key }] });
    const error = await runSofyaFetch({ cfg: config(), url: "https://example.com" }).catch(
      (caught: unknown) => caught,
    );
    expect(String(error)).not.toContain(key);
    expect(String(error)).not.toContain("synthe");
  });
  it("redacts raw and encoded transport credential reflections", async () => {
    fetchMock.mockRejectedValueOnce(new Error(`connect failed ${key} ${encodeURIComponent(key)}`));
    const error = await runSofyaSearch({ cfg: config(), query: "x" }).catch(
      (caught: unknown) => caught,
    );
    expect(String(error)).toContain("connect failed");
    expect(String(error)).not.toContain(key);
    expect(String(error)).not.toContain(encodeURIComponent(key));
    expect((error as Error).cause).toBeUndefined();
  });
  it("redacts partial credentials at the host error body byte boundary", async () => {
    fetchMock.mockResolvedValueOnce(new Response("x".repeat(16 * 1024 - 4) + key, { status: 503 }));
    const error = await runSofyaSearch({ cfg: config(), query: "x" }).catch(
      (caught: unknown) => caught,
    );
    expect(String(error)).not.toContain(key);
    expect(JSON.stringify(error)).not.toContain("synt");
  });
  it("uses host byte cap for unbounded responses", async () => {
    const cancelled = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1));
          },
          cancel: cancelled,
        }),
      ),
    );
    await expect(runSofyaSearch({ cfg: config(), query: "x" })).rejects.toThrow("exceeds");
    expect(cancelled).toHaveBeenCalled();
  });
  it("preserves caller abort precedence before side effects and after provider completion", async () => {
    const controller = new AbortController();
    controller.abort(new Error("superseded"));
    await expect(
      runSofyaSearch({ cfg: config(), query: "x", signal: controller.signal }),
    ).rejects.toThrow("superseded");
    expect(fetchMock).not.toHaveBeenCalled();
    const active = new AbortController();
    fetchMock.mockImplementationOnce(async () => {
      active.abort(new Error("cancel during response"));
      return new Response('{"results":[]}');
    });
    await expect(
      runSofyaSearch({ cfg: config(), query: "x", signal: active.signal }),
    ).rejects.toThrow("cancel during response");
  });
  it("keeps caller abort active while streaming a response body", async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start() {} })));
    const pending = runSofyaSearch({ cfg: config(), query: "x", signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.abort(new Error("stop body"));
    await expect(pending).rejects.toThrow("stop body");
  });
  it("retains donor 60-second transport deadline", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementationOnce(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      );
      const pending = runSofyaSearch({ cfg: config(), query: "x" });
      const rejected = expect(pending).rejects.toThrow(/timeout|timed out/i);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(fetchMock).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    "http://127.0.0.1",
    "http://169.254.169.254/latest",
    "file:///etc/passwd",
    "https://user:pass@example.com",
  ])("blocks unsafe hosted fetch target %s before HTTP", async (url) => {
    await expect(runSofyaFetch({ cfg: config(), url })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("blocks DNS rebinding and private redirects through actual host policies", async () => {
    offline.dns.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    await expect(runSofyaFetch({ cfg: config(), url: "https://example.com" })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/internal" } }),
    );
    await expect(runSofyaSearch({ cfg: config(), query: "x" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("uses config per tool, environment fallback and env-backed secret references", async () => {
    vi.stubEnv("SOFYA_API_KEY", " env-key ");
    expect(resolveSofyaCredential(config(), "webSearch")).toBe(key);
    expect(resolveSofyaCredential(config({ apiKey: "  " }), "webSearch")).toBe("env-key");
    vi.stubEnv("SOFYA_FIXTURE", "reference-key");
    expect(
      resolveSofyaCredential(
        config({ apiKey: { source: "env", provider: "default", id: "SOFYA_FIXTURE" } }),
        "webSearch",
      ),
    ).toBe("reference-key");
    vi.stubEnv("SOFYA_API_KEY", "");
    await expect(runSofyaSearch({ query: "x" })).rejects.toThrow("SOFYA_API_KEY is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
