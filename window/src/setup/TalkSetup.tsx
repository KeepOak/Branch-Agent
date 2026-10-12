// The "Finish by talking" card above the default Trunk's message box (the preview's docked setup question): one
// step at a time, A–D options, the last answer's "Done: …" line, and "Open the setup steps" to go back to the wizard.
import { useState } from "react";
import { LAST } from "./setup-model";
import { asksAgain, doneLine, nextTalkStep, talkQuestion, type TalkOption, type TalkQuestion, type TalkState } from "./talk-setup";
import "../thread/questions.css";

export type TalkHandle = {
  /** The first step to ask. */
  start: number;
  state: TalkState;
  done: (step: number) => boolean;
  /** Does what the wizard's step does with this answer. */
  answer: (q: TalkQuestion, o: TalkOption) => void;
  /** Back to the wizard, at this step. */
  steps: (step: number) => void;
  finish: () => void;
};

const KEYS = "ABCD";
const chev = (d: string) => (
  <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const CHEV_DOWN = chev("M6 9l6 6 6-6");
const CHEV_UP = chev("M6 15l6-6 6 6");

/** A typed answer, read on this computer: the option whose letter or words it names, else null. */
export function matchAnswer(text: string, options: TalkOption[]): TalkOption | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const letter = /^[a-d]$/.test(t) ? options["abcd".indexOf(t)] : undefined;
  if (letter) return letter;
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
  const said = new Set(words(t));
  let best: TalkOption | null = null;
  let score = 0;
  for (const o of options) {
    const n = words(o.label).filter((w) => said.has(w)).length;
    if (n > score) { best = o; score = n; }
  }
  return best;
}
const FINAL: TalkQuestion = { key: "final", step: LAST, part: 0, title: "Setup · All set?", question: "That’s everything. Open Branch and take the two-minute walkthrough?", options: [
  { label: "Open Branch and take the walkthrough", value: "finish" },
  { label: "Check everything first", line: "Branch’s health check, in the setup steps", value: "check" },
] };

export function TalkSetup({ handle }: { handle: TalkHandle }) {
  const [at, setAt] = useState<{ step: number; part: number }>({ step: handle.start, part: 0 });
  const [state, setState] = useState<TalkState>(handle.state);
  const [line, setLine] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const q = at.step >= LAST ? FINAL : talkQuestion(at.step, at.part, state) ?? FINAL;
  const pick = (o: TalkOption) => {
    if (q === FINAL) return o.value === "finish" ? handle.finish() : handle.steps(LAST);
    if (o.value === "steps") return handle.steps(q.step);
    handle.answer(q, o);
    if (q.step === 3) setState((s) => ({ ...s, look: o.value as TalkState["look"] }));
    if (q.step === 4 && o.value !== "enough") setState((s) => ({ ...s, jobs: [...s.jobs, Number(o.value)] }));
    setLine(doneLine(q, o));
    setAt(asksAgain(q, o) ? { step: q.step, part: at.part + 1 } : { step: nextTalkStep(q.step, handle.done), part: 0 });
  };
  const reply = () => {
    const o = matchAnswer(typed, q.options);
    setTyped("");
    if (o) pick(o);
    else setLine("I didn’t catch that. Pick one of the answers, or say it with one of their words.");
  };
  if (collapsed) {
    return (
      <div className="dock-q col talk-setup" data-testid="talk-setup">
        <button type="button" className="ib dock-q-x" aria-label="Expand question" title="Expand question" aria-expanded={false} onClick={() => setCollapsed(false)}>{CHEV_UP}</button>
        <span className="dock-q-t">{q.title}</span>
      </div>
    );
  }
  return (
    <div className="dock-q talk-setup" data-testid="talk-setup">
      <button type="button" className="ib dock-q-x" aria-label="Collapse question" title="Collapse question" aria-expanded onClick={() => setCollapsed(true)}>{CHEV_DOWN}</button>
      <div className="card choice q-card">
        {line ? <p className="talk-done">{line}</p> : null}
        <div className="q">{q.title}</div>
        <div className="sub">{q.question}</div>
        <div className="opts" role="radiogroup" aria-label={q.question}>
          {q.options.map((o, j) => (
            <button key={o.value} type="button" className="opt" role="radio" aria-checked={false} onClick={() => pick(o)}>
              <kbd>{KEYS[j]}</kbd>
              <b>{o.label}</b>
              {o.line ? <small>{o.line}</small> : null}
            </button>
          ))}
        </div>
        {q === FINAL ? null : (
          <form className="own" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) reply(); }}>
            <input className="inp" type="text" autoComplete="off" placeholder="Or type your own answer" aria-label="Your own answer" value={typed} onChange={(e) => setTyped(e.target.value)} />
            <button className="btn sm" type="submit" disabled={!typed.trim()}>Reply</button>
          </form>
        )}
        <button type="button" className="link talk-steps" onClick={() => handle.steps(q === FINAL ? LAST : q.step)}>Open the setup steps</button>
      </div>
    </div>
  );
}
