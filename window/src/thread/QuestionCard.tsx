// The question card (DESIGN-SPEC §4.2.2 "Choice block" and "Questions"): A–D options with their keys, "Or type your
// own answer", pick several, several questions one at a time, a step on a web page, and a secret. The first
// waiting question sits above the message box; the thread keeps one line where it was asked.
import { useState, type KeyboardEvent } from "react";
import { answerValues, outcome, pick, type, typesOwn, type Draft, type Question, type QuestionRecord } from "./questions";
import "./questions.css";

const KEYS = "ABCD";
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Resolve = (id: string, resolution: { answers: Record<string, string[]> } | { cancel: true }) => Promise<void>;

/** The line in the thread: "Answered · <question> · <answer>", or "Waiting for your answer" when it is docked. */
export function QuestionLine({ record }: { record: QuestionRecord }) {
  const first = record.questions[0];
  if (record.status === "pending") {
    return (
      <div className="decided q-above indent" data-testid="question-line">
        <span className="pill wait"><i />Waiting for your answer</span>
        <span>{first.question} · Answer above the message box.</span>
      </div>
    );
  }
  const o = outcome(record);
  return (
    <div className="decided indent" data-testid="question-line">
      <span className={`pill ${o.pill}`}><i />{o.words}</span>
      <span>{first.question}{o.answer ? ` · ${o.answer}` : ""}</span>
    </div>
  );
}

/** The waiting question above the message box, with its collapse button. */
export function DockQuestion({ record, trunkName, onResolve }: { record: QuestionRecord; trunkName: string; onResolve: Resolve }) {
  const [collapsed, setCollapsed] = useState(false);
  const first = record.questions[0];
  return (
    <div className={collapsed ? "dock-q col" : "dock-q"} data-testid="dock-question">
      <button type="button" className="ib dock-q-x" aria-label={collapsed ? "Expand question" : "Collapse question"} title={collapsed ? "Expand question" : "Collapse question"} aria-expanded={!collapsed} onClick={() => setCollapsed((c) => !c)}>
        <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={collapsed ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
        </svg>
      </button>
      {collapsed ? <span className="dock-q-t">{first.question}</span> : <QuestionCard key={record.id} record={record} trunkName={trunkName} onResolve={onResolve} />}
    </div>
  );
}

export function QuestionCard({ record, trunkName, onResolve }: { record: QuestionRecord; trunkName: string; onResolve: Resolve }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const many = record.questions.length > 1;
  const q = record.questions[Math.min(at, record.questions.length - 1)];
  const draft = drafts[q.questionId];
  const set = (d: Draft) => setDrafts((cur) => ({ ...cur, [q.questionId]: d }));
  const send = (all: Record<string, Draft>) => {
    setBusy(true);
    setError(null);
    const answers = Object.fromEntries(record.questions.map((x) => [x.questionId, answerValues(x, all[x.questionId])]));
    onResolve(record.id, { answers }).catch((e: unknown) => {
      setBusy(false);
      setError(reason(e));
    });
  };
  const skip = () => {
    setBusy(true);
    onResolve(record.id, { cancel: true }).catch((e: unknown) => {
      setBusy(false);
      setError(reason(e));
    });
  };
  const ready = (d: Record<string, Draft>) => record.questions.every((x) => answerValues(x, d[x.questionId]).length > 0);
  const next = (d: Record<string, Draft>) => (at < record.questions.length - 1 ? setAt(at + 1) : ready(d) && send(d));
  const choose = (label: string) => {
    const d = { ...drafts, [q.questionId]: pick(q, draft, label) };
    setDrafts(d);
    if (!q.multiSelect) next(d);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = KEYS.indexOf(e.key.toUpperCase());
    if (e.ctrlKey || e.metaKey || e.altKey || i < 0 || i >= q.options.length || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    choose(q.options[i].label);
  };
  return (
    <div className="card choice q-card" data-testid="question-card" onKeyDown={onKey} aria-busy={busy}>
      {many ? <div className="q-step">Question {at + 1} of {record.questions.length}</div> : null}
      <div className="q">{q.question}</div>
      {q.multiSelect ? <div className="sub">Pick any that fit.</div> : null}
      {q.url ? <ExternalStep url={q.url} /> : null}
      {q.isSecret ? <SecretLines q={q} trunkName={trunkName} /> : null}
      <Options q={q} draft={draft} disabled={busy} onPick={choose} />
      {typesOwn(q) ? <OwnAnswer q={q} draft={draft} disabled={busy} onType={(t) => set(type(q, draft, t))} onDone={() => next(drafts)} last={!many || at === record.questions.length - 1} /> : null}
      {many || q.multiSelect || q.url ? (
        <div className="card-buttons">
          {many ? <button type="button" className="btn ghost sm" disabled={busy || at === 0} onClick={() => setAt(at - 1)}>Back</button> : null}
          {many ? <button type="button" className="btn ghost sm" disabled={busy} onClick={skip}>Skip</button> : null}
          <button type="button" className={`btn sm ${!many || at === record.questions.length - 1 ? "primary" : ""}`} disabled={busy || answerValues(q, draft).length === 0} onClick={() => next(drafts)}>
            {many && at < record.questions.length - 1 ? "Next" : "Submit"}
          </button>
        </div>
      ) : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}

function Options({ q, draft, disabled, onPick }: { q: Question; draft: Draft | undefined; disabled: boolean; onPick: (label: string) => void }) {
  if (!q.options.length) return null;
  return (
    <div className="opts" role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.question}>
      {q.options.map((o, j) => {
        const on = draft?.selected.includes(o.label) ?? false;
        return (
          <button key={o.label} type="button" className={on ? "opt picked" : "opt"} disabled={disabled} onClick={() => onPick(o.label)}
            {...(q.multiSelect ? { role: "checkbox", "aria-checked": on } : { role: "radio", "aria-checked": on })}>
            {q.multiSelect ? <span className="q-box" aria-hidden="true">{on ? "✓" : ""}</span> : <kbd>{KEYS[j]}</kbd>}
            <b>{o.label}</b>
            {o.description ? <small>{o.description}</small> : null}
          </button>
        );
      })}
    </div>
  );
}

function OwnAnswer({ q, draft, disabled, onType, onDone, last }: { q: Question; draft: Draft | undefined; disabled: boolean; onType: (t: string) => void; onDone: () => void; last: boolean }) {
  const placeholder = q.isSecret ? "Paste the key or password…" : q.options.length ? "Or type your own answer" : "Your answer";
  const text = draft?.text ?? "";
  return (
    <form className="own" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onDone(); }}>
      <input className="inp" type={q.isSecret ? "password" : "text"} autoComplete="off" placeholder={placeholder} aria-label={q.isSecret ? q.question : "Your own answer"} value={text} disabled={disabled} onChange={(e) => onType(e.target.value)} />
      <button className="btn sm" type="submit" disabled={disabled || !text.trim()}>{q.isSecret ? "Submit" : last ? "Reply" : "Next"}</button>
    </form>
  );
}

/** A step the person finishes on a web page first (§4.2.2 "Step elsewhere"). */
function ExternalStep({ url }: { url: string }) {
  return (
    <div className="q-ext">
      <span>{url}</span>
      <button type="button" className="btn sm" onClick={() => window.open(url, "_blank", "noopener")}>Open link</button>
      <small>Finish the step in the new tab, then come back to submit your answer.</small>
    </div>
  );
}

/** Where a secret goes (§4.2.2 "Saves a secret"): who asked, where it is kept and which sites it is sent to. */
function SecretLines({ q, trunkName }: { q: Question; trunkName: string }) {
  const store = q.secretStore;
  return (
    <div className="q-sec">
      <span>Requested by {trunkName}</span>
      {store ? <span>{store.kind === "env" ? `Saves it as an environment variable ${store.name}` : `Saves it as ${store.name} in Saved passwords`}</span> : null}
      {store?.allowedHosts.length ? <span>Only sent to {store.allowedHosts.join(", ")}</span> : null}
    </div>
  );
}
