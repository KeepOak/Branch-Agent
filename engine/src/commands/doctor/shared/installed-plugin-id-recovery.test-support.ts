import fs from "node:fs/promises";
import path from "node:path";
import type { BranchConfig } from "../../../config/types.branch.js";
import type { PluginInstallRecord } from "../../../config/types.plugins.js";
import { seedInstalledPluginIndex } from "../../../plugins/test-helpers/installed-plugin-index.js";
import type { BranchTestState } from "../../../test-utils/branch-test-state.js";

/** An already published official replacement, without invoking any installer. */
export async function seedRecoveryOwner(
  state: BranchTestState,
  config: BranchConfig,
  options: { version?: string; minHostVersion?: string; root?: string } = {},
) {
  const root = options.root ?? state.statePath("extensions", "branch-qqbot");
  const version = options.version ?? "2.0.3";
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "index.js"), "module.exports = {};\n");
  await fs.writeFile(
    path.join(root, "branch.plugin.json"),
    JSON.stringify({
      id: "branch-qqbot",
      legacyPluginIds: ["qqbot"],
      configSchema: { type: "object" },
    }),
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "@tencent-connect/branch-qqbot",
      version,
      branch: {
        extensions: ["./index.js"],
        ...(options.minHostVersion ? { install: { minHostVersion: options.minHostVersion } } : {}),
      },
    }),
  );
  const records: Record<string, PluginInstallRecord> = {
    "branch-qqbot": {
      source: "npm",
      spec: `@tencent-connect/branch-qqbot@${version}`,
      resolvedName: "@tencent-connect/branch-qqbot",
      resolvedSpec: `@tencent-connect/branch-qqbot@${version}`,
      version,
      installPath: root,
    },
  };
  await seedInstalledPluginIndex(records, { config, env: state.env });
  return { root, records };
}
