import type { BranchConfig } from "../config/types.branch.js";

/** Builder Trunks are named builder-<name>; they take queued jobs by default. */
const BUILDER_TRUNK_PREFIX = "builder-";

/** Automatic queue pickup is on unless agents.trunkQueue.enabled is false. */
export function isTrunkQueuePickupOn(cfg: BranchConfig | undefined): boolean {
  return cfg?.agents?.trunkQueue?.enabled !== false;
}

/** A Trunk may take queued jobs when pickup is on and it is listed, or, unlisted, when it is a builder. */
export function isQueueEligibleTrunk(agentId: string, cfg: BranchConfig | undefined): boolean {
  if (!isTrunkQueuePickupOn(cfg)) {
    return false;
  }
  const listed = cfg?.agents?.trunkQueue?.agents;
  if (listed) {
    return listed.includes(agentId);
  }
  return agentId.startsWith(BUILDER_TRUNK_PREFIX);
}
