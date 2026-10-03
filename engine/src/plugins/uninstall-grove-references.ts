import { readClawPackageRefs, type PersistedClawPackageRef } from "../groves/provenance.js";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import { parseClawHubPluginSpec } from "../infra/clawhub-spec.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";

function clawPackageRefMatchesPluginInstall(
  ref: PersistedClawPackageRef,
  pluginId: string,
  record: PluginInstallRecord,
): boolean {
  if (ref.kind !== "plugin" || ref.source !== "clawhub" || record.source !== "clawhub") {
    return false;
  }
  const installedRef = record.clawhubPackage ?? parseClawHubPluginSpec(record.spec ?? "")?.name;
  return (installedRef ?? pluginId) === ref.ref;
}

/** Explain Grove dependents without blocking the operator-owned uninstall. */
export function collectGrovePluginUninstallWarnings(params: {
  pluginId: string;
  installRecord?: PluginInstallRecord;
  env?: BranchStateDatabaseOptions["env"];
}): string[] {
  const installRecord = params.installRecord;
  if (!installRecord || installRecord.source !== "clawhub") {
    return [];
  }
  const refs = readClawPackageRefs({
    kind: "plugin",
    source: "clawhub",
    ...(params.env ? { env: params.env } : {}),
  }).filter(
    (ref) =>
      ref.status !== "rolled_back" &&
      clawPackageRefMatchesPluginInstall(ref, params.pluginId, installRecord),
  );
  const groveIds = [...new Set(refs.map((ref) => ref.groveName))].toSorted();
  if (groveIds.length === 0) {
    return [];
  }

  const installedVersion = installRecord.resolvedVersion ?? installRecord.version;
  const expectedVersions = [...new Set(refs.map((ref) => ref.version))].toSorted();
  const drifted =
    installedVersion !== undefined &&
    expectedVersions.some((version) => version !== installedVersion);

  const warnings = [
    `Warning: plugin "${params.pluginId}" is referenced by Grove${groveIds.length === 1 ? "" : "s"}: ${groveIds.join(", ")}.`,
  ];
  if (drifted) {
    warnings.push(
      `Installed version ${installedVersion} differs from the Grove reference${expectedVersions.length === 1 ? "" : "s"} ${expectedVersions.join(", ")}.`,
    );
  }
  warnings.push(
    "Uninstalling it may break those Groves until the plugin is reinstalled or the Groves are updated.",
  );
  return warnings;
}
