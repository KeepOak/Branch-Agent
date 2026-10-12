import { describe, expect, it } from "vitest";
import {
  PLUGIN_CATEGORY_SLUGS,
  listMissingExternalCodePluginFieldPaths,
  normalizeExternalPluginCompatibility,
  validatePluginCategories,
  validateExternalCodePluginPackageJson,
} from "./index.js";

describe("@branch/plugin-package-contract", () => {
  it("publishes the controlled plugin category taxonomy", () => {
    expect(PLUGIN_CATEGORY_SLUGS).toEqual([
      "channels",
      "models",
      "agent-runtimes",
      "memory",
      "context",
      "voice",
      "web",
      "computer-use",
      "media",
      "security",
      "integrations",
      "developer-tools",
      "infrastructure",
      "documents-files",
      "inbox-collaboration",
      "productivity",
      "scheduling",
      "finance-payments",
      "sales-marketing",
      "data-analytics",
      "agent-orchestration",
      "research",
      "other",
    ]);
  });

  it("validates ordered package-owned plugin categories", () => {
    expect(validatePluginCategories(undefined)).toEqual({ ok: true });
    expect(validatePluginCategories(["web", "tools", "runtime"])).toEqual({
      ok: true,
      categories: ["web", "tools", "runtime"],
    });
    expect(validatePluginCategories(["web", "web"])).toEqual({
      ok: false,
      error: "must not contain duplicates",
    });
  });

  it("normalizes the Branch Agent compatibility block for external plugins", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        branch: {
          compat: {
            pluginApi: ">=2026.3.24-beta.2",
            minGatewayVersion: "2026.3.24-beta.2",
          },
          build: {
            branchVersion: "2026.3.24-beta.2",
            pluginSdkVersion: "0.9.0",
          },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=2026.3.24-beta.2",
      builtWithBranchVersion: "2026.3.24-beta.2",
      pluginSdkVersion: "0.9.0",
      minGatewayVersion: "2026.3.24-beta.2",
    });
  });

  it("falls back to install.minHostVersion and package version when compatible", () => {
    expect(
      normalizeExternalPluginCompatibility({
        version: "1.2.3",
        branch: {
          compat: {
            pluginApi: ">=1.0.0",
          },
          install: {
            minHostVersion: "2026.3.24-beta.2",
          },
        },
      }),
    ).toEqual({
      pluginApiRange: ">=1.0.0",
      builtWithBranchVersion: "1.2.3",
      minGatewayVersion: "2026.3.24-beta.2",
    });
  });

  it("reports missing required fields with stable field paths", () => {
    const packageJson = {
      branch: {
        compat: {},
        build: {},
      },
    };

    expect(listMissingExternalCodePluginFieldPaths(packageJson)).toEqual([
      "branch.compat.pluginApi",
      "branch.build.branchVersion",
    ]);
    expect(validateExternalCodePluginPackageJson(packageJson).issues).toEqual([
      {
        fieldPath: "branch.compat.pluginApi",
        message: "branch.compat.pluginApi is required for external code plugin packages.",
      },
      {
        fieldPath: "branch.build.branchVersion",
        message: "branch.build.branchVersion is required for external code plugin packages.",
      },
    ]);
  });
});
