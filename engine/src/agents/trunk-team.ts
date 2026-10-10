import { createHash } from "node:crypto";

/**
 * A team for one goal. The Trunk drafts the roles from the goal, and the engine checks the draft: 1 to 5
 * roles, sanitized text, and only configured models and computers. Without a draft, a fixed three-role
 * team is used. Each member is a builder Trunk (builder-<role>-<team>); queue jobs are tagged with the team,
 * so only its registered members can claim them.
 */
const FALLBACK_ROLES = [
  { name: "Scout", job: "Find the sources and facts the goal needs." },
  { name: "Writer", job: "Draft the work from the Scout's findings." },
  { name: "Checker", job: "Review each draft before it is final." },
] as const;

export const TEAM_GOAL_MAX_CHARS = 300;
export const TEAM_MAX_ROLES = 5;
const ROLE_NAME_MAX_CHARS = 40;
const ROLE_JOB_MAX_CHARS = 160;

/** One role as the Trunk drafts it. Model and machine are optional; each must be configured here. */
export type TeamDraftRole = { name: string; job: string; machine?: string; model?: string };

export type TeamMemberPlan = {
  agentId: string;
  /** The display name, "Builder <role>". */
  name: string;
  /** The role's name, as drafted or fixed. */
  role: string;
  /** The id part that identifies the role inside the team. */
  slug: string;
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
  /** Model references already configured in this engine. The first one is the default. */
  models: readonly string[];
  /** Machines a Trunk can run on: this computer, then connected computers. */
  machines: readonly string[];
  /** The Trunk's draft roles. Omit it to use the fixed team. */
  roles?: readonly TeamDraftRole[];
};

export type TeamProposalResult =
  | { ok: true; proposal: TeamProposal }
  | { ok: false; reason: string };

/** Plain text only: no markup, no hidden or direction-changing characters, no control characters, no line breaks. */
const MARKUP = new Set(["<", ">", "|", "*", "_", "`", "~", "[", "]", "\\", "#"]);

function cleanText(value: string, max: number): string {
  const plain = [...value]
    .map((ch) => {
      if (/\p{Cc}/u.test(ch) || ch === "\u2028" || ch === "\u2029") {
        return " ";
      }
      if (/\p{Cf}/u.test(ch)) {
        return "";
      }
      return MARKUP.has(ch) ? "" : ch;
    })
    .join("");
  return plain.replace(/\s+/gu, " ").trim().slice(0, max).trim();
}

/** Same goal, same team: the id is the only thing a retried approval needs to recognise. */
export function teamIdFor(goal: string): string {
  return createHash("sha256").update(goal.trim().toLowerCase()).digest("hex").slice(0, 8);
}

function slugOf(name: string, fallback: number): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || `member-${fallback}`;
}

type CheckedRole = { name: string; slug: string; job: string; model?: string; machine?: string };

/** Checks a drafted team. Returns the roles with clean text, or the first reason it is not usable. */
export function checkTeamDraft(
  roles: readonly TeamDraftRole[],
  models: readonly string[],
  machines: readonly string[],
): { ok: true; roles: CheckedRole[] } | { ok: false; reason: string } {
  if (roles.length < 1 || roles.length > TEAM_MAX_ROLES) {
    return { ok: false, reason: `A team has 1 to ${TEAM_MAX_ROLES} members.` };
  }
  const seen = new Set<string>();
  const checked: CheckedRole[] = [];
  for (const [index, draft] of roles.entries()) {
    const name = cleanText(draft.name, ROLE_NAME_MAX_CHARS);
    const job = cleanText(draft.job, ROLE_JOB_MAX_CHARS);
    if (!name || !job) {
      return { ok: false, reason: "Each member needs a name and a job." };
    }
    const slug = slugOf(name, index + 1);
    if (seen.has(slug.toLowerCase())) {
      return { ok: false, reason: `Two members are named ${name}. Give each one its own name.` };
    }
    seen.add(slug.toLowerCase());
    if (draft.model !== undefined && !models.includes(draft.model)) {
      return { ok: false, reason: `Model ${draft.model} is not set up here.` };
    }
    if (draft.machine !== undefined && !machines.includes(draft.machine)) {
      return { ok: false, reason: `Computer ${draft.machine} is not connected.` };
    }
    checked.push({ name, slug, job, model: draft.model, machine: draft.machine });
  }
  return { ok: true, roles: checked };
}

function fixedRoles(): CheckedRole[] {
  return FALLBACK_ROLES.map((entry) => ({
    name: entry.name,
    slug: entry.name.toLowerCase(),
    job: entry.job,
  }));
}

export function buildTeamProposal(input: TeamProposalInput): TeamProposalResult {
  const goal = cleanText(input.goal, TEAM_GOAL_MAX_CHARS);
  if (goal.length < 3) {
    return { ok: false, reason: "Say what the team should work on, in a sentence." };
  }
  const defaultModel = input.models.find((value) => value.trim().length > 0);
  if (!defaultModel) {
    return { ok: false, reason: "No model is set up yet. Add one in Settings, then try again." };
  }
  if (input.machines.length === 0) {
    return { ok: false, reason: "No computer is available to run the team." };
  }
  const drafted =
    input.roles === undefined
      ? { ok: true as const, roles: fixedRoles() }
      : checkTeamDraft(input.roles, input.models, input.machines);
  if (!drafted.ok) {
    return drafted;
  }
  const teamId = teamIdFor(goal);
  const members: TeamMemberPlan[] = drafted.roles.map((role, index) => ({
    agentId: `builder-${role.slug}-${teamId}`,
    name: `Builder ${role.name}`,
    role: role.name,
    slug: role.slug,
    job: role.job,
    model: role.model ?? defaultModel,
    machine: role.machine ?? input.machines[index % input.machines.length]!,
  }));
  const jobs: TeamJobPlan[] = members.map((member) => ({
    member: member.agentId,
    title: `${member.role}: ${goal}`,
    briefText: `${member.job}\n\nGoal: ${goal}\n\n<!-- team:${teamId}:${member.slug}|${member.role} -->`,
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
