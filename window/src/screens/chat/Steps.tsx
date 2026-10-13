// The calm steps display (owner item 26, HANDOFF §2 #15): one plain summary line; open, one row per step; a row opens
// to its input (once), its output and "Exit code N" on failure. Thoughts follow "Show agents' work as".
import { useState } from "react";
import { createPortal } from "react-dom";
import { copyText, useThread } from "../../thread/context";
import { Dialog } from "../../thread/Dialog";
import { stepExitCode, stepInputLines, stepKind, stepLabel, stepOutputFilename } from "../../thread/format";
import { StepKindIcon } from "../../thread/icons";
import { Icon } from "../../shell/icons";
import { fullOutput, type Block } from "../../thread/model";
import { stepsLine, type WorkMode } from "./chat-logic";

type Step = Extract<Block, { kind: "step" }>;
type Thought = Extract<Block, { kind: "thinking" }>;

/** The person's open/closed choice per fold, kept while the window lives (a re-render never closes it). */
const opened = new Map<string, boolean>();

function useFold(id: string, initial: boolean): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(() => opened.get(id) ?? initial);
  return [open, (next) => { opened.set(id, next); setOpen(next); }];
}

/** "Read a file, ran 2 commands… ● 1 failed · 1m 48s ⌄" */
export function StepsList({ steps, thoughts = [], live, run, mode }: { steps: Step[]; thoughts?: Thought[]; live: boolean; run?: { title: string; durationMs?: number }; mode: WorkMode }) {
  const id = steps[0]?.key ?? thoughts[0]?.key ?? "steps";
  const [open, setOpen] = useFold(id, mode === "verbose");
  const line = stepsLine(steps, live ? undefined : run);
  const shownThoughts = mode === "normal" ? [] : thoughts;
  const label = (line.live ? "Working: " : "") + line.text + (line.failed ? ", " + line.failed + " failed" : "") + (line.meta ? ", " + line.meta : "");
  return <details className="r1c-steps" open={open || mode === "verbose"} onToggle={(e) => setOpen(e.currentTarget.open)} data-testid="steps" data-live={line.live || undefined}>
    <summary aria-label={label} data-local="">
      {line.live ? <span className="r1c-spin" aria-hidden="true" /> : null}
      <span className="r1c-steps-text">{line.text}</span>
      {line.failed ? <><span className="r1c-bad-dot" aria-hidden="true" /><span className="r1c-steps-meta">{line.failed} failed</span></> : null}
      {line.meta ? <span className="r1c-steps-meta">{line.failed ? "· " : ""}{line.meta}</span> : null}
      <span className="r1c-chev" aria-hidden="true"><Icon name="down" size={13} /></span>
    </summary>
    <ol className="r1c-steps-list">
      {shownThoughts.filter((t) => t.text.trim()).map((t) => <ThoughtRow key={t.key} thought={t} mode={mode} />)}
      {steps.map((step) => <StepRow key={step.key} step={step} mode={mode} />)}
    </ol>
  </details>;
}

/** A thought on its own (no steps around it): the same quiet row, outside a list, in Thinking and Verbose only. */
export function LoneThought({ thought, mode }: { thought: Thought; mode: WorkMode }) {
  if (mode === "normal" || !thought.text.trim()) return null;
  return <ol className="r1c-steps-list r1c-lone"><ThoughtRow thought={thought} mode={mode} /></ol>;
}

/** The first sentence (20–110 characters) of a thought, as its row title. */
function firstLine(text: string): string {
  const s = text.replace(/\s+/g, " ").trim();
  const m = /^.{20,110}?[.!?](\s|$)/.exec(s);
  return m ? m[0].trim() : s.length > 110 ? s.slice(0, 107) + "…" : s;
}

function ThoughtRow({ thought, mode }: { thought: Thought; mode: WorkMode }) {
  const [open, setOpen] = useFold(thought.key, mode === "verbose");
  return <li className="r1c-step r1c-thought" data-testid="thought">
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary data-local=""><Icon name="spark" size={14} /><span className="r1c-step-title">{firstLine(thought.text)}</span><span className="r1c-rt" aria-hidden="true"><Icon name="chev" size={13} /></span></summary>
      <div className="r1c-step-detail"><p className="r1c-thought-text">{thought.text}</p></div>
    </details>
  </li>;
}

function save(name: string, text: string, toast: (t: string) => void) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
  toast("Saved " + name + ".");
}

function StepRow({ step, mode }: { step: Step; mode: WorkMode }) {
  const { toast } = useThread();
  const [open, setOpen] = useFold(step.key, mode === "verbose");
  const [full, setFull] = useState(false);
  const failed = step.status === "failed" || step.status === "denied";
  const exit = stepExitCode(step.detail);
  const whole = (fullOutput(step.outputKey ?? step.key) ?? step.output ?? "").replace(/\s+$/u, "");
  const input = step.input ? stepInputLines(step.input) : [];
  const title = stepLabel(step);
  const sub = step.title && step.title !== title ? step.title : "";
  return <li className="r1c-step" data-testid="step" data-status={step.status} data-kind={step.tool}>
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary data-local="">
        {step.status === "running" ? <span className="r1c-spin" aria-hidden="true" /> : <StepKindIcon kind={stepKind(step.tool)} size={14} />}
        <span className="r1c-step-title">{title}{sub ? <span className="r1c-step-sub"> · {sub}</span> : null}</span>
        {failed ? <span className="r1c-bad-dot" aria-label={step.status === "denied" ? "Not allowed" : "Failed"} /> : null}
        <span className="r1c-rt" aria-hidden="true"><Icon name="chev" size={13} /></span>
      </summary>
      <div className="r1c-step-detail">
        {input.length ? <div className="r1c-step-input" data-testid="step-input">{input.map((l, i) => <div key={i}>{l}</div>)}</div> : null}
        {step.changes?.map((c) => <div key={c.path} className="r1c-step-file"><code>{c.path}</code> <b className="r1c-add">+{c.added}</b> <b className="r1c-del">−{c.removed}</b></div>)}
        {whole ? <div className="r1c-out" data-testid="step-output">
          <pre>{whole}</pre>
          <span className="r1c-out-icons">
            <button type="button" aria-label="Copy output" title="Copy output" data-local="" onClick={() => void copyText(whole, toast)}><Icon name="copy" size={13} /></button>
            <button type="button" aria-label="Save output" title="Save output" data-local="" onClick={() => save(stepOutputFilename(step.title || title), whole, toast)}><Icon name="download" size={13} /></button>
            <button type="button" aria-label="Show full output" title="Show full output" data-local="" onClick={() => setFull(true)}><Icon name="maximize" size={13} /></button>
          </span>
        </div> : step.status !== "running" && !input.length && !step.changes?.length ? <p className="r1c-step-none">{failed ? "No output · it failed." : "No output · it finished."}</p> : null}
        {exit != null ? <p className="r1c-step-err">Exit code {exit}</p> : failed && step.detail && !/^Exit /.test(step.detail) ? <p className="r1c-step-err">{step.detail}</p> : null}
      </div>
    </details>
    {/* Over the whole window: inside the steps list, its glass would hold the fixed scrim to the list's own box. */}
    {full ? createPortal(<Dialog title="Full output" clear onClose={() => setFull(false)} testid="step-full-output" footer={<button type="button" className="btn primary" data-solid="" onClick={() => setFull(false)}>Close</button>}>
      <pre className="r1c-full g-label" data-lines>{whole}</pre>
    </Dialog>, document.body) : null}
  </li>;
}
