import path from "node:path";
import { resolveAgentDir } from "../../agents/agent-scope-config.js";
import type { BranchConfig } from "../../config/types.branch.js";

const BACKUP_REL_DIR = path.join("skill-workshop", "collection-backups");

export function resolveSkillCollectionBackupRoot(
  config: BranchConfig,
  agentId: string,
  env?: NodeJS.ProcessEnv,
): string {
  return path.join(resolveAgentDir(config, agentId, env), BACKUP_REL_DIR);
}

/** Separate from retained v2 collection backups, whose latest-manifest contract stays unchanged. */
export function resolveSkillLifecycleBackupRoot(
  config: BranchConfig,
  agentId: string,
  env?: NodeJS.ProcessEnv,
) {
  return path.join(resolveAgentDir(config, agentId, env), "skill-workshop", "lifecycle-backups");
}
