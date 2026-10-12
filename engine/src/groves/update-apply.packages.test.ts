import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type {
  GroveBranchProfile,
  ClawPackage,
  ClawPackagePreflight,
  GroveSourceIdentity,
} from "./types.js";
import { applyGroveUpdatePlan } from "./update-apply.js";
import { install, manifest, source } from "./update-apply.test-helpers.js";
import type { GroveUpdateAction, GroveUpdatePlan } from "./update-plan.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const weatherPackage: ClawPackage = {
  kind: "skill",
  source: "clawhub",
  ref: "@acme/weather",
  version: "1.0.0",
};

function plan(actions: GroveUpdateAction[]): GroveUpdatePlan {
  return {
    schemaVersion: "branch.groveUpdatePlan.v1",
    stability: "experimental",
    dryRun: true,
    mutationAllowed: false,
    planIntegrity: "sha256:update-plan",
    found: true,
    agentId: "worker",
    currentGrove: { name: source.name, version: "1.0.0", integrity: "sha256:current" },
    targetGrove: { name: source.name, version: source.version, integrity: source.integrity },
    summary: {
      totalActions: actions.length,
      added: actions.filter((action) => action.action === "add").length,
      changed: 0,
      removed: 0,
      released: 0,
      unchanged: actions.filter((action) => action.action === "unchanged").length,
      manual: 0,
      blocked: 0,
      capabilityChanges: 0,
      capabilityEscalations: 0,
    },
    actions,
    capabilityChanges: [],
    readiness: { ready: true, requirements: [] },
    blockers: [],
    diagnostics: [],
  };
}

function unchanged(id = "skill:@acme/weather"): GroveUpdateAction {
  return {
    kind: "package",
    id,
    action: "unchanged",
    target: "clawhub:@acme/weather@1.0.0",
    blocked: false,
    reason: "Recorded package reference already matches the exact target version.",
    currentDigest: "sha256:current-package",
    desiredDigest: "sha256:target-package",
  };
}

function targetSource(): GroveSourceIdentity {
  const packageRoot = tempDirs.make("branch-grove-update-package-");
  return {
    ...source,
    packageRoot,
    manifestPath: join(packageRoot, "branch.grove.json"),
  };
}

function options(updatePlan: GroveUpdatePlan, packagePreflight: ClawPackagePreflight) {
  return {
    config: {},
    sourceMcpServers: {},
    consentPlanIntegrity: updatePlan.planIntegrity,
    rebuildPlan: vi.fn(async () => updatePlan),
    readInstall: vi.fn(() => install),
    packagePreflight,
  };
}

describe("applyGroveUpdatePlan package compatibility", () => {
  it("does not rematerialize an unchanged Grove-owned skill during apply", async () => {
    const updatePlan = plan([unchanged()]);
    const applyPackage = vi.fn(async () => ({
      appliedIds: [],
      rollback: vi.fn(async () => undefined),
    }));
    const result = await applyGroveUpdatePlan(
      updatePlan,
      {
        targetManifest: { ...manifest, packages: [weatherPackage] },
        targetSource: targetSource(),
      },
      {
        ...options(
          updatePlan,
          vi.fn(async () => ({
            ok: false,
            code: "skill_version_conflict",
            message: "The already installed skill cannot be added again.",
          })),
        ),
        applyWorkspace: vi.fn(async () => ({
          appliedPaths: [],
          rollback: vi.fn(async () => undefined),
        })),
        applyMcp: vi.fn(async () => ({
          appliedNames: [],
          rollback: vi.fn(async () => undefined),
        })),
        applyCron: vi.fn(async () => ({
          appliedIds: [],
          rollback: vi.fn(async () => undefined),
        })),
        applyPackage,
        persistInstall: vi.fn(() => ({ ...install, grove: source })),
      },
    );

    expect(result.status).toBe("complete");
    expect(result.appliedActions).toEqual([]);
    expect(applyPackage).not.toHaveBeenCalled();
  });

  it("keeps package blockers for mutations when another package is unchanged", async () => {
    const alertsPackage: ClawPackage = {
      kind: "skill",
      source: "clawhub",
      ref: "@acme/alerts",
      version: "1.0.0",
    };
    const updatePlan = plan([
      unchanged(),
      {
        kind: "package",
        id: "skill:@acme/alerts",
        action: "add",
        target: "clawhub:@acme/alerts@1.0.0",
        blocked: false,
        reason: "The target adds a skill.",
        desiredDigest: "sha256:target-alerts",
      },
    ]);

    await expect(
      applyGroveUpdatePlan(
        updatePlan,
        {
          targetManifest: { ...manifest, packages: [weatherPackage, alertsPackage] },
          targetSource: targetSource(),
        },
        options(
          updatePlan,
          vi.fn(async (pkg) => ({
            ok: false,
            code: "skill_version_conflict",
            message: `${pkg.ref} cannot be materialized.`,
          })),
        ),
      ),
    ).rejects.toMatchObject({ code: "update_target_blocked" });
  });

  it("rejects an unchanged package that disappears after planning", async () => {
    const updatePlan = plan([unchanged()]);
    await expect(
      applyGroveUpdatePlan(
        updatePlan,
        {
          targetManifest: { ...manifest, packages: [weatherPackage] },
          targetSource: targetSource(),
        },
        options(
          updatePlan,
          vi.fn(async () => ({
            ok: true,
            action: "install" as const,
            integrity: "sha256:resolved-package",
            installId: "@acme/weather",
          })),
        ),
      ),
    ).rejects.toMatchObject({ code: "update_changed" });
  });

  it("keeps provenance blockers for unchanged profile extensions", async () => {
    const targetBranchProfile: GroveBranchProfile = {
      schemaVersion: 1,
      agent: {},
      extensions: [
        {
          id: "weather",
          kind: "plugin",
          format: "branch",
          source: "clawhub",
          ref: "@acme/weather",
          version: "1.0.0",
        },
      ],
    };
    const updatePlan = plan([unchanged("plugin:@acme/weather")]);

    await expect(
      applyGroveUpdatePlan(
        updatePlan,
        {
          targetManifest: manifest,
          targetBranchProfile,
          targetSource: targetSource(),
        },
        options(
          updatePlan,
          vi.fn(async () => ({ ok: true, action: "reuse" as const })),
        ),
      ),
    ).rejects.toMatchObject({ code: "update_target_blocked" });
  });
});
