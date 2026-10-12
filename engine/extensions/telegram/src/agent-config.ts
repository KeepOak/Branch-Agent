import { resolveAgentConfig } from "branch/plugin-sdk/agent-scope-runtime";
import type { BranchConfig } from "branch/plugin-sdk/config-contracts";

export function resolveTelegramConfigReasoningDefault(cfg: BranchConfig, agentId: string) {
  const agentDefault = resolveAgentConfig(cfg, agentId)?.reasoningDefault;
  return agentDefault ?? cfg.agents?.defaults?.reasoningDefault ?? "off";
}
