import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveContextTokens } from "../auto-reply/reply/model-selection-context.js";
import type { BranchConfig } from "../config/types.branch.js";
import { refreshContextWindowCache, resetContextWindowCacheForTest } from "./context.js";

describe("OpenCode Go context metadata", () => {
  let contextWindowTokens: number | undefined;
  let configuredModels: BranchConfig["models"];

  beforeAll(async () => {
    const cfg: BranchConfig = {
      agents: { defaults: { model: { primary: "opencode-go/deepseek-v4-pro" } } },
      plugins: { allow: ["opencode-go"] },
    };

    await refreshContextWindowCache(cfg);
    contextWindowTokens = resolveContextTokens({
      cfg,
      provider: "opencode-go",
      model: "deepseek-v4-pro",
    });
    configuredModels = cfg.models;
  });

  afterAll(() => {
    resetContextWindowCacheForTest();
  });

  it("warms the provider-owned context window without writing model config", () => {
    expect(contextWindowTokens).toBe(1_000_000);
    expect(configuredModels).toBeUndefined();
  });
});
