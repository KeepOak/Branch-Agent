import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { createGroundRouteSearchProvider } from "./search-provider.js";

describe("GroundRoute search provider contract", () => {
  it("enables only its own plugin and preserves existing routing and fetch selection", () => {
    const provider = createGroundRouteSearchProvider();
    const config: BranchConfig = {
      tools: { web: { fetch: { provider: "firecrawl" } } },
      plugins: {
        entries: {
          groundroute: {
            config: {
              webSearch: { maxResults: 20, engine: "exa", routing: { strategy: "quality" } },
            },
          },
        },
      },
    };
    const selected = provider.applySelectionConfig!(config);
    expect(selected.tools?.web?.fetch?.provider).toBe("firecrawl");
    expect(selected.plugins?.entries?.groundroute?.config).toEqual(
      config.plugins?.entries?.groundroute?.config,
    );
    expect(selected.plugins?.entries?.groundroute?.enabled).toBe(true);
    expect(provider.autoDetectOrder).toBeUndefined();
  });
  it("stores the search key in the real plugin contract subtree", () => {
    const provider = createGroundRouteSearchProvider();
    const config: BranchConfig = {};
    provider.setConfiguredCredentialValue!(config, "search-fixture-key");
    expect(provider.getConfiguredCredentialValue!(config)).toBe("search-fixture-key");
    expect(config.plugins?.entries?.groundroute?.config).toEqual({
      webSearch: { apiKey: "search-fixture-key" },
    });
    expect(provider.credentialPath).toBe("plugins.entries.groundroute.config.webSearch.apiKey");
  });
  it("honors cancellation and current-turn fences before lazy client loading", async () => {
    const definition = createGroundRouteSearchProvider().createTool({ config: {} })!;
    const reason = new Error("turn ended");
    await expect(
      definition.execute({ query: "q" }, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    await expect(
      definition.execute(
        { query: "q" },
        {
          assertCurrent() {
            throw reason;
          },
        },
      ),
    ).rejects.toBe(reason);
  });
});
