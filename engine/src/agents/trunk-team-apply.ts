import type { TeamProposal } from "./trunk-team.js";

/** The side effects an approved team needs. Production supplies the real ones; tests supply fakes. */
export type TeamApplyDeps = {
  hasAgent: (agentId: string) => boolean;
  createAgent: (member: TeamProposal["members"][number]) => Promise<void>;
  hasRoom: (roomId: string) => boolean;
  createRoom: (input: { roomId: string; name: string; members: string[] }) => void;
  hasJob: (briefText: string) => boolean;
  addJob: (input: { title: string; brief_text: string }) => void;
};

export type TeamApplyResult = { created: string[]; skipped: string[] };

/**
 * Applies an approved proposal in order: Trunks, then the group room, then the first jobs. Each step
 * checks before it creates, so a second approval of the same team adds nothing.
 */
export async function applyTeamProposal(
  proposal: TeamProposal,
  deps: TeamApplyDeps,
): Promise<TeamApplyResult> {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const member of proposal.members) {
    if (deps.hasAgent(member.agentId)) {
      skipped.push(member.agentId);
      continue;
    }
    await deps.createAgent(member);
    created.push(member.agentId);
  }
  if (deps.hasRoom(proposal.roomId)) {
    skipped.push(proposal.roomId);
  } else {
    deps.createRoom({
      roomId: proposal.roomId,
      name: proposal.goal,
      members: proposal.members.map((member) => member.agentId),
    });
    created.push(proposal.roomId);
  }
  for (const job of proposal.jobs) {
    if (deps.hasJob(job.briefText)) {
      skipped.push(job.title);
      continue;
    }
    deps.addJob({ title: job.title, brief_text: job.briefText });
    created.push(job.title);
  }
  return { created, skipped };
}
