import { mkdtempSync, rmSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capturePluginRegistration } from "../../../src/plugins/captured-registration.js";
import { createPluginRecord } from "../../../src/plugins/loader-records.js";
import { createPluginRegistry } from "../../../src/plugins/registry.js";
import {
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "../../../src/plugins/runtime.js";
import type { PluginRuntime } from "../../../src/plugins/runtime/types.js";
import { resolveWebFetchDefinition } from "../../../src/web-fetch/runtime.js";
import { runWebSearch } from "../../../src/web-search/runtime.js";
import entry from "../index.js";

const fixture = vi.hoisted(() => ({
  nativeFetch: vi.fn(async () => {
    throw new Error("Unfixture'd native Undici request");
  }),
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("node:dns/promises", () => ({ lookup: fixture.lookup }));
const nativeUndici = createRequire(import.meta.url)("undici") as typeof import("undici");
const originalNativeFetch = nativeUndici.fetch;
const nativeDns = createRequire(import.meta.url)(
  "node:dns/promises",
) as typeof import("node:dns/promises");
const originalLookup = nativeDns.lookup;
let fixtureState: string;
let http: ReturnType<typeof vi.fn<typeof fetch>>;
const config: BranchConfig = {
  plugins: {
    entries: {
      groundroute: {
        enabled: true,
        config: {
          webSearch: { apiKey: "search-fixture-key" },
          webFetch: { apiKey: "fetch-fixture-key" },
        },
      },
    },
  },
  tools: { web: { search: { provider: "groundroute" }, fetch: { provider: "groundroute" } } },
};
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
  resetPluginRuntimeStateForTest();
  fixtureState = mkdtempSync(path.join(tmpdir(), "groundroute-state-"));
  vi.stubEnv("BRANCH_STATE_DIR", fixtureState);
  fixture.nativeFetch.mockClear();
  fixture.lookup.mockClear();
  http = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json({
      results: [
        {
          title: "Fixture",
          url: "https://example.com/a",
          snippet: "Snippet",
          content: "Body",
          source_engine: "brave",
        },
      ],
    }),
  );
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
  resetPluginRuntimeStateForTest();
  rmSync(fixtureState, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("actual GroundRoute plugin registration and host selection", () => {
  it("captures both real provider descriptors without invoking the network", () => {
    const captured = capturePluginRegistration({ id: entry.id, register: entry.register! });
    expect(captured.webSearchProviders.map((provider) => provider.id)).toEqual(["groundroute"]);
    expect(captured.webFetchProviders.map((provider) => provider.id)).toEqual(["groundroute"]);
    expect(http).not.toHaveBeenCalled();
  });
  it("registers the production entry into the actual host registry and selects search and fetch", async () => {
    const builder = createPluginRegistry({
      logger: { info() {}, warn() {}, error() {} },
      runtime: {} as PluginRuntime,
      activateGlobalSideEffects: false,
    });
    const record = createPluginRecord({
      id: "groundroute",
      source: new URL("../index.ts", import.meta.url).pathname,
      origin: "bundled",
      enabled: true,
      configSchema: true,
    });
    entry.register!(builder.createApi(record, { config }));
    setActivePluginRegistry(builder.registry);
    const search = await runWebSearch({
      config,
      preferInputConfig: true,
      providerId: "groundroute",
      args: { query: "fixture", count: 12 },
    });
    expect(search.provider).toBe("groundroute");
    expect(search.result).toMatchObject({ count: 1 });
    const selected = resolveWebFetchDefinition({ config, providerId: "groundroute" })!;
    expect(selected.provider.id).toBe("groundroute");
    const fetched = await selected.definition.execute({ url: "https://example.com/a" });
    expect(fetched.text).toContain("# Fixture\n\nBody");
    expect(http).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(http.mock.calls[0]![1]?.body))).toEqual({
      query: "fixture",
      max_results: 12,
    });
    expect(JSON.parse(String(http.mock.calls[1]![1]?.body))).toEqual({
      query: "https://example.com/a",
      mode: "page",
      max_results: 1,
    });
    expect(new Headers(http.mock.calls[0]![1]?.headers).get("Authorization")).toBe(
      "Bearer search-fixture-key",
    );
    expect(new Headers(http.mock.calls[1]![1]?.headers).get("Authorization")).toBe(
      "Bearer fetch-fixture-key",
    );
  });
});
