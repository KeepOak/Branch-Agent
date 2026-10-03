import { listAgentIds, resolveAgentDir, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { BranchConfig } from "../config/types.branch.js";

export type MemoryDoctorAgentScope = {
  agentId: string;
  agentDir: string;
  workspaceDir: string;
};

export function resolveMemoryDoctorAgentScopes(cfg: BranchConfig): MemoryDoctorAgentScope[] {
  return listAgentIds(cfg).map((agentId) => ({
    agentId,
    agentDir: resolveAgentDir(cfg, agentId),
    workspaceDir: resolveAgentWorkspaceDir(cfg, agentId),
  }));
}

export function formatMemoryDoctorAgentMessage(
  agentId: string,
  labelAgent: boolean,
  message: string,
): string {
  return `${labelAgent ? `Agent "${agentId}": ` : ""}${message}`;
}
