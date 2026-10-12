import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope-config.js";
import type { BranchConfig } from "../../config/types.branch.js";

export function resolveWorkshopSkillsDir(
  config: BranchConfig,
  agentId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveAgentDir(config, agentId, env), "workshop-skills");
}

export function resolveWorkshopWatchRoots(config?: BranchConfig, agentId?: string) {
  return config && agentId
    ? [{ path: resolveWorkshopSkillsDir(config, agentId), source: "branch-workshop" }]
    : [];
}
