import { createHash } from "node:crypto";

/**
 * A small team for one goal. Every member is a builder Trunk (builder-<role>-<team>), so the queue's
 * existing rule lets it take the team's jobs. Models and machines come only from what is configured.
 */
const TEAM_ROLES = [
  { role: "Scout", job: "Find the sources and facts the goal needs." },
  { role: "Writer", job: "Draft the work from the Scout's findings." },
  { role: "Checker", job: "Review each draft before it is final." },
] as const;

export const TEAM_GOAL_MAX_CHARS = 300;

export type TeamMemberPlan = {
  agentId: string;
  name: string;
  role: string;
  job: string;
  model: string;
  machine: string;
};

export type TeamJobPlan = {
  member: string;
  title: string;
  briefText: string;
};

export type TeamProposal = {
  teamId: string;
  goal: string;
  roomId: string;
  members: TeamMemberPlan[];
  jobs: TeamJobPlan[];
  hash: string;
};

export type TeamProposalInput = {
  goal: string;
  /** Model references already configured in this engine. The first one is used. */
  models: readonly string[];
  /** Machines a Trunk can run on: this computer, then connected computers. */
  machines: readonly string[];
};

export type TeamProposalResult =
  | { ok: true; proposal: TeamProposal }
  | { ok: false; reason: string };

/** Same goal, same team: the id is the only thing a retried approval needs to recognise. */
export function teamIdFor(goal: string): string {
  return createHash("sha256").update(goal.trim().toLowerCase()).digest("hex").slice(0, 8);
}

export function buildTeamProposal(input: TeamProposalInput): TeamProposalResult {
  const goal = input.goal.trim();
  if (goal.length < 3 || goal.length > TEAM_GOAL_MAX_CHARS) {
    return { ok: false, reason: "Say what the team should work on, in a sentence." };
  }
  const model = input.models.find((value) => value.trim().length > 0);
  if (!model) {
    return { ok: false, reason: "No model is set up yet. Add one in Settings, then try again." };
  }
  if (input.machines.length === 0) {
    return { ok: false, reason: "No computer is available to run the team." };
  }
  const teamId = teamIdFor(goal);
  const members: TeamMemberPlan[] = TEAM_ROLES.map((entry, index) => ({
    agentId: `builder-${entry.role.toLowerCase()}-${teamId}`,
    name: `Builder ${entry.role}`,
    role: entry.role,
    job: entry.job,
    model,
    machine: input.machines[index % input.machines.length]!,
  }));
  const jobs: TeamJobPlan[] = members.map((member) => ({
    member: member.agentId,
    title: `${member.role}: ${goal}`,
    briefText: `${member.job}\n\nGoal: ${goal}\n\n<!-- team:${teamId}:${member.role} -->`,
  }));
  const proposal = { teamId, goal, roomId: `team-${teamId}`, members, jobs };
  return { ok: true, proposal: { ...proposal, hash: hashTeamProposal(proposal) } };
}

/** Covers everything an approval applies, so approving a stale proposal is refused. */
export function hashTeamProposal(proposal: Omit<TeamProposal, "hash">): string {
  return createHash("sha256").update(JSON.stringify(proposal)).digest("hex");
}

/** The owner-facing summary on the approve card. */
export function describeTeamProposal(proposal: TeamProposal): string {
  const lines = proposal.members.map(
    (member) =>
      `${member.name} (${member.role}): ${member.job} Runs on ${member.machine}, model ${member.model}.`,
  );
  const model = proposal.members[0]?.model ?? "your model";
  return [
    `Team for "${proposal.goal}"`,
    ...lines,
    "Nothing is created until you approve.",
    `Approving starts the team. Each job uses your ${model} account.`,
  ].join("\n");
}
