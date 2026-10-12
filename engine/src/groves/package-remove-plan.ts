import { digestGroveValue } from "./digest.js";
import {
  clawPackageRemovalSelector,
  type ClawPackageInspection,
  type ClawPackageRemovalDecision,
  type GroveReferencedCleanup,
} from "./package-remove.js";
import type { PersistedGroveInstall } from "./provenance.js";

export function orderClawPackageRemovals(decisions: ClawPackageRemovalDecision[]) {
  return decisions.toSorted(
    (left, right) =>
      Number(left.packageRef.relationship === "referenced") -
      Number(right.packageRef.relationship === "referenced"),
  );
}

/** Omitted cleanup options and their defaults must have the same identity across JSON RPC. */
export function normalizeClawPackageCleanup(cleanup?: GroveReferencedCleanup) {
  return {
    mode: cleanup?.mode ?? "retain",
    selected: [...(cleanup?.selected ?? [])],
    allowConflicts: cleanup?.allowConflicts === true,
  };
}

export function digestClawPackageRemovalPlan(
  decisions: ClawPackageRemovalDecision[],
  cleanup: GroveReferencedCleanup,
): string {
  return digestGroveValue({
    decisions: orderClawPackageRemovals(decisions),
    cleanup: normalizeClawPackageCleanup(cleanup),
  });
}

export function digestGroveRemovalInstall(install: PersistedGroveInstall | undefined): string {
  return digestGroveValue(install ?? null);
}

type PackageRemoveAction = {
  kind: "packageRef";
  id: string;
  action: "release" | "uninstall";
  target: string;
  blocked: boolean;
  reason?: string;
  details: Record<string, unknown>;
};

type PackageRemoveBlocker = { code: string; message: string };

export function filterReferencedCleanup(
  cleanup: GroveReferencedCleanup | undefined,
  kind: "package" | "mcp",
): GroveReferencedCleanup | undefined {
  return cleanup
    ? {
        ...cleanup,
        selected: (cleanup.selected ?? []).filter(
          (selector) => selector.startsWith("mcp:") === (kind === "mcp"),
        ),
      }
    : undefined;
}

export function projectClawPackageRemovePlan(params: {
  decisions: ClawPackageRemovalDecision[];
  inspections: ClawPackageInspection[];
  cleanup?: GroveReferencedCleanup;
}): { actions: PackageRemoveAction[]; blockers: PackageRemoveBlocker[] } {
  const selected = new Set(params.cleanup?.selected ?? []);
  const blockers: PackageRemoveBlocker[] = [];
  const actions = params.decisions.map((decision): PackageRemoveAction => {
    const pkg = decision.packageRef;
    const selector = clawPackageRemovalSelector(pkg);
    selected.delete(selector);
    if (decision.blocked) {
      blockers.push({
        code: "referenced_cleanup_requires_override",
        message: `${selector}: ${decision.reason ?? "explicit conflict override is required"}`,
      });
    }
    const inspected = params.inspections.find(
      (candidate) =>
        candidate.kind === pkg.kind &&
        candidate.source === pkg.source &&
        candidate.ref === pkg.ref &&
        candidate.version === pkg.version,
    );
    return {
      kind: "packageRef",
      id: selector,
      action: decision.action === "uninstall" ? "uninstall" : "release",
      target: `${pkg.source}:${pkg.ref}@${pkg.version}`,
      blocked: Boolean(decision.blocked),
      details: {
        expectedState: inspected?.state ?? "incomplete",
        status: pkg.status,
        relationship: pkg.relationship,
        origin: pkg.origin,
        introducedByGroveAdd: pkg.origin === "grove-introduced",
        independentOwner: pkg.independentOwner,
        affectedGroveAgentIds: decision.affectedGroveAgentIds,
        cleanupMode: params.cleanup?.mode ?? "retain",
        availableCleanupModes:
          pkg.relationship === "referenced"
            ? ["retain", "remove-if-unused", "remove-selected"]
            : ["remove"],
      },
      ...(decision.reason ? { reason: decision.reason } : {}),
    };
  });
  for (const selector of selected) {
    blockers.push({
      code: "referenced_cleanup_not_found",
      message: `Selected referenced resource ${JSON.stringify(selector)} is not owned by this Grove.`,
    });
  }
  return { actions, blockers };
}
