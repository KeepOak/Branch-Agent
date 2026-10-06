// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_brave_tools.py (atlas RESEARCH-0002). Ported image search and public-URL cases to native Branch tool inputs, credential errors and guarded HTTP; external strings remain wrapped.
import { createServer, type Server } from "node:http";
import { createTestPluginApi } from "branch/plugin-sdk/plugin-test-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bravePlugin from "../index.js";
import { createBraveImageSearchTool } from "./brave-image-search-tool.js";

function wrapped(text: string) {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return expect.stringMatching(
    new RegExp(
      `^\\n<<<EXTERNAL_UNTRUSTED_CONTENT id="([a-f0-9]{16})">>>\\nSource: Web Search\\n---\\n${escaped}\\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="\\1">>>$`,
    ),
  );
}

describe("TestImageSearchTool", () => {
  let server: Server;
  let baseUrl: string;
  let payload: unknown;
  let status: number;
  let calls: URL[];
  const image = (index = 0) => ({
    title: index ? "Forest" : "Mountain",
    url: `https://example.com/${index}`,
    source: "example.com",
    thumbnail: { src: `https://imgs.search.brave.com/${index}.jpg`, width: 500, height: 320 },
    properties: { url: `https://cdn.example.com/${index}.jpg`, width: 1920, height: 1080 },
  });

  beforeEach(async () => {
    calls = [];
    status = 200;
    payload = { results: [image(), image(1)] };
    vi.stubEnv("BRAVE_API_KEY", "");
    server = createServer((request, response) => {
      calls.push(new URL(request.url!, baseUrl));
      expect(request.headers["x-subscription-token"]).toBe("brave-image-test-key");
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected loopback address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });

  function tool(key = "brave-image-test-key") {
    return createBraveImageSearchTool(
      createTestPluginApi({
        config: {
          plugins: { entries: { brave: { config: { webSearch: { apiKey: key, baseUrl } } } } },
        },
      }),
    );
  }
  async function search(input: Record<string, unknown> = { query: "mountain landscape" }) {
    return (await tool().execute("call", input)).details as Record<string, unknown>;
  }

  it("test_basic_image_search_returns_normalized_results", async () => {
    const parsed = await search();
    expect(parsed.query).toBe("mountain landscape");
    expect(parsed.total_results).toBe(2);
    expect((parsed.results as unknown[])[0]).toEqual({
      title: wrapped("Mountain"),
      image_url: "https://cdn.example.com/0.jpg",
      thumbnail_url: "https://imgs.search.brave.com/0.jpg",
      source_url: "https://example.com/0",
      source: wrapped("example.com"),
      width: 1920,
      height: 1080,
    });
    expect(parsed).toHaveProperty("usage_hint");
  });

  it("test_image_search_sends_brave_image_params_from_config", async () => {
    // Provider-specific options are native call inputs rather than DeerFlow's YAML tool config.
    payload = { results: Array.from({ length: 250 }, (_, index) => image(index)) };
    const parsed = await search({
      query: "sakura",
      max_results: "250",
      country: "JP",
      search_lang: "ja",
      safesearch: "off",
      spellcheck: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.pathname).toBe("/res/v1/images/search");
    expect(Object.fromEntries(calls[0]!.searchParams)).toEqual({
      q: "sakura",
      count: "200",
      country: "JP",
      search_lang: "ja",
      safesearch: "off",
      spellcheck: "false",
    });
    expect(parsed.total_results).toBe(200);
  });

  it("test_image_search_filters_unsafe_image_urls_but_keeps_safe_thumbnail", async () => {
    payload = {
      results: [
        {
          ...image(),
          title: "Unsafe original",
          url: "http://localhost/page",
          properties: { url: "http://127.0.0.1/image.jpg" },
        },
        {
          ...image(1),
          url: "http://10.0.0.1/page",
          thumbnail: { src: "http://0177.0.0.1/thumb.jpg" },
          properties: { url: "http://2130706433/image.jpg" },
        },
      ],
    };
    const parsed = await search({ query: "unsafe" });
    expect(parsed.total_results).toBe(1);
    expect((parsed.results as unknown[])[0]).toMatchObject({
      title: wrapped("Unsafe original"),
      image_url: "",
      thumbnail_url: "https://imgs.search.brave.com/0.jpg",
      source_url: "",
    });
  });

  it("test_image_search_falls_back_when_only_one_image_url_is_present", async () => {
    payload = {
      results: [
        { ...image(), properties: {} },
        { ...image(1), thumbnail: {} },
      ],
    };
    const parsed = await search({ query: "fallback" });
    expect(parsed.total_results).toBe(2);
    expect(parsed.results).toMatchObject([
      {
        image_url: "https://imgs.search.brave.com/0.jpg",
        thumbnail_url: "https://imgs.search.brave.com/0.jpg",
      },
      {
        image_url: "https://cdn.example.com/1.jpg",
        thumbnail_url: "https://cdn.example.com/1.jpg",
      },
    ]);
  });

  it("test_image_search_reports_thumbnail_dimensions_when_original_dropped", async () => {
    payload = {
      results: [
        {
          ...image(),
          properties: { url: "http://127.0.0.1/image.jpg", width: 1920, height: 1080 },
          thumbnail: { src: "https://imgs.search.brave.com/thumb.jpg", width: 300, height: 200 },
        },
      ],
    };
    const parsed = await search({ query: "dims" });
    expect(parsed.total_results).toBe(1);
    expect((parsed.results as unknown[])[0]).toMatchObject({
      image_url: "",
      thumbnail_url: "https://imgs.search.brave.com/thumb.jpg",
      width: 300,
      height: 200,
    });
  });

  it("test_image_search_missing_api_key_returns_error_json", async () => {
    expect((await tool("").execute("call", { query: "test" })).details).toEqual({
      error: "missing_brave_api_key",
      query: "test",
    });
    expect(calls).toHaveLength(0);
  });

  it("returns repeated missing-key errors without dispatch", async () => {
    // Branch reports missing credentials in the tool's structured error rather than Python logging.
    for (const query of ["q2", "q3"]) {
      expect((await tool("").execute("call", { query })).details).toEqual({
        error: "missing_brave_api_key",
        query,
      });
    }
    expect(calls).toHaveLength(0);
  });

  it("test_image_search_http_error_returns_structured_error", async () => {
    status = 403;
    payload = { error: "Forbidden" };
    await expect(search({ query: "test" })).rejects.toThrow(/Brave Image Search API error.*403/u);
    expect(calls).toHaveLength(1);
  });

  it("test_image_search_unexpected_results_format_returns_error", async () => {
    payload = { results: { not: "a list" } };
    await expect(search({ query: "test" })).rejects.toThrow(
      "Brave Image Search returned an unexpected response format",
    );
  });

  it("test_package_exports_image_search_tool", () => {
    const registerTool = vi.fn();
    bravePlugin.register(createTestPluginApi({ config: {}, registerTool }));
    expect(registerTool).toHaveBeenCalledWith(expect.any(Function), { name: "brave_image_search" });
    expect(tool().parameters.properties.max_results).toMatchObject({ maximum: 200 });
  });

  it("test_coerce_max_results_inf_falls_back_to_default", async () => {
    await search({ query: "test", max_results: Infinity });
    expect(calls[0]!.searchParams.get("count")).toBe("5");
  });

  it.each([
    ["test_https_public_hostname_passes", "https://example.com/i.jpg", true],
    ["test_non_http_scheme_is_filtered", "file:///etc/passwd", false],
    ["test_localhost_is_filtered", "http://localhost/i.jpg", false],
    ["test_private_ip_is_filtered", "http://10.0.0.1/i.jpg", false],
    ["test_obfuscated_loopback_ip_is_filtered", "http://2130706433/i.jpg", false],
    ["test_malformed_ipv6_url_does_not_raise", "http://[::1/i.jpg", false],
    ["test_nat64_embedded_loopback_is_filtered", "http://[64:ff9b::127.0.0.1]/i.jpg", false],
    ["test_ipv4_compatible_embedded_private_is_filtered", "http://[::10.0.0.1]/i.jpg", false],
    ["test_ipv4_mapped_loopback_is_filtered", "http://[::ffff:127.0.0.1]/i.jpg", false],
    ["test_sixtofour_loopback_is_filtered", "http://[2002:7f00:1::]/i.jpg", false],
    ["test_global_ipv6_passes", "http://[2001:4860:4860::8888]/i.jpg", true],
  ])("%s", async (_name, url, safe) => {
    payload = { results: [{ properties: { url } }] };
    const parsed = await search();
    if (safe) expect(parsed.results).toMatchObject([{ image_url: url }]);
    else expect(parsed).toEqual({ error: "No safe image URLs found", query: "mountain landscape" });
  });

  it("stops cancelled work before credential resolution or network dispatch", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(tool().execute("cancel", { query: "test" }, controller.signal)).rejects.toBe(
      controller.signal.reason,
    );
    expect(calls).toHaveLength(0);
  });
});
