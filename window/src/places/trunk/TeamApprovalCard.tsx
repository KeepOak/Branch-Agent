// The team proposal card. Approve sends the team to the Inbox, where the owner allows it; Edit changes roles,
// names, computers and models, and the engine checks them again before anything is approved. The card creates
// nothing by itself.
import { useState } from "react";
import "./team-approval.css";

export type TeamApprovalMember = {
  name: string;
  role: string;
  job: string;
  machine: string;
  model: string;
};
export type TeamApprovalState =
  | "opening"
  | "asking"
  | "applying"
  | "applied"
  | "declined"
  | "unavailable";
export type TeamApprovalChoices = { models: readonly string[]; machines: readonly string[] };
export type TeamApprovalProps = {
  goal: string;
  members: readonly TeamApprovalMember[];
  state: TeamApprovalState;
  choices?: TeamApprovalChoices;
  error?: string;
  onApprove?: () => void;
  onDecline?: () => void;
  onSave?: (members: TeamApprovalMember[]) => void | Promise<void>;
};

const ANSWER: Record<Exclude<TeamApprovalState, "opening" | "asking">, string> = {
  applying: "Allowed. The team is being created now.",
  applied: "Team created. Its first jobs are in the queue.",
  declined: "Not created.",
  unavailable: "Approval is unavailable right now. Nothing was created.",
};

const PLACE: Record<string, string> = { this: "This computer" };
const placeName = (id: string): string => PLACE[id] ?? id;

function costLine(members: readonly TeamApprovalMember[]): string {
  const model = members[0]?.model || "your model";
  return `Approving starts the team. Each job uses your ${model} account.`;
}

function MemberRow({ member }: { member: TeamApprovalMember }) {
  return (
    <li className="team-approval-member">
      <strong>{member.name}</strong>
      <span className="team-approval-role">{member.role}</span>
      <p>{member.job}</p>
      <small>
        Runs on {placeName(member.machine)} · {member.model}
      </small>
    </li>
  );
}

function MemberEditor({
  member,
  choices,
  onChange,
}: {
  member: TeamApprovalMember;
  choices: TeamApprovalChoices;
  onChange: (next: TeamApprovalMember) => void;
}) {
  return (
    <li className="team-approval-member team-approval-edit">
      <label>
        Name
        <input
          className="inp"
          value={member.role}
          onChange={(event) =>
            onChange({ ...member, role: event.target.value, name: `Builder ${event.target.value}` })
          }
        />
      </label>
      <label>
        Job
        <input
          className="inp"
          value={member.job}
          onChange={(event) => onChange({ ...member, job: event.target.value })}
        />
      </label>
      <label>
        Runs on
        <select
          className="inp"
          value={member.machine}
          onChange={(event) => onChange({ ...member, machine: event.target.value })}
        >
          {choices.machines.map((id) => (
            <option key={id} value={id}>
              {placeName(id)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Model
        <select
          className="inp"
          value={member.model}
          onChange={(event) => onChange({ ...member, model: event.target.value })}
        >
          {choices.models.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

function Editing({
  members,
  choices,
  error,
  onSave,
  onCancel,
}: {
  members: readonly TeamApprovalMember[];
  choices: TeamApprovalChoices;
  error?: string;
  onSave?: TeamApprovalProps["onSave"];
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TeamApprovalMember[]>(() =>
    members.map((member) => ({ ...member })),
  );
  return (
    <>
      <ul className="team-approval-members">
        {draft.map((member, index) => (
          <MemberEditor
            key={index}
            member={member}
            choices={choices}
            onChange={(next) => setDraft(draft.map((item, at) => (at === index ? next : item)))}
          />
        ))}
      </ul>
      {error ? (
        <p role="alert" className="team-approval-error">
          {error}
        </p>
      ) : null}
      <div className="team-approval-actions">
        <button type="button" className="btn pri" onClick={() => void onSave?.(draft)}>
          Save team
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </>
  );
}

function Answer({ state }: { state: TeamApprovalState }) {
  return (
    <p role="status" className="team-approval-answer">
      {ANSWER[state as Exclude<TeamApprovalState, "opening" | "asking">]}
    </p>
  );
}

export function TeamApprovalCard({
  goal,
  members,
  state,
  choices,
  error,
  onApprove,
  onDecline,
  onSave,
}: TeamApprovalProps) {
  const [editing, setEditing] = useState(false);
  const asking = state === "asking" || state === "opening";
  const ready = state === "asking";
  return (
    <section
      className="team-approval"
      data-testid="team-approval-card"
      data-state={state}
      aria-label={`Team for ${goal}`}
    >
      <h3>Create a team for “{goal}”</h3>
      {editing && asking && choices ? (
        <Editing
          members={members}
          choices={choices}
          error={error}
          onSave={async (next) => {
            await onSave?.(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <ul className="team-approval-members">
          {members.map((member) => (
            <MemberRow key={member.name} member={member} />
          ))}
        </ul>
      )}
      {asking && !editing ? (
        <>
          <div className="team-approval-actions">
            <button
              type="button"
              className="btn pri"
              data-testid="team-approve"
              onClick={onApprove}
              disabled={!ready}
            >
              Approve team
            </button>
            <button
              type="button"
              className="btn"
              data-testid="team-edit"
              onClick={() => setEditing(true)}
              disabled={!choices}
            >
              Edit
            </button>
            <button type="button" className="btn ghost" onClick={onDecline} disabled={!ready}>
              Not now
            </button>
          </div>
          <p className="team-approval-hint">
            {ready ? "Nothing is created until you approve. " : "Opening the approval… "}
            {costLine(members)}
          </p>
          {error ? (
            <p role="alert" className="team-approval-error">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
      {!asking ? <Answer state={state} /> : null}
    </section>
  );
}
