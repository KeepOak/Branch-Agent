import { isQueueEligibleTrunk } from "../agents/trunk-queue-policy.js";
import type { BranchConfig } from "../config/types.branch.js";
import type { HeartbeatWakeSource } from "./heartbeat-wake.js";

export type IdleTrunkWakeCheck = {
  cfg: BranchConfig;
  agentId: string;
  source?: HeartbeatWakeSource;
  scheduledTaskCount: number;
  pendingEventCount: number;
};

/**
 * An interval tick, from the scheduler or a persisted monitor cron, for a queue-eligible
 * Trunk with no scheduled task and no pending event. Queue jobs are picked up by the trunk
 * queue itself, so the periodic poll has no work to carry. Skipping it costs no model turn.
 */
export function isIdleQueueTrunkWake(check: IdleTrunkWakeCheck): boolean {
  return (
    check.source === "interval" &&
    check.scheduledTaskCount === 0 &&
    check.pendingEventCount === 0 &&
    isQueueEligibleTrunk(check.agentId, check.cfg)
  );
}
