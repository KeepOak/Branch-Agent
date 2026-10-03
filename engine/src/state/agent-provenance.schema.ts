import { createBranchStateSchemaEnsurer } from "./branch-state-feature-schema.js";

export const ensureAgentProvenanceSchema = createBranchStateSchemaEnsurer({
  table: "agent_provenance",
  operationLabel: "agent-provenance.schema.ensure",
});
