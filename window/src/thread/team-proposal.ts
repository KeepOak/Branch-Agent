// What a team_propose result looks like in the thread: the proposal the engine checked, and the choices the owner
// may pick from when editing it. Pure reading only; the card decides nothing.

export type TeamMemberView = {
  name: string;
  role: string;
  job: string;
  machine: string;
  model: string;
};
export type TeamProposalView = {
  teamId: string;
  goal: string;
  hash: string;
  roomId: string;
  members: TeamMemberView[];
};
export type TeamChoices = { models: string[]; machines: string[] };
export type TeamToolResult = { proposal: TeamProposalView; choices: TeamChoices };

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function memberOf(value: unknown): TeamMemberView | undefined {
  const member = record(value);
  const name = str(member.name);
  return name
    ? {
        name,
        role: str(member.role),
        job: str(member.job),
        machine: str(member.machine),
        model: str(member.model),
      }
    : undefined;
}

/** The team from a team_propose tool result's text, or undefined when the text is not a proposal. */
export function teamFromToolText(text: string): TeamToolResult | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const payload = record(parsed);
  const proposal = record(payload.proposal);
  const members = Array.isArray(proposal.members)
    ? proposal.members.map(memberOf).filter((member): member is TeamMemberView => Boolean(member))
    : [];
  if (!str(proposal.teamId) || !members.length) return undefined;
  const choices = record(payload.choices);
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  return {
    proposal: {
      teamId: str(proposal.teamId),
      goal: str(proposal.goal),
      hash: str(proposal.hash),
      roomId: str(proposal.roomId),
      members,
    },
    choices: { models: list(choices.models), machines: list(choices.machines) },
  };
}

/** The roles the owner has on the card, in the shape the engine's propose method takes. */
export function rolesOf(
  members: readonly TeamMemberView[],
): { name: string; job: string; machine: string; model: string }[] {
  return members.map((member) => ({
    name: member.role || member.name,
    job: member.job,
    machine: member.machine,
    model: member.model,
  }));
}

/** The card's state after the owner answers the approval. Allowing only says the team is being created. */
export function stateAfter(decision: "allow-once" | "deny"): "applying" | "declined" {
  return decision === "allow-once" ? "applying" : "declined";
}
