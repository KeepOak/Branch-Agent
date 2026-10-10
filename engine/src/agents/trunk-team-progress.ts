import type { QueueTransition } from "./trunk-queue.js";

/** The marker buildTeamProposal puts in each team job's brief. Jobs without it are not team work. */
const TEAM_MARKER = /<!-- team:([0-9a-f]{8}):([a-z0-9-]+)\|([^<>|]{1,40}) -->/;

export type RoomProgressPost = { roomId: string; actorId: string; text: string };

/** The team and role a job belongs to, or undefined for any other job. */
export function teamOfJob(
  briefText: string,
): { teamId: string; slug: string; role: string } | undefined {
  const match = TEAM_MARKER.exec(briefText);
  return match ? { teamId: match[1]!, slug: match[2]!, role: match[3]! } : undefined;
}

const VERB: Record<QueueTransition["kind"], (name: string, title: string) => string> = {
  claimed: (name, title) => `${name} picked up "${title}".`,
  done: (name, title) => `${name} finished "${title}".`,
  released: (name, title) => `${name} handed "${title}" back to the queue.`,
  blocked: (name, title) => `${name} is stuck on "${title}" and needs a look.`,
};

/**
 * One plain line for a team job's transition, posted in the team's group room as the Trunk that did the work.
 * Returns undefined for other jobs, for a missing room, or when the Trunk is not known.
 */
export function teamProgressPost(
  transition: QueueTransition,
  roomExists: (roomId: string) => boolean,
): RoomProgressPost | undefined {
  const team = teamOfJob(transition.item.brief_text);
  if (!team) {
    return undefined;
  }
  const roomId = `team-${team.teamId}`;
  const actorId = transition.agentId ?? transition.item.claimed_by ?? memberIdFor(team);
  if (!actorId || !roomExists(roomId)) {
    return undefined;
  }
  const name = `Builder ${team.role}`;
  return { roomId, actorId, text: VERB[transition.kind](name, transition.item.title) };
}

/** The member a team job was built for. Used when a transition carries no claimant. */
function memberIdFor(team: { teamId: string; slug: string }): string {
  return `builder-${team.slug}-${team.teamId}`;
}
