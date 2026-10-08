import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { createGroundRouteFetchProvider } from "./fetch-provider.js";

describe("GroundRoute fetch provider contract", () => {
  it("stores the fetch key separately and preserves configured search routing", () => {
    const provider = createGroundRouteFetchProvider();
    const config: BranchConfig = {
      plugins: {
        entries: {
          groundroute: { config: { webSearch: { apiKey: "search-fixture-key", maxResults: 20 } } },
        },
      },
    };
    provider.setConfiguredCredentialValue!(config, "fetch-fixture-key");
    expect(provider.getConfiguredCredentialValue!(config)).toBe("fetch-fixture-key");
    expect(config.plugins?.entries?.groundroute?.config).toEqual({
      webSearch: { apiKey: "search-fixture-key", maxResults: 20 },
      webFetch: { apiKey: "fetch-fixture-key" },
    });
    expect(provider.autoDetectOrder).toBeUndefined();
    expect(provider.credentialPath).toBe("plugins.entries.groundroute.config.webFetch.apiKey");
  });
  it("does not change search selection when enabling GroundRoute fetch", () => {
    const config: BranchConfig = { tools: { web: { search: { provider: "brave" } } } };
    const selected = createGroundRouteFetchProvider().applySelectionConfig!(config);
    expect(selected.tools?.web?.search?.provider).toBe("brave");
    expect(selected.plugins?.entries?.groundroute?.enabled).toBe(true);
  });
  it("rejects a cancelled turn before lazy client loading", async () => {
    const reason = new Error("turn ended");
    const tool = createGroundRouteFetchProvider().createTool({})!;
    await expect(
      tool.execute({ url: "https://example.com" }, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
  });
});
