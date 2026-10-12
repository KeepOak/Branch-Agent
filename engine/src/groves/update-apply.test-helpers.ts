import type { PersistedGroveInstall } from "./provenance.js";
import type { GroveAddPlan, GroveManifest, GroveSourceIdentity } from "./types.js";
import type { GroveUpdatePlan } from "./update-plan.js";

export const source: GroveSourceIdentity = {
  kind: "package",
  name: "@acme/worker",
  version: "2.0.0",
  packageRoot: "/tmp/target",
  manifestPath: "/tmp/target/branch.grove.json",
  integrityKind: "artifact",
  integrity: "sha256:target",
  byteLength: 1,
};
export const manifest: GroveManifest = {
  schemaVersion: 1,
  agent: { id: "worker", name: "Worker v2" },
  workspace: { bootstrapFiles: {}, files: [] },
  packages: [],
  mcpServers: {},
  cronJobs: [],
};
export const install: PersistedGroveInstall = {
  schemaVersion: "branch.groveInstallRecord.v1",
  grove: { ...source, version: "1.0.0", integrity: "sha256:current" },
  manifestSchemaVersion: 1,
  planIntegrity: "sha256:current-add-plan",
  agentId: "worker",
  workspace: "/tmp/workspace-worker",
  agentConfigDigest: "sha256:current-agent",
  agentOrigin: "created",
  agentOwnedPaths: ['agents.entries["worker"]'],
  status: "complete",
  addedAtMs: 1,
  updatedAtMs: 1,
};
export const addPlan: GroveAddPlan = {
  schemaVersion: "branch.groveAddPlan.v1",
  stability: "experimental",
  dryRun: true,
  mutationAllowed: false,
  manifestSchemaVersion: 1,
  planIntegrity: "sha256:target-add-plan",
  grove: source,
  agent: {
    requestedId: "worker",
    finalId: "worker",
    workspace: "/tmp/workspace-worker",
    config: { id: "worker", name: "Worker v2", workspace: "/tmp/workspace-worker" },
  },
  summary: {
    totalActions: 1,
    agentActions: 1,
    workspaceActions: 0,
    packageActions: 0,
    mcpServerActions: 0,
    cronJobActions: 0,
    blockedActions: 0,
    capabilityEscalations: 0,
  },
  actions: [],
  capabilityChanges: [],
  blockers: [],
  diagnostics: [],
  readiness: { ready: true, requirements: [] },
};

export function plan(actions: GroveUpdatePlan["actions"]): GroveUpdatePlan {
  return {
    schemaVersion: "branch.groveUpdatePlan.v1",
    stability: "experimental",
    dryRun: true,
    mutationAllowed: false,
    planIntegrity: "sha256:update-plan",
    found: true,
    agentId: "worker",
    currentGrove: { name: "@acme/worker", version: "1.0.0", integrity: "sha256:current" },
    targetGrove: { name: "@acme/worker", version: "2.0.0", integrity: "sha256:target" },
    summary: {
      totalActions: actions.length,
      added: 0,
      changed: actions.filter((action) => action.action === "change").length,
      removed: 0,
      released: 0,
      unchanged: actions.filter((action) => action.action === "unchanged").length,
      manual: 0,
      blocked: actions.filter((action) => action.blocked).length,
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

export function consent(updatePlan: GroveUpdatePlan) {
  return {
    sourceMcpServers: {},
    consentPlanIntegrity: updatePlan.planIntegrity,
  };
}
