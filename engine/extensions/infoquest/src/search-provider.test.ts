import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInfoQuestSearchProvider } from "./search-provider.js";
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

function empty() {
  answer({ search_result: { results: [] } });
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

it("search contracts use real scoped credentials and enable only selected plugin", () => {
  const provider = createInfoQuestSearchProvider();
  const cfg: BranchConfig = {};
  provider.setConfiguredCredentialValue?.(cfg, " configured-key ");
  expect(provider.getConfiguredCredentialValue?.(cfg)).toBe(" configured-key ");
  expect(provider.credentialPath).toBe("plugins.entries.infoquest.config.webSearch.apiKey");
  expect(provider.applySelectionConfig?.(cfg)).toMatchObject({
    plugins: { entries: { infoquest: { enabled: true } } },
  });
  expect(cfg.tools?.web?.fetch?.provider).toBeUndefined();
});
it("search callback invokes native client, has no fabricated count setting", async () => {
  empty();
  const provider = createInfoQuestSearchProvider();
  const tool = provider.createTool({ config: config() })!;
  expect((tool.parameters as { properties?: unknown }).properties).not.toHaveProperty("count");
  await expect(tool.execute({ query: "topic", site: "example.com" })).resolves.toMatchObject({
    provider: "infoquest",
    count: 0,
  });
  expect(body()).toEqual({ format: "JSON", query: "topic", site: "example.com" });
});
it("search current-turn fence prevents dispatch and prevents stale completion", async () => {
  const tool = createInfoQuestSearchProvider().createTool({ config: config() })!;
  await expect(
    tool.execute(
      { query: "x" },
      {
        assertCurrent() {
          throw new Error("retired before");
        },
      },
    ),
  ).rejects.toThrow("retired before");
  expect(fetchMock).not.toHaveBeenCalled();
  let retired = false;
  fetchMock.mockImplementationOnce(async () => {
    retired = true;
    return new Response(JSON.stringify({ search_result: { results: [] } }));
  });
  const fence = () => {
    if (retired) {
      throw new Error("retired after");
    }
  };
  await expect(tool.execute({ query: "x" }, { assertCurrent: fence })).rejects.toThrow(
    "retired after",
  );
  expect(fetchMock).toHaveBeenCalledOnce();
});
