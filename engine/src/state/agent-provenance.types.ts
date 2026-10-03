export type AgentCreatedVia = "operator" | "agent" | "grove";

export type AgentProvenance = {
  agentId: string;
  createdVia: AgentCreatedVia;
  creatorAgentId: string | null;
  createdAtMs: number;
};
