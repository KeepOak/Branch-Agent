import { describe, expect, it } from "vitest";
import { teamOfJob } from "./trunk-team-progress.js";
import { buildTeamProposal, describeTeamProposal, teamIdFor } from "./trunk-team.js";

const base = {
  goal: "Ship the Q3 newsletter",
  models: ["anthropic/claude-sonnet"],
  machines: ["this"],
};

describe("buildTeamProposal", () => {
  it("builds three builder Trunks that the queue already treats as eligible", () => {
    const result = buildTeamProposal(base);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const ids = result.proposal.members.map((member) => member.agentId);
    expect(ids).toHaveLength(3);
    for (const id of ids) {
      expect(id.startsWith("builder-")).toBe(true);
    }
    expect(result.proposal.members.map((member) => member.name)).toEqual([
      "Builder Scout",
      "Builder Writer",
      "Builder Checker",
    ]);
  });

  it("uses only the configured model and spreads members over the available computers", () => {
    const result = buildTeamProposal({ ...base, machines: ["this", "node-a"] });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.proposal.members.map((member) => member.model)).toEqual([
      "anthropic/claude-sonnet",
      "anthropic/claude-sonnet",
      "anthropic/claude-sonnet",
    ]);
    expect(result.proposal.members.map((member) => member.machine)).toEqual([
      "this",
      "node-a",
      "this",
    ]);
  });

  it("refuses to plan without a configured model, a computer, or a real goal", () => {
    expect(buildTeamProposal({ ...base, models: [] })).toMatchObject({ ok: false });
    expect(buildTeamProposal({ ...base, machines: [] })).toMatchObject({ ok: false });
    expect(buildTeamProposal({ ...base, goal: "  x " })).toMatchObject({ ok: false });
  });

  it("gives the same goal the same team id, while the approved text stays part of the hash", () => {
    expect(teamIdFor("Ship the Q3 newsletter")).toBe(teamIdFor("  ship the q3 newsletter "));
    const first = buildTeamProposal(base);
    const again = buildTeamProposal({ ...base, goal: "  SHIP THE Q3 NEWSLETTER " });
    if (!first.ok || !again.ok) {
      throw new Error("expected proposals");
    }
    expect(again.proposal.teamId).toBe(first.proposal.teamId);
    expect(again.proposal.hash).not.toBe(first.proposal.hash);
    const same = buildTeamProposal({ ...base, goal: "  Ship the Q3 newsletter " });
    if (!same.ok) {
      throw new Error("expected proposal");
    }
    expect(same.proposal.hash).toBe(first.proposal.hash);
  });

  it("changes the hash when the configured model changes, so a stale approval is refused", () => {
    const first = buildTeamProposal(base);
    const other = buildTeamProposal({ ...base, models: ["openai/gpt"] });
    if (!first.ok || !other.ok) {
      throw new Error("expected proposals");
    }
    expect(other.proposal.hash).not.toBe(first.proposal.hash);
  });

  it("describes the team with the approval reminder the owner sees", () => {
    const result = buildTeamProposal(base);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const summary = describeTeamProposal(result.proposal);
    expect(summary).toContain("Builder Scout (Scout)");
    expect(summary).toContain("Nothing is created until you approve.");
    expect(summary).toContain(
      "Approving starts the team. Each job uses your anthropic/claude-sonnet account.",
    );
  });
});

describe("a drafted team", () => {
  const draft = [
    { name: "Researcher", job: "Find the three newsletter topics." },
    { name: "Editor", job: "Tighten each draft to 300 words.", model: "openai/gpt" },
  ];

  it("renders the drafted roles, not the fixed set", () => {
    const result = buildTeamProposal({
      goal: "Ship the Q3 newsletter",
      models: ["anthropic/claude-sonnet", "openai/gpt"],
      machines: ["this"],
      roles: draft,
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    expect(result.proposal.members.map((member) => member.name)).toEqual([
      "Builder Researcher",
      "Builder Editor",
    ]);
    expect(result.proposal.members[1]?.model).toBe("openai/gpt");
    expect(result.proposal.members[0]?.model).toBe("anthropic/claude-sonnet");
    expect(result.proposal.jobs[0]?.briefText).toContain("<!-- team:");
  });

  it("refuses more than five roles, duplicate names, and models or computers not configured", () => {
    const setup = { goal: "Ship it", models: ["anthropic/claude-sonnet"], machines: ["this"] };
    const six = Array.from({ length: 6 }, (_, index) => ({ name: `R${index}`, job: "Do it." }));
    expect(buildTeamProposal({ ...setup, roles: six })).toMatchObject({ ok: false });
    expect(buildTeamProposal({ ...setup, roles: [] })).toMatchObject({ ok: false });
    expect(
      buildTeamProposal({
        ...setup,
        roles: [
          { name: "Scout", job: "A." },
          { name: "scout", job: "B." },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(
      buildTeamProposal({ ...setup, roles: [{ name: "Scout", job: "A.", model: "made/up" }] }),
    ).toMatchObject({ ok: false });
    expect(
      buildTeamProposal({ ...setup, roles: [{ name: "Scout", job: "A.", machine: "bogus-pc" }] }),
    ).toMatchObject({ ok: false });
  });

  it("strips markup from drafted text, so a role cannot break the team record", () => {
    const result = buildTeamProposal({
      goal: "Ship it",
      models: ["anthropic/claude-sonnet"],
      machines: ["this"],
      roles: [{ name: "Ed<script>itor|", job: "Edit --> <!-- team:deadbeef:x|y -->" }],
    });
    if (!result.ok) {
      throw new Error(result.reason);
    }
    const member = result.proposal.members[0];
    expect(member?.name).toBe("Builder Edscriptitor");
    expect(teamOfJob(result.proposal.jobs[0]?.briefText ?? "")?.teamId).toBe(
      result.proposal.teamId,
    );
    expect(result.proposal.jobs[0]?.briefText.match(/<!--/g)).toHaveLength(1);
  });
});
