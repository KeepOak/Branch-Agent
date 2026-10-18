// The approval card in the conversation (preview askCard, HANDOFF R1-05 "In the conversation"): a glass card with the
// question, its facts as key/value lines, then the answers the request allows: primary ink "Send it", "Always allow for
// <Trunk>", "Don't send". Once answered it collapses to a small decided pill. A failed answer stays open with the error
// under the buttons. Questions (question.*) get their options, a typed answer where the question takes one, and Skip.
// R1-03's thread renders this through its renderApproval slot.
import { Fragment, useState } from "react";
import { Coming } from "../../glass/coming";
import { canDecideApprovals } from "../../thread/approval-trust";
import { useNow } from "../../thread/approval-guard";
import { RESOLVE_OF, settledText, type Ask, type AskQuestion, type Reply } from "./model";
import type { AskState } from "./useAsks";
import "../../glass/glass.css";
import "./approvals.css";

export const LOCKDOWN_WHY = "Lockdown is on: nothing leaves this computer.";
const RESOLVE_WHY = "Answering here comes in a later update. Answer in the conversation’s chat app or the terminal.";

type CardProps = {
  state: AskState;
  /** The Trunk that asks, for "Always allow for Ledger". */
  name: string;
  onAnswer: (id: string, reply: Reply) => void;
  lockdown?: boolean;
  /** The connection's scopes: someone without approval rights can look but not decide. */
  scopes?: readonly string[];
};

export function Decided({ ask, how, name }: { ask: Ask; how: NonNullable<AskState["settled"]>; name: string }) {
  const { text, tone } = settledText(ask, how, name);
  return (
    <div className="r1-ask-decided g-clear" data-testid="r1-ask" data-state={how}>
      <span className="r1-ask-pill" data-tone={tone}>{text}</span>
      <span className="r1-ask-what">{ask.title.replace(/\?$/, "")}</span>
    </div>
  );
}

export function AskCard({ state, name, onAnswer, lockdown, scopes }: CardProps) {
  const { ask } = state;
  const now = useNow(state.status !== "settled" && Boolean(ask.expiresAtMs));
  if (state.status === "settled" && state.settled) return <Decided ask={ask} how={state.settled} name={name} />;
  if (ask.expiresAtMs && ask.expiresAtMs <= now && state.status === "waiting") return <Decided ask={ask} how="expired" name={name} />;
  const decide = canDecideApprovals(undefined, scopes);
  const busy = state.status === "sending";
  return (
    <div className="r1-ask g-clear" data-testid="r1-ask" data-state={state.status} data-kind={ask.kind} data-approval={ask.id}>
      <div className="r1-ask-head">
        <span className="r1-ask-q">{ask.title}</span>
        <span className="r1-ask-pill" data-tone={ask.warning ? "warn" : "wait"}><i />{ask.warning ? "Warning" : decide ? "Waiting for you" : "Waiting"}</span>
      </div>
      {ask.facts.length || ask.body ? (
        <dl className="r1-ask-kv">
          {ask.facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}
          {ask.body ? <dd className="r1-ask-body">{ask.body}</dd> : null}
        </dl>
      ) : null}
      {ask.code ? <pre className="r1-ask-code"><code>{ask.code}</code></pre> : null}
      {!decide ? <p className="r1-ask-note">You can look but not decide. Someone with approval rights decides.</p>
        : ask.kind === "question" ? <QuestionForm ask={ask} busy={busy} onAnswer={onAnswer} />
        : (
          <div className="r1-ask-acts">
            {ask.allowed.includes("allow-once") ? <Answer ask={ask} kind="primary" off={busy || lockdown} why={lockdown ? LOCKDOWN_WHY : undefined} onClick={() => onAnswer(ask.id, "allow-once")}>{ask.words.yes}</Answer> : null}
            {ask.allowed.includes("allow-always") ? <Answer ask={ask} off={busy || lockdown} why={lockdown ? LOCKDOWN_WHY : undefined} onClick={() => onAnswer(ask.id, "allow-always")}>Always allow for {name}</Answer> : null}
            <Answer ask={ask} kind="ghost" off={busy} onClick={() => onAnswer(ask.id, "deny")}>{ask.words.no}</Answer>
          </div>
        )}
      {state.error ? <p className="r1-ask-error" role="alert">{/\btry again\b/i.test(state.error) ? `That didn’t go through. ${state.error}` : `That didn’t go through: ${state.error} Try again.`}</p> : null}
    </div>
  );
}

function Answer({ ask, kind, off, why, onClick, children }: { ask: Ask; kind?: "primary" | "ghost"; off?: boolean; why?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Coming need={RESOLVE_OF[ask.kind]} reason={RESOLVE_WHY}>
      <button type="button" className="r1-ask-btn" data-kind={kind} data-solid={kind === "primary" ? "" : undefined} disabled={off} title={why} onClick={onClick}>{children}</button>
    </Coming>
  );
}

/** A question's options (one tap answers a single-choice question), a typed answer where it takes one, Reply and Skip. */
function QuestionForm({ ask, busy, onAnswer }: { ask: Ask; busy: boolean; onAnswer: (id: string, reply: Reply) => void }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const single = ask.questions.length === 1 && !ask.questions[0].multi && !ask.questions[0].free;
  const answers = () => Object.fromEntries(ask.questions.map((q) => [q.questionId, [...(picked[q.questionId] ?? []), ...(typed[q.questionId]?.trim() ? [typed[q.questionId].trim()] : [])]]));
  const ready = ask.questions.every((q) => (picked[q.questionId]?.length ?? 0) > 0 || Boolean(typed[q.questionId]?.trim()));
  const pick = (q: AskQuestion, value: string) => {
    if (single) { onAnswer(ask.id, { answers: { [q.questionId]: [value] } }); return; }
    setPicked((p) => {
      const now = p[q.questionId] ?? [];
      return { ...p, [q.questionId]: q.multi ? (now.includes(value) ? now.filter((v) => v !== value) : [...now, value]) : [value] };
    });
  };
  return (
    <>
      {ask.questions.map((q, i) => (
        <div className="r1-ask-question" key={q.questionId}>
          {ask.questions.length > 1 || q.header ? <span className="r1-ask-qline">{q.header ? <span className="r1-ask-chip">{q.header}</span> : null}{i > 0 || ask.questions.length > 1 ? <span className="r1-ask-qtext">{q.question}</span> : null}</span> : null}
          {q.options.length ? (
            <div className="r1-ask-options" role={q.multi ? "group" : "radiogroup"} aria-label={q.question}>
              {q.options.map((o) => (
                <Coming key={o.value} need="question.resolve" reason={RESOLVE_WHY}>
                  <button type="button" className="r1-ask-option" role={q.multi ? "checkbox" : "radio"} aria-checked={picked[q.questionId]?.includes(o.value) ?? false} disabled={busy} onClick={() => pick(q, o.value)}>{o.label}</button>
                </Coming>
              ))}
            </div>
          ) : null}
          {q.free ? (
            <Coming need="question.resolve" reason={RESOLVE_WHY}>
              <input className="r1-ask-input" type={q.secret ? "password" : "text"} aria-label={q.question} placeholder={q.options.length ? "Or type your own answer" : "Your answer"} value={typed[q.questionId] ?? ""} disabled={busy} onChange={(e) => setTyped((t) => ({ ...t, [q.questionId]: e.target.value }))} />
            </Coming>
          ) : null}
        </div>
      ))}
      <div className="r1-ask-acts">
        {single ? null : <Coming need="question.resolve" reason={RESOLVE_WHY}><button type="button" className="r1-ask-btn" data-kind="primary" data-solid="" disabled={busy || !ready} onClick={() => onAnswer(ask.id, { answers: answers() })}>Reply</button></Coming>}
        <Coming need="question.resolve" reason={RESOLVE_WHY}><button type="button" className="r1-ask-btn" data-kind="ghost" disabled={busy} onClick={() => onAnswer(ask.id, "skip")}>Skip</button></Coming>
      </div>
    </>
  );
}
