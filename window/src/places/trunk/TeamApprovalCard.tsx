// The team proposal card. One owner tap on "Approve team" decides it, and that tap is the existing change
// approval. The card only shows the team and the answer; it never creates anything itself.
import "./team-approval.css";

export type TeamApprovalMember = {
  name: string;
  role: string;
  job: string;
  machine: string;
  model: string;
};
export type TeamApprovalState = "asking" | "applied" | "declined" | "unavailable";
export type TeamApprovalProps = {
  goal: string;
  members: readonly TeamApprovalMember[];
  state: TeamApprovalState;
  onApprove?: () => void;
  onDecline?: () => void;
};

const ANSWER: Record<Exclude<TeamApprovalState, "asking">, string> = {
  applied: "Team created. Its first jobs are in the queue.",
  declined: "Not created.",
  unavailable: "Approval is unavailable right now. Nothing was created.",
};

function MemberRow({ member }: { member: TeamApprovalMember }) {
  return (
    <li className="team-approval-member">
      <strong>{member.name}</strong>
      <span className="team-approval-role">{member.role}</span>
      <p>{member.job}</p>
      <small>
        Runs on {member.machine} · {member.model}
      </small>
    </li>
  );
}

export function TeamApprovalCard({
  goal,
  members,
  state,
  onApprove,
  onDecline,
}: TeamApprovalProps) {
  const asking = state === "asking";
  return (
    <section
      className="team-approval"
      data-testid="team-approval-card"
      data-state={state}
      aria-label={`Team for ${goal}`}
    >
      <h3>Create a team for “{goal}”</h3>
      <ul className="team-approval-members">
        {members.map((member) => (
          <MemberRow key={member.name} member={member} />
        ))}
      </ul>
      {asking ? (
        <>
          <div className="team-approval-actions">
            <button
              type="button"
              className="btn pri"
              data-testid="team-approve"
              onClick={onApprove}
            >
              Approve team
            </button>
            <button type="button" className="btn ghost" onClick={onDecline}>
              Not now
            </button>
          </div>
          <p className="team-approval-hint">Nothing is created until you approve.</p>
        </>
      ) : (
        <p role="status" className="team-approval-answer">
          {ANSWER[state]}
        </p>
      )}
    </section>
  );
}
