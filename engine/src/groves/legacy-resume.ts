import { toAgentEntriesRecord } from "../agents/agent-scope.js";
import type { AgentConfig, BranchConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { PersistedGroveInstall } from "./provenance.js";
import type { GroveAddPlan } from "./types.js";

export function replaceLegacyCommittedAgent(params: {
  config: BranchConfig;
  agents: AgentConfig[];
  normalizedAgentId: string;
  plan: GroveAddPlan;
  resumePlan?: GroveAddPlan;
  resumeRecord?: PersistedGroveInstall;
  matchesPlan: (agent: AgentConfig, plan: GroveAddPlan) => boolean;
}): BranchConfig | undefined {
  if (
    !params.resumePlan ||
    params.resumeRecord?.schemaVersion !== "branch.groveInstallRecord.v1" ||
    params.resumeRecord.status === "complete"
  ) {
    return undefined;
  }
  const existingAgent = params.agents.find(
    (agent) => normalizeAgentId(agent.id) === params.normalizedAgentId,
  );
  if (!existingAgent || !params.matchesPlan(existingAgent, params.resumePlan)) {
    return undefined;
  }
  return {
    ...params.config,
    agents: {
      ...params.config.agents,
      entries: toAgentEntriesRecord(
        params.agents.map((agent) =>
          normalizeAgentId(agent.id) === params.normalizedAgentId
            ? params.plan.agent.config
            : agent,
        ),
      ),
    },
  };
}
