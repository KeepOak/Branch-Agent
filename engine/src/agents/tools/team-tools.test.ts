import { describe, expect, it, vi } from "vitest";
import { createTeamProposeTool } from "./team-tools.js";

describe("team_propose", () => {
  it("sends the drafted roles to the propose method and creates nothing", async () => {
    const callGateway = vi.fn(async () => ({ ok: true, proposal: { teamId: "abc" } }));
    const tool = createTeamProposeTool({ callGateway } as never);

    const result = await tool.execute("call-1", {
      goal: "Ship the Q3 newsletter",
      roles: [{ name: "Researcher", job: "Find topics." }],
    } as never);

    expect(callGateway).toHaveBeenCalledTimes(1);
    expect(callGateway.mock.calls[0]?.[0]).toMatchObject({
      method: "trunks.team.propose",
      params: {
        goal: "Ship the Q3 newsletter",
        roles: [{ name: "Researcher", job: "Find topics." }],
      },
    });
    expect(result).toBeDefined();
  });

  it("sends only the goal when no roles are drafted, so the fixed team is used", async () => {
    const callGateway = vi.fn(async () => ({}));
    const tool = createTeamProposeTool({ callGateway } as never);

    await tool.execute("call-2", { goal: "Ship it" } as never);

    expect(callGateway.mock.calls[0]?.[0]).toMatchObject({ params: { goal: "Ship it" } });
    expect(callGateway.mock.calls[0]?.[0]?.params).not.toHaveProperty("roles");
  });
});
