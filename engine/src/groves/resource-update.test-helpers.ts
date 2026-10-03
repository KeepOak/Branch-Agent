import { GROVE_OUTPUT_STABILITY } from "./types.js";
import { GROVE_UPDATE_PLAN_SCHEMA_VERSION, type GroveUpdatePlan } from "./update-plan-types.js";

export function createGroveUpdatePlanFixture(actions: GroveUpdatePlan["actions"]): GroveUpdatePlan {
  return {
    schemaVersion: GROVE_UPDATE_PLAN_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    dryRun: true,
    mutationAllowed: false,
    planIntegrity: "sha256:update-plan",
    found: true,
    agentId: "worker",
    currentGrove: { name: "@acme/worker", version: "1.0.0", integrity: "sha256:old" },
    targetGrove: { name: "@acme/worker", version: "2.0.0", integrity: "sha256:new" },
    summary: {
      totalActions: actions.length,
      added: actions.filter((action) => action.action === "add").length,
      changed: actions.filter((action) => action.action === "change").length,
      removed: actions.filter((action) => action.action === "remove").length,
      released: actions.filter((action) => action.action === "release").length,
      unchanged: 0,
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
