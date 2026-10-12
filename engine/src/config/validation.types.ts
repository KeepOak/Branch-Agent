import type { PluginManifestRegistry } from "../plugins/manifest-registry.types.js";
import type { ConfigValidationIssue, BranchConfig } from "./types.branch.js";

export type ValidateConfigWithPluginsResult =
  | {
      ok: true;
      config: BranchConfig;
      warnings: ConfigValidationIssue[];
      strictIssues?: ConfigValidationIssue[];
    }
  | { ok: false; issues: ConfigValidationIssue[]; warnings: ConfigValidationIssue[] };

export type PreparedConfigValidationPluginMetadata = {
  manifestRegistry: PluginManifestRegistry;
  installedPluginRecordIds: ReadonlySet<string>;
};
