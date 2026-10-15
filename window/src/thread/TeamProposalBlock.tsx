// The team proposal as a block in the Trunk's thread. The block opens the team's approval (one per proposal, kept by
// the engine), so the card and the Inbox show the same record. Approve is that record's Allow (approval.resolve), so
// one tap decides it. The card then shows what the engine reports: created, failed (with Retry), or declined. Nothing
// here creates a team; leaving the thread decides nothing, and the record waits or expires on its own.
import { useEffect, useRef, useState } from "react";
import { TeamApprovalCard, type TeamApprovalState } from "../places/trunk/TeamApprovalCard";
import { useThread } from "./context";
import {
  rolesOf,
  stateAfter,
  type TeamChoices,
  type TeamProposalView,
  type TeamToolResult,
} from "./team-proposal";

export type TeamBlock = { kind: "team"; key: string; result: TeamToolResult };

/** A state change the engine publishes for a proposal (trunks.team.changed). */
type TeamChange = {
  hash: string;
  state: string;
  approvalId?: string;
  created?: string[];
  message?: string;
};
type OpenAnswer = { status?: string; approvalId?: string; created?: string[]; message?: string };
type ResolveAnswer = { applied?: boolean };
type RetryAnswer = { status?: string; created?: string[]; message?: string };

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function TeamProposalBlock({ block }: { block: TeamBlock }) {
  const { engine } = useThread();
  const [proposal, setProposal] = useState<TeamProposalView>(block.result.proposal);
  const [choices, setChoices] = useState<TeamChoices>(block.result.choices);
  const [approvalId, setApprovalId] = useState<string | undefined>();
  const [state, setState] = useState<TeamApprovalState>("opening");
  const [created, setCreated] = useState<string[]>([]);
  const [message, setMessage] = useState<string | undefined>();
  const [error, setError] = useState("");
  const openedFor = useRef<string | undefined>(undefined);

  // The engine pushes this proposal's state as it changes: applying, applied, failed, declined, or expired.
  useEffect(() => {
    if (!engine?.onEvent) return;
    return engine.onEvent((event) => {
      const change = event.payload as TeamChange | undefined;
      if (event.event !== "trunks.team.changed" || change?.hash !== proposal.hash) return;
      if (change.state === "applying") setState("applying");
      if (change.state === "applied") {
        setCreated(change.created ?? []);
        setState("applied");
      }
      if (change.state === "failed") {
        setMessage(change.message);
        setState("failed");
      }
      if (change.state === "declined") setState("declined");
      if (change.state === "expired") {
        setMessage("The approval expired. Edit the team to ask again.");
        setState("unavailable");
      }
    });
  }, [engine, proposal.hash]);

  // Opens the proposal's approval once, and shows what the engine already knows about it.
  useEffect(() => {
    if (!engine || openedFor.current === proposal.hash) return;
    openedFor.current = proposal.hash;
    setState("opening");
    setApprovalId(undefined);
    setError("");
    engine
      .request<OpenAnswer>("trunks.team.open", {
        goal: proposal.goal,
        roles: rolesOf(proposal.members),
        proposalHash: proposal.hash,
      })
      .then((answer) => {
        switch (answer?.status) {
          case "pending":
            if (answer.approvalId) {
              setApprovalId(answer.approvalId);
              setState("asking");
              return;
            }
            break;
          case "declined":
            setState("declined");
            return;
          case "applying":
            setState("applying");
            return;
          case "applied":
            setCreated(answer.created ?? []);
            setState("applied");
            return;
          case "failed":
            setMessage(answer.message);
            setState("failed");
            return;
          default:
            break;
        }
        setMessage(answer?.message ?? "Nothing can be approved right now.");
        setState("unavailable");
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

  const retry = async () => {
    if (!engine) return;
    setError("");
    setState("applying");
    try {
      const result = await engine.request<RetryAnswer>("trunks.team.retry", {
        goal: proposal.goal,
        roles: rolesOf(proposal.members),
        proposalHash: proposal.hash,
      });
      if (result?.status === "applied") {
        setCreated(result.created ?? []);
        setState("applied");
      } else {
        setMessage(result?.message);
        setState("failed");
      }
    } catch (failure) {
      setState("failed");
      setError(messageOf(failure));
    }
  };

  const save = async (members: TeamProposalView["members"]) => {
    if (!engine) return setError("Editing needs a connection to this computer.");
    try {
      const next = await engine.request<TeamToolResult & { choices?: TeamChoices }>(
        "trunks.team.propose",
        {
          goal: proposal.goal,
          roles: rolesOf(members),
        },
      );
      // The draft it replaces is no longer what the owner wants: its record is denied, not left waiting.
      if (approvalId && state === "asking") {
        void engine
          .request("approval.resolve", { id: approvalId, kind: "system-agent", decision: "deny" })
          .catch(() => undefined);
      }
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
      created={created}
      message={message}
      onApprove={() => void answer("allow-once")}
      onDecline={() => void answer("deny")}
      onRetry={() => void retry()}
      onSave={save}
    />
  );
}
