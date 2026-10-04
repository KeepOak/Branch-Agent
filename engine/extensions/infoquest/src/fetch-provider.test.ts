import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInfoQuestWebFetchProvider } from "./fetch-provider.js";
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

it("fetch configured credential path and host credential contract remain real", () => {
  const provider = createInfoQuestWebFetchProvider();
  const cfg: BranchConfig = {};
  provider.setConfiguredCredentialValue?.(cfg, "fetch-key");
  expect(provider.getConfiguredCredentialValue?.(cfg)).toBe("fetch-key");
  expect(provider.credentialPath).toBe("plugins.entries.infoquest.config.webFetch.apiKey");
  expect(provider.applySelectionConfig?.(cfg)).toMatchObject({
    plugins: { entries: { infoquest: { enabled: true } } },
  });
});
it("fetch callback honors actual URL and maxChars contract", async () => {
  answer({ reader_result: "<p>Long content that exceeds a short cap.</p>" });
  const result = await createInfoQuestWebFetchProvider()
    .createTool({ config: config() })!
    .execute({ url: "https://example.com", maxChars: 20 });
  expect(result).toMatchObject({ provider: "infoquest", truncated: true, extractMode: "markdown" });
  expect(body()).toEqual({ url: "https://example.com", format: "HTML" });
});
it("fetch callback aborted caller fails before URL/DNS/HTTP", async () => {
  const controller = new AbortController();
  controller.abort(new Error("fetch superseded"));
  await expect(
    createInfoQuestWebFetchProvider()
      .createTool({ config: config() })!
      .execute({ url: "https://example.com" }, { signal: controller.signal }),
  ).rejects.toThrow("fetch superseded");
  expect(offline.dns).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});
