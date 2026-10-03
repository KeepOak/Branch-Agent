import type { GroveUpdateCapabilityChange } from "./update-capability-changes.js";
import type { GroveUpdateAction, GroveUpdatePlan } from "./update-plan-types.js";

export function summarizeGroveUpdatePlan(
  actions: GroveUpdateAction[],
  capabilityChanges: GroveUpdateCapabilityChange[],
): GroveUpdatePlan["summary"] {
  return {
    totalActions: actions.length,
    added: actions.filter((action) => action.action === "add").length,
    changed: actions.filter((action) => action.action === "change").length,
    removed: actions.filter((action) => action.action === "remove").length,
    released: actions.filter((action) => action.action === "release").length,
    unchanged: actions.filter((action) => action.action === "unchanged").length,
    manual: actions.filter((action) => action.action === "manual").length,
    blocked: actions.filter((action) => action.blocked).length,
    capabilityChanges: capabilityChanges.length,
    capabilityEscalations: capabilityChanges.filter((change) => change.requiresDistinctConsent)
      .length,
  };
}
