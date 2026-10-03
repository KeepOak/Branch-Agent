import { realpathSync } from "node:fs";
import { listAgentEntries, resolveAgentWorkspaceDir } from "../agents/agent-scope-config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { digestGroveValue } from "./digest.js";
import { normalizeWorkspaceConfig, resolveMigrationAgentSettings } from "./migrate-validation.js";

export type GroveToolPolicyCandidate = {
  agentId: string;
  agentConfigDigest: string;
  adoptedAgentConfigDigest: (env?: NodeJS.ProcessEnv) => string;
  tools: object;
};

export function collectGroveToolPolicyCandidates(config: BranchConfig): GroveToolPolicyCandidate[] {
  return listAgentEntries(config).flatMap((agent) => {
    const tools = agent.tools;
    if (!tools || (!tools.profile && !tools.allow?.length)) {
      return [];
    }
    let adoptedDigest: string | undefined;
    return [
      {
        agentId: agent.id,
        agentConfigDigest: digestGroveValue(agent),
        // Adoption binds effective settings and the canonical workspace without
        // rewriting the authored config. Resolve only for known adopted owners,
        // once per prepared candidate, rather than on each tool-policy lookup.
        adoptedAgentConfigDigest: (env) =>
          (adoptedDigest ??= digestGroveValue(
            normalizeWorkspaceConfig(
              resolveMigrationAgentSettings(config, agent),
              realpathSync(resolveAgentWorkspaceDir(config, agent.id, env)),
            ),
          )),
        tools,
      },
    ];
  });
}
