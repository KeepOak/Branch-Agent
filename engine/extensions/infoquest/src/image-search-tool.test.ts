import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import type { BranchPluginApi } from "branch/plugin-sdk/plugin-runtime";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInfoQuestImageSearchTool } from "./image-search-tool.js";
const offline = vi.hoisted(() => ({
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
      fetch: vi.fn(() => {
        throw new Error("FORBIDDEN native-network fallback");
      }),
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

beforeEach(() => {
  fetchMock.mockReset();
  offline.dns.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("INFOQUEST_API_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function tool(cfg = config()) {
  return createInfoQuestImageSearchTool({ config: cfg } as BranchPluginApi);
}
it("real named image tool returns original reference URLs via native client", async () => {
  answer(native({ images_results: [{ title: "Cat", original: "https://example.com/cat.jpg" }] }));
  const image = tool(config("imageSearch", { image_search_time_range: "7", image_size: "l" }));
  expect(image.name).toBe("infoquest_image_search");
  expect(image.resultContentSource).toBe("network");
  const result = await image.execute("fixture", { query: "cat", site: "flickr.com" });
  expect(result.details).toMatchObject({ provider: "infoquest", search_type: "Images", count: 1 });
  expect(body()).toEqual({
    format: "JSON",
    query: "cat",
    site: "flickr.com",
    search_type: "Images",
    time_range: 7,
    image_size: "l",
  });
  expect(result.content[0]).toMatchObject({ type: "text" });
});
it("image tool rejects missing query before HTTP", async () => {
  await expect(tool().execute("fixture", {})).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("image cancellation prevents HTTP and stale tool result", async () => {
  const controller = new AbortController();
  controller.abort(new Error("image retired"));
  await expect(tool().execute("fixture", { query: "cat" }, controller.signal)).rejects.toThrow(
    "image retired",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});
it("image success reflections are external and credential-redacted", async () => {
  answer(native({ images_results: [{ original: "https://example.com/a", title: key }] }));
  const result = await tool().execute("fixture", { query: "x" });
  expect(JSON.stringify(result)).not.toContain(key);
  expect(JSON.stringify(result)).toContain("EXTERNAL_UNTRUSTED_CONTENT");
});
