// The team proposal as a block in the Trunk's thread. Approve starts the existing approval (the Inbox allows it);
// Edit re-checks the roles through the engine before anything is approved. Nothing is created here.
import { useState } from "react";
import { TeamApprovalCard, type TeamApprovalState } from "../places/trunk/TeamApprovalCard";
import { useThread } from "./context";
import {
  rolesOf,
  type TeamChoices,
  type TeamProposalView,
  type TeamToolResult,
} from "./team-proposal";

export type TeamBlock = { kind: "team"; key: string; result: TeamToolResult };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type AnswerPayload = { status?: string };

/** Maps the engine's answer to the card's state. Anything the engine did not apply is shown as not created. */
export function stateFor(status: string | undefined): TeamApprovalState {
  if (status === "applied") return "applied";
  if (status === "declined") return "declined";
  return "unavailable";
}

export function TeamProposalBlock({ block }: { block: TeamBlock }) {
  const { engine } = useThread();
  const [proposal, setProposal] = useState<TeamProposalView>(block.result.proposal);
  const [choices, setChoices] = useState<TeamChoices>(block.result.choices);
  const [state, setState] = useState<TeamApprovalState>("asking");
  const [error, setError] = useState("");

  const approve = async () => {
    if (!engine) return setError("Approving needs a connection to this computer.");
    setState("waiting");
    setError("");
    try {
      const answer = await engine.request<AnswerPayload>("trunks.team.approve", {
        goal: proposal.goal,
        roles: rolesOf(proposal.members),
        proposalHash: proposal.hash,
      });
      setState(stateFor(answer?.status));
    } catch (failure) {
      setState("asking");
      setError(messageOf(failure));
    }
  };

  const save = async (members: TeamProposalView["members"]) => {
    if (!engine) return setError("Editing needs a connection to this computer.");
    try {
      const next = await engine.request<TeamToolResult & { choices?: TeamChoices }>(
        "trunks.team.propose",
        { goal: proposal.goal, roles: rolesOf(members) },
      );
      setProposal(next.proposal);
      if (next.choices) setChoices(next.choices);
      setError("");
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <TeamApprovalCard
      goal={proposal.goal}
      members={proposal.members}
      state={state}
      choices={choices}
      error={error}
      onApprove={approve}
      onDecline={() => setState("declined")}
      onSave={save}
    />
  );
}
