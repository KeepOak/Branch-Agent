import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import { initializeNativeSessionCatalogPreferences } from "../plugins/native-session-catalog-config.js";
import type { ConfigValidationIssue, BranchConfig } from "./types.js";
import { validateExplicitPluginConfig } from "./validation-plugin-config.js";

const roots = createTempDirTracker();
afterEach(() => {
  vi.unstubAllEnvs();
  roots.cleanup();
});

function missingPluginWarningPaths(config: BranchConfig): string[] {
  const home = roots.make("branch-catalog-preference-warnings-");
  vi.stubEnv("BRANCH_HOME", home);
  vi.stubEnv("BRANCH_STATE_DIR", home);
  const warnings: ConfigValidationIssue[] = [];
  const issues: ConfigValidationIssue[] = [];
  validateExplicitPluginConfig({
    raw: config,
    config,
    env: { HOME: home, BRANCH_HOME: home, BRANCH_STATE_DIR: home },
    applyDefaults: false,
    registry: { plugins: [], diagnostics: [] },
    ensureCompatPluginIds: () => new Set(),
    ensureOverriddenPluginIds: () => new Set(),
    replacePluginEntryConfig: () => {
      throw new Error("An absent plugin cannot replace config through its schema");
    },
    issues,
    warnings,
  });
  expect(issues).toEqual([]);
  return warnings.map(({ path }) => path);
}

describe("native catalog preferences without installed plugins", () => {
  it("does not diagnose first-write privacy defaults as missing plugins", () => {
    const config = initializeNativeSessionCatalogPreferences({});
    expect(missingPluginWarningPaths(config)).toEqual([]);
  });

  const explicitUsageCases: Array<{
    name: string;
    config: BranchConfig;
    warningPath: string;
  }> = [
    {
      name: "explicit enablement",
      config: { plugins: { entries: { anthropic: { enabled: true } } } },
      warningPath: "plugins.entries.anthropic",
    },
    {
      name: "independent allowlist selection",
      config: { plugins: { allow: ["anthropic"] } },
      warningPath: "plugins.allow",
    },
    {
      name: "additional authored plugin configuration",
      config: {
        plugins: { entries: { anthropic: { config: { additionalSetting: "authored" } } } },
      },
      warningPath: "plugins.entries.anthropic",
    },
    {
      name: "an undeclared plugin with the same setting shape",
      config: {
        plugins: {
          entries: { "external-fixture": { config: { sessionCatalog: { enabled: false } } } },
        },
      },
      warningPath: "plugins.entries.external-fixture",
    },
  ];
  it.each(explicitUsageCases)(
    "retains missing-plugin warnings for $name",
    ({ config, warningPath }) => {
      const initialized = initializeNativeSessionCatalogPreferences(config);
      expect(missingPluginWarningPaths(initialized)).toEqual([warningPath]);
    },
  );
});
