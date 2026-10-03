import { tryResolveAmbientOwnerAgentId } from "../agents/agent-scope-config.js";
import type { BranchConfig } from "../config/types.branch.js";

export function tryResolveAmbientHeartbeatAgentId(cfg: BranchConfig): string | undefined {
  return tryResolveAmbientOwnerAgentId(cfg, cfg.agents?.defaults?.heartbeat?.agentId);
}
