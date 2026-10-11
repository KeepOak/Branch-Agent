import { describe, expect, it } from "vitest";
import { applyTeamProposal, type TeamApplyDeps } from "./trunk-team-apply.js";
import { buildTeamProposal, type TeamProposal } from "./trunk-team.js";

function proposal(): TeamProposal {
  const result = buildTeamProposal({
    goal: "Ship the Q3 newsletter",
    models: ["anthropic/claude-sonnet"],
    machines: ["this"],
  });
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.proposal;
}

/** An in-memory world the apply step writes into, so a second run can see the first run's effects. */
function world() {
  const agents = new Set<string>();
  const rooms = new Set<string>();
  const jobs = new Set<string>();
  const log: string[] = [];
  const deps: TeamApplyDeps = {
    hasAgent: (id) => agents.has(id),
    createAgent: async (member) => {
      log.push(`agent:${member.agentId}`);
      agents.add(member.agentId);
    },
    hasRoom: (id) => rooms.has(id),
    createRoom: (input) => {
      log.push(`room:${input.roomId}`);
      rooms.add(input.roomId);
    },
    hasJob: (brief) => jobs.has(brief),
    addJob: (input) => {
      log.push(`job:${input.title}`);
      jobs.add(input.brief_text);
    },
  };
  return { deps, log, agents, rooms, jobs };
}

describe("applyTeamProposal", () => {
  it("creates the Trunks, then the room, then the first jobs, in that order", async () => {
    const { deps, log } = world();
    const team = proposal();
    const result = await applyTeamProposal(team, deps);

    expect(log.map((entry) => entry.split(":")[0])).toEqual([
      "agent",
      "agent",
      "agent",
      "room",
      "job",
      "job",
      "job",
    ]);
    expect(result.created).toHaveLength(7);
    expect(result.skipped).toEqual([]);
  });

  it("does nothing the second time the same approved team is applied", async () => {
    const { deps, log } = world();
    const team = proposal();
    await applyTeamProposal(team, deps);
    const before = log.length;

    const second = await applyTeamProposal(team, deps);

    expect(log).toHaveLength(before);
    expect(second.created).toEqual([]);
    expect(second.skipped).toHaveLength(7);
  });
});
