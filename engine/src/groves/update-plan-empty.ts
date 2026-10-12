import { digestGroveValue } from "./digest.js";
import { GROVE_OUTPUT_STABILITY, type ClawDiagnostic, type GroveSourceIdentity } from "./types.js";
import { summarizeGroveUpdatePlan } from "./update-plan-summary.js";
import { GROVE_UPDATE_PLAN_SCHEMA_VERSION, type GroveUpdatePlan } from "./update-plan-types.js";

export function makeEmptyGroveUpdatePlan(params: {
  agentId: string;
  source?: GroveSourceIdentity;
  currentGrove?: GroveUpdatePlan["currentGrove"];
  found?: boolean;
  blockers: ClawDiagnostic[];
  diagnostics?: ClawDiagnostic[];
}): GroveUpdatePlan {
  const plan: Omit<GroveUpdatePlan, "planIntegrity"> = {
    schemaVersion: GROVE_UPDATE_PLAN_SCHEMA_VERSION,
    stability: GROVE_OUTPUT_STABILITY,
    dryRun: true,
    mutationAllowed: false,
    found: params.found ?? false,
    agentId: params.agentId,
    ...(params.currentGrove ? { currentGrove: params.currentGrove } : {}),
    ...(params.source
      ? {
          targetGrove: {
            name: params.source.name,
            version: params.source.version,
            integrity: params.source.integrity,
          },
        }
      : {}),
    summary: summarizeGroveUpdatePlan([], []),
    actions: [],
    capabilityChanges: [],
    readiness: { ready: true, requirements: [] },
    blockers: params.blockers,
    diagnostics: params.diagnostics ?? [],
  };
  return { ...plan, planIntegrity: digestGroveValue(plan) };
}
