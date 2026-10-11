import { describe, expect, it } from "vitest";
import { rolesOf, teamFromToolText } from "./team-proposal";

const payload = {
  proposal: {
    teamId: "2d60428e",
    goal: "Ship the Q3 newsletter",
    hash: "h1",
    roomId: "team-2d60428e",
    members: [
      {
        agentId: "builder-researcher-2d60428e",
        name: "Builder Researcher",
        role: "Researcher",
        job: "Find topics.",
        machine: "this",
        model: "anthropic/claude-sonnet",
      },
    ],
  },
  choices: { models: ["anthropic/claude-sonnet"], machines: ["this"] },
};

describe("teamFromToolText", () => {
  it("reads a proposal and its choices from the tool result text", () => {
    const team = teamFromToolText(JSON.stringify(payload));
    expect(team?.proposal.members[0]?.role).toBe("Researcher");
    expect(team?.choices.machines).toEqual(["this"]);
  });

  it("returns nothing for text that is not a proposal", () => {
    expect(teamFromToolText("not json")).toBeUndefined();
    expect(teamFromToolText(JSON.stringify({ ok: true }))).toBeUndefined();
    expect(
      teamFromToolText(JSON.stringify({ proposal: { teamId: "x", members: [] } })),
    ).toBeUndefined();
  });

  it("hands the roles back in the shape the propose method takes", () => {
    const team = teamFromToolText(JSON.stringify(payload));
    expect(rolesOf(team?.proposal.members ?? [])).toEqual([
      {
        name: "Researcher",
        job: "Find topics.",
        machine: "this",
        model: "anthropic/claude-sonnet",
      },
    ]);
  });
});
