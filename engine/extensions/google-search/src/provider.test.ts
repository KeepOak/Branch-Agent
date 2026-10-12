// Provider fixtures preserve the request/response contracts of the pinned LibreChat source.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSearchProviderPlugin } from "branch/plugin-sdk/provider-web-search-contract";

const guard = vi.hoisted(() => vi.fn());
vi.mock("branch/plugin-sdk/provider-web-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("branch/plugin-sdk/provider-web-search")>()),
  withTrustedWebSearchEndpoint: guard,
}));

import plugin from "../index.js";
import { createGoogleSearchWebSearchProvider } from "./provider.js";

function configuredTool(webSearch: Record<string, unknown>) {
  const tool = createGoogleSearchWebSearchProvider().createTool({
    config: { plugins: { entries: { "google-search": { config: { webSearch } } } } },
    searchConfig: { timeoutSeconds: 17 },
  });
  if (!tool) {
    throw new Error("Expected registered tool");
  }
  return tool;
}

function respond(body: unknown, status = 200) {
  guard.mockImplementationOnce(async (_params, read) => read(Response.json(body, { status })));
}

describe("google-search production provider", () => {
  beforeEach(() => {
    guard.mockReset();
    vi.stubEnv("GOOGLE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_CSE_ID", "");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live fetch forbidden"));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("registers a real provider with discoverable contract and selection wiring", () => {
    const registered: WebSearchProviderPlugin[] = [];
    plugin.register?.({
      registerWebSearchProvider: (provider: WebSearchProviderPlugin) => registered.push(provider),
    } as Parameters<NonNullable<typeof plugin.register>>[0]);
    expect(registered).toHaveLength(1);
    const provider = registered[0]!;
    expect(provider.id).toBe("google-search");
    const next = provider.applySelectionConfig?.({});
    expect(next?.plugins?.entries?.["google-search"]?.enabled).toBe(true);
    const searchConfig: Record<string, unknown> = {};
    provider.setCredentialValue(searchConfig, "fixture-secret");
    expect(provider.getCredentialValue(searchConfig)).toBe("fixture-secret");
    const config = {};
    provider.setConfiguredCredentialValue?.(config, "fixture-configured");
    expect(provider.getConfiguredCredentialValue?.(config)).toBe("fixture-configured");
  });

  it("declares the matching provider and credential configuration in its manifest", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../branch.plugin.json", import.meta.url), "utf8"),
    );
    expect(manifest.id).toBe("google-search");
    expect(manifest.contracts.webSearchProviders).toEqual(["google-search"]);
    expect(manifest.configSchema.properties.webSearch.properties.apiKey.type).toEqual([
      "string",
      "object",
    ]);
    expect(manifest.activation.onStartup).toBe(false);
  });

  it("honors existing disabled/deny policy during provider selection", () => {
    const provider = createGoogleSearchWebSearchProvider();
    const disabled = { plugins: { enabled: false } };
    const denied = { plugins: { deny: ["google-search"] } };
    expect(provider.applySelectionConfig?.(disabled)).toBe(disabled);
    expect(provider.applySelectionConfig?.(denied)).toBe(denied);
  });

  it("returns missing credential configuration without performing HTTP", async () => {
    expect(await configuredTool({}).execute({ query: "example" })).toMatchObject({
      error: "missing_google_search_api_key",
    });
    expect(guard).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains pre-canceled caller reason before any network operation", async () => {
    const controller = new AbortController();
    const reason = new Error("owner canceled search");
    controller.abort(reason);
    await expect(
      configuredTool({ apiKey: "fixture-key", searchEngineId: "engine-123" }).execute(
        { query: "example" },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);
    expect(guard).not.toHaveBeenCalled();
  });

  it("calls the current-turn fence immediately before the guarded HTTP request", async () => {
    const assertCurrent = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("turn superseded");
      });
    await expect(
      configuredTool({ apiKey: "fixture-key", searchEngineId: "engine-123" }).execute(
        { query: "example" },
        { assertCurrent },
      ),
    ).rejects.toThrow("turn superseded");
    expect(assertCurrent).toHaveBeenCalledTimes(2);
    expect(guard).not.toHaveBeenCalled();
  });

  it("redacts the configured key from provider error payloads", async () => {
    respond({ error: "reflected fixture-key" }, 401);
    const result = configuredTool({ apiKey: "fixture-key", searchEngineId: "engine-123" }).execute({
      query: "example",
    });
    await expect(result).rejects.toThrow("***");
    await expect(result).rejects.not.toThrow("fixture-key");
  });

  it("requires the engine ID and supports environment fallback without changing defaults", async () => {
    expect(
      await configuredTool({ apiKey: "fixture-key" }).execute({ query: "example" }),
    ).toMatchObject({ error: "missing_google_search_engine_id" });
    expect(guard).not.toHaveBeenCalled();
    vi.stubEnv("GOOGLE_SEARCH_API_KEY", "environment-fixture");
    vi.stubEnv("GOOGLE_CSE_ID", "environment-engine");
    respond({ items: [] });
    await configuredTool({}).execute({ query: "example" });
    const request = guard.mock.calls[0]![0];
    const url = new URL(request.url);
    expect(url.searchParams.get("key")).toBe("environment-fixture");
    expect(url.searchParams.get("cx")).toBe("environment-engine");
    expect(url.searchParams.get("num")).toBe("5");
  });

  it("executes registered caller with all source response metadata and wrapped results", async () => {
    respond({
      items: [{ title: "Example", link: "https://example.test/one", snippet: "Page text" }],
      queries: { nextPage: [{ startIndex: 11 }] },
    });
    const controller = new AbortController();
    const output = await configuredTool({
      apiKey: "fixture-key",
      searchEngineId: "engine-123",
    }).execute({ query: "owner & query", count: 10 }, { signal: controller.signal });
    expect(output).toMatchObject({
      provider: "google-search",
      count: 1,
      results: [
        {
          url: "https://example.test/one",
          title: expect.stringContaining("Example"),
          description: expect.stringContaining("Page text"),
        },
      ],
    });
    expect(output.raw).toContain('"nextPage"');
    expect(output.raw).toContain("EXTERNAL_UNTRUSTED_CONTENT");
    expect(guard.mock.calls[0]![0]).toMatchObject({
      timeoutSeconds: 17,
      signal: controller.signal,
    });
    expect(new URL(guard.mock.calls[0]![0].url).searchParams.get("q")).toBe("owner & query");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("retains cancellation raised while the guarded response is being read", async () => {
    const controller = new AbortController();
    const reason = new Error("canceled during response");
    guard.mockImplementationOnce(async (_params, read) => {
      const response = Response.json({ data: {}, items: [] });
      response.json = async () => {
        controller.abort(reason);
        return { data: {}, items: [] };
      };
      return read(response);
    });
    await expect(
      configuredTool({ apiKey: "fixture-key", searchEngineId: "engine-123" }).execute(
        { query: "example" },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });
});
