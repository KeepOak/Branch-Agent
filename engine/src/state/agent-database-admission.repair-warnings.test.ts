import { describe, expect, it } from "vitest";
import {
  agentDatabaseRefusalsNeedingRepair,
  createAgentDatabaseInspectionRefusal,
  type AgentDatabaseAdmissionRefusal,
} from "./agent-database-admission.js";

const reason = "Agent main has not completed startup inspection and preparation.";

describe("agentDatabaseRefusalsNeedingRepair (#1971)", () => {
  it("leaves out an inspection that is still finishing in the background", () => {
    const pending = createAgentDatabaseInspectionRefusal({
      agentId: "main",
      paths: [],
      reason,
      pending: true,
    });
    const retrying: AgentDatabaseAdmissionRefusal = {
      ...pending,
      preparation: { state: "retrying", failures: 1, restarts: 0 },
    };
    expect(agentDatabaseRefusalsNeedingRepair([pending, retrying])).toEqual([]);
  });

  it("keeps refusals that need a repair", () => {
    const failed = createAgentDatabaseInspectionRefusal({
      agentId: "a",
      paths: [],
      reason: "corrupt",
    });
    const stuck: AgentDatabaseAdmissionRefusal = {
      ...createAgentDatabaseInspectionRefusal({ agentId: "b", paths: [], reason, pending: true }),
      preparation: { state: "needs-attention", failures: 5, restarts: 1 },
    };
    const mismatch: AgentDatabaseAdmissionRefusal = {
      agentId: "c",
      paths: [],
      reason: "owned by another agent",
      repairHint: "Run doctor.",
      code: "agent-database-ownership-mismatch",
      embeddedOwnerId: "d",
    };
    expect(agentDatabaseRefusalsNeedingRepair([failed, stuck, mismatch])).toEqual([
      failed,
      stuck,
      mismatch,
    ]);
  });
});
