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

/** A Trunk whose startup stopped retrying after repeated failed starts cannot take a job until it is started again. */
export function isTrunkStartupStalled(row: Record<string, unknown>): boolean {
  const refusal = row.admissionRefusal;
  if (!refusal || typeof refusal !== "object") {
    return false;
  }
  const preparation = (refusal as Record<string, unknown>).preparation;
  return (
    Boolean(preparation) &&
    typeof preparation === "object" &&
    (preparation as Record<string, unknown>).state === "needs-attention"
  );
}

/** A Trunk still retrying its startup cannot answer a session query yet, so it gets no pickup until it is ready. */
export function isTrunkStartupPending(row: Record<string, unknown>): boolean {
  const refusal = row.admissionRefusal;
  if (!refusal || typeof refusal !== "object") {
    return false;
  }
  return Boolean((refusal as Record<string, unknown>).preparation);
}
