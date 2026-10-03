import { stableStringify } from "@branch/normalization-core";
import type { AgentConfig } from "../config/types.agents.js";
import type { GroveInstallStatus } from "./provenance.js";
import type { GroveAddPlan } from "./types.js";

export function planWithPackageActions(
  plan: GroveAddPlan,
  predicate: (action: GroveAddPlan["actions"][number]) => boolean,
): GroveAddPlan {
  return {
    ...plan,
    actions: plan.actions.filter((action) => action.kind !== "package" || predicate(action)),
  };
}

export function statusAtLeast(status: GroveInstallStatus, phase: GroveInstallStatus): boolean {
  const order: Record<GroveInstallStatus, number> = {
    pending: 0,
    partial: 0,
    workspace_ready: 1,
    config_committed: 2,
    complete: 3,
  };
  return order[status] >= order[phase];
}

export function sameCommittedAgent(existingAgent: AgentConfig, plan: GroveAddPlan): boolean {
  return stableStringify(existingAgent) === stableStringify(plan.agent.config);
}
