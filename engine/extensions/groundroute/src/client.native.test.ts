import { createRequire, syncBuiltinESMExports } from "node:module";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceGroundRouteCount,
  resolveGroundRouteApiKey,
  runGroundRouteFetch,
  runGroundRouteSearch,
} from "./client.js";

const fixture = vi.hoisted(() => ({
  lookup: vi.fn(async (_hostname: string) => [{ address: "93.184.216.34", family: 4 }]),
  nativeFetch: vi.fn(async () => {
    throw new Error("Unfixture'd native Undici request");
  }),
}));
vi.mock("node:dns/promises", () => ({ lookup: fixture.lookup }));

const cfg: BranchConfig = {
  plugins: {
    entries: {
      groundroute: {
        config: {
          webSearch: { apiKey: "search-fixture-key", maxResults: 8 },
          webFetch: { apiKey: "fetch-fixture-key" },
        },
      },
    },
  },
};
const row = { url: "https://example.com/a", title: "A", snippet: "s", source_engine: "exa" };
const nativeUndici = createRequire(import.meta.url)("undici") as typeof import("undici");
const originalNativeFetch = nativeUndici.fetch;
const nativeDns = createRequire(import.meta.url)(
  "node:dns/promises",
) as typeof import("node:dns/promises");
const originalLookup = nativeDns.lookup;
let http: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  Object.defineProperty(nativeDns, "lookup", {
    configurable: true,
    writable: true,
    value: fixture.lookup,
  });
  syncBuiltinESMExports();
  Object.defineProperty(nativeUndici, "fetch", {
    configurable: true,
    writable: true,
    value: fixture.nativeFetch,
  });
  fixture.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  fixture.nativeFetch.mockClear();
  http = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ results: [row] }));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => http(input, init));
  vi.stubGlobal("__BRANCH_TEST_UNDICI_RUNTIME_DEPS__", { ...nativeUndici, fetch: http });
  vi.stubEnv("GROUNDROUTE_API_KEY", "");
});
afterEach(() => {
  Object.defineProperty(nativeDns, "lookup", {
    configurable: true,
    writable: true,
    value: originalLookup,
  });
  syncBuiltinESMExports();
  Object.defineProperty(nativeUndici, "fetch", {
    configurable: true,
    writable: true,
    value: originalNativeFetch,
  });
  expect(fixture.nativeFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GroundRoute pinned protocol through actual host transport", () => {
  it("sends the exact search request, distinct search key, configured count and wrapped sources", async () => {
    const result = await runGroundRouteSearch({ cfg, query: "vector databases" });
    const [endpoint, init] = http.mock.calls[0]!;
    expect(endpoint).toBe("https://api.groundroute.ai/v1/search");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer search-fixture-key");
    expect(JSON.parse(String(init?.body))).toEqual({ query: "vector databases", max_results: 8 });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init).toHaveProperty("dispatcher");
    expect(result).toMatchObject({ count: 1, results: [{ url: row.url }] });
    expect(JSON.stringify(result)).toContain("EXTERNAL_UNTRUSTED_CONTENT");
    expect(JSON.stringify(result)).toContain("exa");
    expect(fixture.lookup).toHaveBeenCalledWith("api.groundroute.ai", { all: true });
  });

  it("honors caller count over config and does not cap mapped response rows", async () => {
    http.mockResolvedValue(Response.json({ results: Array.from({ length: 60 }, () => row) }));
    const result = await runGroundRouteSearch({ cfg, query: "q", count: 20 });
    expect(JSON.parse(String(http.mock.calls[0]![1]?.body))).toEqual({
      query: "q",
      max_results: 20,
    });
    expect(result.count).toBe(60);
  });

  it("preserves missing field defaults and skips non-object malformed rows", async () => {
    http.mockResolvedValue(Response.json({ results: [{}, null, 3, []] }));
    const result = await runGroundRouteSearch({ cfg, query: "q" });
    expect(result).toMatchObject({
      count: 1,
      results: [{ title: "", url: "", snippet: "", description: "", source_engine: "" }],
    });
  });

  it("returns donor no-results error", async () => {
    http.mockResolvedValue(Response.json({ results: [] }));
    expect(await runGroundRouteSearch({ cfg, query: "none" })).toMatchObject({
      error: "No results found",
      query: "none",
    });
  });

  it("uses donor page route, fetch credential and content preference", async () => {
    http.mockResolvedValue(Response.json({ results: [{ ...row, content: "Body text" }] }));
    const result = await runGroundRouteFetch({ cfg, url: "https://example.com/a" });
    expect(new Headers(http.mock.calls[0]![1]?.headers).get("Authorization")).toBe(
      "Bearer fetch-fixture-key",
    );
    expect(JSON.parse(String(http.mock.calls[0]![1]?.body))).toEqual({
      query: row.url,
      mode: "page",
      max_results: 1,
    });
    expect(result.text).toContain("# A\n\nBody text");
  });

  it("falls back to snippet and preserves the donor 4096 Unicode code-point slice", async () => {
    http.mockResolvedValue(
      Response.json({ results: [{ ...row, snippet: "😀".repeat(4097), content: "" }] }),
    );
    const result = await runGroundRouteFetch({ cfg, url: row.url });
    expect(result.text).toContain("😀".repeat(4096));
    expect(result.text).not.toContain("😀".repeat(4097));
    expect(result.truncated).toBe(true);
  });

  it("supports host text extraction and a tighter caller content limit", async () => {
    http.mockResolvedValue(Response.json({ results: [{ ...row, content: "**bold** text" }] }));
    const result = await runGroundRouteFetch({
      cfg,
      url: row.url,
      extractMode: "text",
      maxChars: 8,
    });
    expect(result.text).toContain("bold");
    expect(result.text).not.toContain("# A");
    expect(result.truncated).toBe(true);
  });

  it.each([
    "http://127.0.0.1/a",
    "https://localhost/a",
    "file:///etc/passwd",
    "https://user:password@example.com",
  ])("rejects blocked fetch target %s before HTTP", async (url) => {
    await expect(runGroundRouteFetch({ cfg, url })).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });

  it("rejects private target DNS and scrubs blocked result URLs through real URL guards", async () => {
    fixture.lookup.mockImplementation(async (hostname) => [
      { address: hostname === "private.example" ? "10.0.0.1" : "93.184.216.34", family: 4 },
    ]);
    await expect(runGroundRouteFetch({ cfg, url: "https://private.example/a" })).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
    http.mockResolvedValue(
      Response.json({ results: [{ ...row, url: "https://private.example/a" }] }),
    );
    expect(await runGroundRouteSearch({ cfg, query: "q" })).toMatchObject({
      results: [{ url: "" }],
    });
  });

  it("rejects an endpoint DNS rebinding response before transport", async () => {
    fixture.lookup.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await expect(runGroundRouteSearch({ cfg, query: "q" })).rejects.toThrow();
    expect(http).not.toHaveBeenCalled();
  });

  it("rejects redirect to a private host without a second HTTP call", async () => {
    http.mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "https://127.0.0.1/a" } }),
    );
    await expect(runGroundRouteSearch({ cfg, query: "q" })).rejects.toThrow();
    expect(http).toHaveBeenCalledTimes(1);
  });

  it("redacts reflected active key from every HTTP error metadata field", async () => {
    const secret = "search-fixture-key";
    http.mockResolvedValue(
      Response.json(
        { error: { message: secret, code: secret, type: secret } },
        { status: 402, headers: { "x-request-id": secret } },
      ),
    );
    const error = await runGroundRouteSearch({ cfg, query: "q" }).catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 402 });
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("redacts credentials from rejected HTTP transport diagnostics without retaining causes", async () => {
    http.mockRejectedValue(
      new Error("network reflected search-fixture-key", {
        cause: { authorization: "search-fixture-key" },
      }),
    );
    const error = await runGroundRouteSearch({ cfg, query: "q" }).catch((value: unknown) => value);
    expect(String(error)).not.toContain("search-fixture-key");
    expect(error).not.toHaveProperty("cause");
  });

  it("omits malformed JSON parser cause with active credential context", async () => {
    http.mockResolvedValue(new Response('{"secret":"search-fixture-key"'));
    const error = await runGroundRouteSearch({ cfg, query: "q" }).catch((value: unknown) => value);
    expect(String(error)).toContain("malformed JSON");
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("search-fixture-key");
  });

  it("enforces host JSON byte limit", async () => {
    http.mockResolvedValue(new Response("x".repeat(16 * 1024 * 1024 + 1)));
    await expect(runGroundRouteSearch({ cfg, query: "q" })).rejects.toThrow("exceeds");
  });

  it("cancels an in-flight success body with the caller reason", async () => {
    const controller = new AbortController();
    const reason = new Error("current turn cancelled");
    http.mockResolvedValue(new Response(new ReadableStream({ start() {} })));
    const pending = runGroundRouteSearch({ cfg, query: "q", signal: controller.signal });
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("cancels an in-flight error body with the caller reason", async () => {
    const controller = new AbortController();
    const reason = new Error("current turn cancelled");
    http.mockResolvedValue(new Response(new ReadableStream({ start() {} }), { status: 503 }));
    const pending = runGroundRouteSearch({ cfg, query: "q", signal: controller.signal });
    await vi.waitFor(() => expect(http).toHaveBeenCalled());
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("pre-abort wins before credentials, DNS and HTTP", async () => {
    const reason = new Error("stale turn");
    await expect(
      runGroundRouteSearch({ cfg, query: "q", signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(http).not.toHaveBeenCalled();
    expect(fixture.lookup).not.toHaveBeenCalled();
  });

  it("rechecks current-turn authority immediately after DNS before HTTP", async () => {
    let current = true;
    fixture.lookup.mockImplementation(async () => {
      current = false;
      return [{ address: "93.184.216.34", family: 4 }];
    });
    await expect(
      runGroundRouteSearch({
        cfg,
        query: "q",
        assertCurrent: () => {
          if (!current) {
            throw new Error("stale turn");
          }
        },
      }),
    ).rejects.toThrow("stale turn");
    expect(http).not.toHaveBeenCalled();
  });
});

describe("GroundRoute donor credential and count semantics", () => {
  it.each([
    [undefined, 5],
    [null, 5],
    ["500", 50],
    ["9".repeat(400), 50],
    ["-" + "9".repeat(400), 1],
    ["1_000", 50],
    [0, 1],
    [-10, 1],
    [20.9, 20],
    [Infinity, 5],
    ["invalid", 5],
    ["3.5", 5],
    [" 10 ", 10],
    [true, 1],
  ])("coerces %s to %s", (value, expected) => {
    expect(coerceGroundRouteCount(value)).toBe(expected);
  });
  it("uses independent named-tool keys and normalizes whitespace", () => {
    expect(resolveGroundRouteApiKey(cfg, "webSearch")).toBe("search-fixture-key");
    expect(resolveGroundRouteApiKey(cfg, "webFetch")).toBe("fetch-fixture-key");
    vi.stubEnv("GROUNDROUTE_API_KEY", " env-key ");
    expect(resolveGroundRouteApiKey(undefined, "webSearch")).toBe("env-key");
  });
  it("does not borrow search key for fetch", () => {
    const searchOnly: BranchConfig = {
      plugins: { entries: { groundroute: { config: { webSearch: { apiKey: "search-only" } } } } },
    };
    expect(resolveGroundRouteApiKey(searchOnly, "webFetch")).toBeUndefined();
  });
  it("blocks configured secret refs from borrowing an ambient key", async () => {
    vi.stubEnv("GROUNDROUTE_API_KEY", "ambient-fixture-key");
    const blocked: BranchConfig = {
      plugins: {
        entries: {
          groundroute: {
            config: {
              webSearch: { apiKey: { source: "file", provider: "default", id: "fixture" } },
            },
          },
        },
      },
    };
    expect(resolveGroundRouteApiKey(blocked, "webSearch")).toBeUndefined();
    expect(await runGroundRouteSearch({ cfg: blocked, query: "q" })).toMatchObject({
      error: "missing_groundroute_api_key",
    });
    expect(http).not.toHaveBeenCalled();
  });
});
