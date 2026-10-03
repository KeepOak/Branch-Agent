import { describe, expect, it } from "vitest";
import type { BundledPluginSource } from "./bundled-sources.js";
import { isBranchTrustedPluginInstallSpec } from "./install-provenance.js";

const bundledSources = new Map<string, BundledPluginSource>([
  [
    "discord",
    {
      pluginId: "discord",
      localPath: "/opt/branch/extensions/discord",
      npmSpec: "@branch/discord",
    },
  ],
]);

describe("plugin install provenance", () => {
  it.each([
    "discord",
    "@branch/discord",
    "npm:@branch/discord",
    "/opt/branch/extensions/discord",
    "brave",
    "npm:@branch/brave-plugin",
    "clawhub:branch-demo",
  ])("trusts Branch-owned install source %s", (spec) => {
    expect(isBranchTrustedPluginInstallSpec(spec, bundledSources)).toBe(true);
  });

  it.each(["npm:discord", "npm:@example/plugin", "/tmp/example-plugin"])(
    "keeps arbitrary install source %s untrusted",
    (spec) => {
      expect(isBranchTrustedPluginInstallSpec(spec, bundledSources)).toBe(false);
    },
  );
});
