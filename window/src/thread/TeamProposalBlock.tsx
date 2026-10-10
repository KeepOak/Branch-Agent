// The team proposal as a block in the Trunk's thread. The block opens the team's approval, the same record the Inbox
// shows. Approve is that record's Allow (approval.resolve), so one tap decides it; the engine applies the team only
// after that answer. Edit re-checks the roles through the engine, and a new draft gets a new approval.
import { useEffect, useRef, useState } from "react";
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

type OpenAnswer = { status?: string; approvalId?: string };
type ResolveAnswer = { applied?: boolean };

/** The card's state after the owner answers the approval. Allowing only says the team is being created. */
export function stateAfter(decision: "allow-once" | "deny"): TeamApprovalState {
  return decision === "allow-once" ? "applying" : "declined";
}

export function TeamProposalBlock({ block }: { block: TeamBlock }) {
  const { engine } = useThread();
  const [proposal, setProposal] = useState<TeamProposalView>(block.result.proposal);
  const [choices, setChoices] = useState<TeamChoices>(block.result.choices);
  const [approvalId, setApprovalId] = useState<string | undefined>();
  const [state, setState] = useState<TeamApprovalState>("opening");
  const [error, setError] = useState("");
  const openedFor = useRef<string | undefined>();

  // Opens the approval once for each proposal, so the card and the Inbox show the same record.
  useEffect(() => {
    if (!engine || openedFor.current === proposal.hash) return;
    openedFor.current = proposal.hash;
    setState("opening");
    setApprovalId(undefined);
    engine
      .request<OpenAnswer>("trunks.team.open", {
        goal: proposal.goal,
        roles: rolesOf(proposal.members),
        proposalHash: proposal.hash,
      })
      .then((answer) => {
        if (answer?.status === "pending" && answer.approvalId) {
          setApprovalId(answer.approvalId);
          setState("asking");
        } else {
          setState("unavailable");
          setError("Nothing can be approved right now.");
        }
      })
      .catch((failure: unknown) => {
        setState("unavailable");
        setError(messageOf(failure));
      });
  }, [engine, proposal]);

  const answer = async (decision: "allow-once" | "deny") => {
    if (!engine || !approvalId) return;
    setError("");
    try {
      const result = await engine.request<ResolveAnswer>("approval.resolve", {
        id: approvalId,
        kind: "system-agent",
        decision,
      });
      if (result?.applied !== true)
        throw new Error("This was already answered elsewhere. Refresh the Inbox.");
      setState(stateAfter(decision));
    } catch (failure) {
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
      if (approvalId)
        void engine
          .request("approval.resolve", { id: approvalId, kind: "system-agent", decision: "deny" })
          .catch(() => undefined);
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
      onApprove={() => void answer("allow-once")}
      onDecline={() => void answer("deny")}
      onSave={save}
    />
  );
}
