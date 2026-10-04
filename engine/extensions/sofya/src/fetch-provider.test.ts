import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { expect, it } from "vitest";
import { createSofyaFetchProvider } from "./fetch-provider.js";
it("exposes fetch-specific credentials and preserves search credential", () => {
  const provider = createSofyaFetchProvider();
  const config: BranchConfig = {
    plugins: { entries: { sofya: { config: { webSearch: { apiKey: "search-key" } } } } },
  };
  provider.setConfiguredCredentialValue?.(config, "fetch-key");
  expect(provider.getConfiguredCredentialValue?.(config)).toBe("fetch-key");
  expect(config.plugins?.entries?.sofya?.config?.webSearch).toEqual({ apiKey: "search-key" });
  const scoped: Record<string, unknown> = {};
  provider.setCredentialValue(scoped, "scope-key");
  expect(provider.getCredentialValue(scoped)).toBe("scope-key");
  expect(provider.applySelectionConfig?.({}).plugins?.entries?.sofya?.enabled).toBe(true);
  expect(provider.credentialPath).toBe("plugins.entries.sofya.config.webFetch.apiKey");
  expect(provider.autoDetectOrder).toBeUndefined();
});
it("forwards caller abort before client work", async () => {
  const controller = new AbortController();
  controller.abort(new Error("fetch stop"));
  await expect(
    createSofyaFetchProvider()
      .createTool({})
      ?.execute({ url: "https://example.com" }, { signal: controller.signal }),
  ).rejects.toThrow("fetch stop");
});
