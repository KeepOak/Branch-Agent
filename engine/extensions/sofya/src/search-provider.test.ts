import type { BranchConfig } from "branch/plugin-sdk/config-contracts";
import { expect, it } from "vitest";
import { createSofyaSearchProvider } from "./search-provider.js";
it("exposes actual host credential hooks, configured settings and explicit activation", () => {
  const provider = createSofyaSearchProvider();
  const config: BranchConfig = {};
  provider.setConfiguredCredentialValue?.(config, "search-key");
  expect(provider.getConfiguredCredentialValue?.(config)).toBe("search-key");
  const scoped: Record<string, unknown> = {};
  provider.setCredentialValue(scoped, "scoped");
  expect(provider.getCredentialValue(scoped)).toBe("scoped");
  expect(provider.applySelectionConfig?.({}).plugins?.entries?.sofya?.enabled).toBe(true);
  expect(provider.autoDetectOrder).toBeUndefined();
  expect(provider.envVars).toEqual(["SOFYA_API_KEY"]);
  const schema = provider.createTool({})?.parameters as {
    properties: { time_range: { enum: string[] } };
  };
  expect(schema.properties.time_range.enum).toEqual(["day", "week", "month", "year"]);
});
it("rejects invalid time range and pre-aborted caller without importing client", async () => {
  const tool = createSofyaSearchProvider().createTool({});
  await expect(tool?.execute({ query: "x", time_range: "hour" })).rejects.toThrow("time_range");
  const controller = new AbortController();
  controller.abort(new Error("caller stop"));
  await expect(tool?.execute({ query: "x" }, { signal: controller.signal })).rejects.toThrow(
    "caller stop",
  );
});
