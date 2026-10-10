import { resolveAgentMainSessionKey } from "../../config/sessions/main-session.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { requestSignalWake } from "../heartbeat-wake.js";
import { withSystemEventOwner } from "../system-event-ownership.js";
import { enqueueSystemEvent } from "../system-events.js";
import type { SignalDecision } from "./signal-wake-decide.js";

/** Queues the signal on the Trunk's main session, then wakes that Trunk once if the event was new. */
export function dispatchSignalWake(cfg: BranchConfig, signal: SignalDecision): void {
  const agentId = signal.trunkId;
  const sessionKey = resolveAgentMainSessionKey({ cfg, agentId });
  const queued = enqueueSystemEvent(
    signal.text,
    withSystemEventOwner({ sessionKey, contextKey: signal.contextKey, replace: true }, agentId),
  );
  if (!queued) {
    return;
  }
  requestSignalWake({
    source: "signal",
    intent: "immediate",
    reason: signal.reason,
    agentId,
    sessionKey,
  });
}
