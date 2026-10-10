import { isQueueEligibleTrunk } from "../agents/trunk-queue-policy.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { HeartbeatWakeSource } from "./heartbeat-wake.js";

export type IdleTrunkWakeCheck = {
  cfg: BranchConfig;
  agentId: string;
  source?: HeartbeatWakeSource;
  scheduledTaskCount: number;
  pendingEventCount: number;
  authoritativeScheduledTick: boolean;
};

/**
 * A plain interval tick for a queue-eligible Trunk with nothing to act on. Queue jobs are
 * picked up by the trunk queue itself, so the periodic poll has no work to carry. Skipping
 * it costs no model turn.
 */
export function isIdleQueueTrunkWake(check: IdleTrunkWakeCheck): boolean {
  return (
    check.source === "interval" &&
    check.scheduledTaskCount === 0 &&
    check.pendingEventCount === 0 &&
    !check.authoritativeScheduledTick &&
    isQueueEligibleTrunk(check.agentId, check.cfg)
  );
}
