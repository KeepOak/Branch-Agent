import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import type { AgentDatabaseAdmissionRefusal } from "../state/agent-database-admission.js";
import { resolveDoctorContributionHealthChecks } from "./doctor-health-contributions.js";

const pending = (
  agentId: string,
  preparation?: AgentDatabaseAdmissionRefusal["preparation"],
): AgentDatabaseAdmissionRefusal => ({
  agentId,
  paths: [`/state/agents/${agentId}/agent/branch-agent.sqlite`],
  code: "agent-database-inspection-pending",
  reason: `Agent ${agentId} has not completed startup inspection and preparation.`,
  repairHint: "Sessions remain unavailable until background inspection and preparation finish.",
  ...(preparation ? { preparation } : {}),
});

async function detect(agentDatabaseRefusals: readonly AgentDatabaseAdmissionRefusal[]) {
  const checks = (await resolveDoctorContributionHealthChecks()).filter(
    (check) => check.id === "core/doctor/agent-database-admission",
  );
  const context = {
    mode: "doctor" as const,
    cfg: {} as BranchConfig,
    env: {},
    runtime: { log: vi.fn(), error: vi.fn(), exit: vi.fn() },
    agentDatabaseRefusals,
  };
  return (await Promise.all(checks.map((check) => check.detect(context)))).flat();
}

describe("doctor agent database admission check", () => {
  it("does not warn about inspections that are still finishing on their own", async () => {
    expect(
      await detect([
        pending("main"),
        pending("ops", { state: "retrying", failures: 1, restarts: 0 }),
      ]),
    ).toEqual([]);
  });

  it("still warns about refusals that need a repair", async () => {
    const findings = await detect([
      pending("main"),
      pending("ops", { state: "needs-attention", failures: 5, restarts: 1 }),
      {
        agentId: "worker",
        paths: ["/state/agents/worker/agent/branch-agent.sqlite"],
        code: "agent-database-inspection-failed",
        reason: "Agent worker inspection failed.",
        repairHint: 'Run "branch doctor --fix".',
      },
    ]);
    expect(findings.map((finding) => [finding.target, finding.requirement])).toEqual([
      ["ops", "agent-database-inspection-pending"],
      ["worker", "agent-database-inspection-failed"],
    ]);
    expect(findings.every((finding) => finding.severity === "warning")).toBe(true);
  });
});
