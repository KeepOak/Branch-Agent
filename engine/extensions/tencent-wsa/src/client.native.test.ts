import { lookup } from "node:dns/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { runTencentWsaSearch } from "./client.js";

vi.mock("node:dns/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:dns/promises")>()),
  lookup: vi.fn(async () => {
    throw new Error("Unexpected DNS request");
  }),
}));

const fakeKey = "fixture/tencent+key?private";
function config(webSearch: Record<string, unknown> = {}): BranchConfig {
  return {
    plugins: {
      entries: { "tencent-wsa": { config: { webSearch: { apiKey: fakeKey, ...webSearch } } } },
    },
  };
}
function respond(value: unknown) {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeEach(() => {
  vi.mocked(lookup).mockReset().mockRejectedValue(new Error("Unexpected DNS request"));
  vi.stubEnv("TENCENTCLOUD_WSA_APIKEY", "");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected network request");
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Tencent SearchPro actual client with offline transport", () => {
  it("posts native SearchPro Bearer envelope, leaves natural mode/count defaults implicit and maps pages", async () => {
    const fetch = respond({
      Response: {
        RequestId: "fixture-request",
        Pages: [
          "bad JSON",
          "[]",
          4,
          JSON.stringify({
            title: "Title",
            url: "https://example.com/a",
            passage: "Passage",
            date: "2026-10-03",
            score: 0.9,
            site: "Example",
          }),
          { title: 42, url: "javascript:alert(1)", content: true },
        ],
      },
    });
    const result = await runTencentWsaSearch({ config: config(), query: "  query  " });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.wsa.cloud.tencent.com/SearchPro");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${fakeKey}`);
    expect(new Headers(init.headers).get("content-type")).toBe("application/json; charset=utf-8");
    expect(JSON.parse(init.body as string)).toEqual({ Query: "query" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toMatchObject({
      provider: "tencent-wsa",
      count: 2,
      total_results: 2,
      externalContent: { untrusted: true, wrapped: true },
    });
    expect(result.request_id).toContain("fixture-request");
    expect(result.results).toEqual([
      expect.objectContaining({
        title: expect.stringContaining("Title"),
        url: "https://example.com/a",
        snippet: expect.stringContaining("Passage"),
        score: 0.9,
      }),
      expect.objectContaining({ title: "", url: "", snippet: "" }),
    ]);
  });

  it("configuration overrides count, preserves mode and requests the next supported Cnt batch", async () => {
    const fetch = respond({
      Response: {
        Pages: Array.from({ length: 55 }, (_, i) => ({
          title: `Page ${i}`,
          url: `https://example.com/${i}`,
        })),
      },
    });
    const result = await runTencentWsaSearch({
      config: config({ maxResults: " 11 ", mode: 0 }),
      query: "q",
      count: 1,
    });
    const init = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(JSON.parse(init?.body as string)).toEqual({ Query: "q", Mode: 0, Cnt: 20 });
    expect(result.count).toBe(11);
  });

  it("does not request Cnt for at most 10; uses passage when content is empty", async () => {
    const fetch = respond({ Response: { Pages: [{ content: "", passage: "Fallback" }] } });
    const result = await runTencentWsaSearch({
      config: config({ maxResults: 10, mode: 2 }),
      query: "q",
    });
    expect(JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      Query: "q",
      Mode: 2,
    });
    expect(result.results).toEqual([
      expect.objectContaining({ snippet: expect.stringContaining("Fallback") }),
    ]);
  });

  it("applies the default result cap and donor maximum on the actual client", async () => {
    const pages = Array.from({ length: 60 }, (_, i) => ({ title: `Page ${i}` }));
    respond({ Response: { Pages: pages } });
    expect((await runTencentWsaSearch({ config: config(), query: "q" })).count).toBe(5);
    const fetch = respond({ Response: { Pages: pages } });
    expect(
      (await runTencentWsaSearch({ config: config({ maxResults: 500 }), query: "q" })).count,
    ).toBe(50);
    expect(JSON.parse((fetch.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      Query: "q",
      Cnt: 50,
    });
  });

  it("prefers configured credentials over environment fallback", async () => {
    vi.stubEnv("TENCENTCLOUD_WSA_APIKEY", "environment-fake-key");
    const fetch = respond({ Response: { Pages: [{}] } });
    await runTencentWsaSearch({ config: config(), query: "q" });
    expect(new Headers((fetch.mock.calls[0]![1] as RequestInit).headers).get("authorization")).toBe(
      `Bearer ${fakeKey}`,
    );
  });

  it("returns donor no-results and malformed Pages/envelope errors", async () => {
    for (const [payload, message] of [
      [{ Response: {} }, "No results found"],
      [{ Response: { Pages: "invalid" } }, "unexpected response format"],
      [{ Response: [] }, "unexpected response format"],
      [{ absent: true }, "unexpected response format"],
    ] as const) {
      respond(payload);
      expect((await runTencentWsaSearch({ config: config(), query: "q" })).error).toContain(
        message,
      );
    }
  });

  it("redacts raw and URL-encoded active key in error Code and RequestId before truncation", async () => {
    const encoded = encodeURIComponent(fakeKey);
    respond({
      Response: {
        RequestId: `id:${encoded}`,
        Error: { Code: `${"a".repeat(995)}${fakeKey}`, Message: fakeKey },
      },
    });
    const result = await runTencentWsaSearch({ config: config(), query: "q" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(fakeKey);
    expect(serialized).not.toContain(encoded);
    expect(serialized).not.toContain("fixture/tencent");
    expect(result.request_id).toContain("***");
    expect(result.error).toContain("API error");
  });

  it("does not expose HTTP error body, statusText or transport exception secrets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(fakeKey, { status: 403, statusText: fakeKey })),
    );
    expect(await runTencentWsaSearch({ config: config(), query: "q" })).toEqual({
      error: "Tencent Cloud WSA API error: HTTP 403",
      query: "q",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`reflected ${fakeKey}`);
      }),
    );
    const result = await runTencentWsaSearch({ config: config(), query: "q" });
    expect(JSON.stringify(result)).not.toContain(fakeKey);
    expect(result.error).toContain("request failed");
  });

  it("fails closed on oversized JSON through the actual SDK bounded reader", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(21 * 1024 * 1024).fill(32));
                controller.close();
              },
            }),
          ),
      ),
    );
    expect((await runTencentWsaSearch({ config: config(), query: "q" })).error).toContain(
      "invalid response",
    );
  });

  it("keeps current-turn cancellation through actual guarded response body consumption", async () => {
    const abort = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"Response":'));
                abort.abort(new Error("caller cancelled"));
              },
            }),
          ),
      ),
    );
    await expect(
      runTencentWsaSearch({ config: config(), query: "q", signal: abort.signal }),
    ).rejects.toThrow("caller cancelled");
  });

  it("enforces the donor 30-second deadline through the real guarded transport", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        started();
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
            once: true,
          });
        });
      }),
    );
    const result = runTencentWsaSearch({ config: config(), query: "q" });
    await requested;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1);
    expect((await result).error).toContain("request failed");
  });

  it("rejects stale callers before transport and skips pre-aborted requests", async () => {
    const fetch = respond({ Response: {} });
    await expect(
      runTencentWsaSearch({
        config: config(),
        query: "q",
        assertCurrent: () => {
          throw new Error("stale turn");
        },
      }),
    ).rejects.toThrow("stale turn");
    const signal = AbortSignal.abort(new Error("pre-aborted"));
    await expect(runTencentWsaSearch({ config: config(), query: "q", signal })).rejects.toThrow(
      "pre-aborted",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks cross-origin unsafe redirect before replaying credentials or query", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 307, headers: { location: "https://example.com/capture" } }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      (await runTencentWsaSearch({ config: config(), query: "private query" })).error,
    ).toContain("request failed");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses real native guard DNS rejection when Tencent resolves to a private address", async () => {
    // Restore native fetch. A DNS fixture returns only loopback; the production
    // guard must reject before constructing any network transport.
    vi.unstubAllGlobals();
    vi.mocked(lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    const result = await runTencentWsaSearch({ config: config(), query: "q" });
    expect(lookup).toHaveBeenCalled();
    expect(result.error).toContain("request failed");
  });

  it("does not request transport for blank queries or unresolved credentials; env ref has precedence", async () => {
    const fetch = respond({ Response: { Pages: [{}] } });
    expect((await runTencentWsaSearch({ config: config(), query: " " })).error).toBe(
      "Search query must not be empty",
    );
    expect((await runTencentWsaSearch({ query: "q" })).error).toBe(
      "TENCENTCLOUD_WSA_APIKEY is not configured",
    );
    vi.stubEnv("TENCENTCLOUD_WSA_APIKEY", "fallback-fake-key");
    expect(
      (
        await runTencentWsaSearch({
          config: config({ apiKey: { source: "file", provider: "default", id: "absent" } }),
          query: "q",
        })
      ).error,
    ).toContain("not configured");
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv("TENCENT_WSA_FAKE_TEST", "env-ref-fake-key");
    await runTencentWsaSearch({
      config: config({
        apiKey: { source: "env", provider: "default", id: "TENCENT_WSA_FAKE_TEST" },
      }),
      query: "q",
    });
    expect(new Headers((fetch.mock.calls[0]![1] as RequestInit).headers).get("authorization")).toBe(
      "Bearer env-ref-fake-key",
    );
  });
});
