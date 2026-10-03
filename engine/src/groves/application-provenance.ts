import { stableStringify } from "@branch/normalization-core";
import type { ClawPackageStatus } from "./lifecycle-status.js";
import type { PersistedClawPackageRef } from "./provenance.js";
import type {
  GroveAddPlanAction,
  ClawDiagnostic,
  GroveManifest,
  GroveBranchProfile,
  ClawPackage,
  ClawPackagePreflight,
  ClawPackagePreflightResult,
} from "./types.js";

export function isApplicationUpdateBlocker(entry: ClawDiagnostic): boolean {
  return (
    entry.code !== "workspace_collision" &&
    entry.code !== "agent_id_collision" &&
    !entry.path.startsWith("$.packages")
  );
}

export function clawPackageKey(value: Pick<ClawPackage, "kind" | "ref">): string {
  return `${value.kind}:${value.ref}`;
}

export function recordingClawPackagePreflight(
  preflight: ClawPackagePreflight | undefined,
  workspace: string,
  results: Map<string, ClawPackagePreflightResult>,
  currentPackages: ReadonlyMap<string, ClawPackageStatus>,
): ClawPackagePreflight {
  return async (pkg) => {
    const result = preflight
      ? await preflight(pkg, workspace)
      : {
          ok: false as const,
          code: "package_install_unavailable",
          message: "Package preflight is unavailable.",
        };
    const current = currentPackages.get(clawPackageKey(pkg));
    const normalized =
      !result.ok &&
      pkg.kind === "plugin" &&
      result.code === "plugin_version_conflict" &&
      current?.state === "present" &&
      current.origin === "grove-introduced" &&
      !current.independentOwner &&
      current.version !== pkg.version &&
      result.installedVersion === current.version
        ? { ...result, ok: true as const, action: "install" as const }
        : result;
    results.set(clawPackageKey(pkg), normalized);
    return normalized;
  };
}

function groveProfileExtensionPackages(profile: GroveBranchProfile | undefined): ClawPackage[] {
  return (profile?.extensions ?? []).map((extension) => ({
    kind: "plugin",
    source: extension.source,
    ref: extension.ref,
    version: extension.version,
  }));
}

export function groveTargetPackages(
  manifest: GroveManifest,
  profile: GroveBranchProfile | undefined,
) {
  return new Map(
    [...manifest.packages, ...groveProfileExtensionPackages(profile)].map(
      (pkg) => [clawPackageKey(pkg), pkg] as const,
    ),
  );
}

export function groveWorkspaceActionsById(actions: GroveAddPlanAction[]) {
  return new Map(
    actions
      .filter((action) => action.kind === "workspaceFile")
      .map((action) => [action.id, action] as const),
  );
}

export function clawPackageActionsById(actions: GroveAddPlanAction[]) {
  return new Map(
    actions
      .filter((action) => action.kind === "package")
      .map((action) => [action.id, action] as const),
  );
}

export function groveExtensionProvenanceChanged(
  current: PersistedClawPackageRef["extension"],
  target: GroveAddPlanAction | undefined,
): boolean {
  return stableStringify(current ?? null) !== stableStringify(target?.details?.extension ?? null);
}
