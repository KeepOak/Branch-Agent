// The thread's block kinds (DESIGN-SPEC §4.2.2): your message, the Trunk's reply, thinking, steps, Done,
// "Couldn't finish" and notes. Hooks for the scripts: data-testid="message" with data-role, "step" with
// data-kind, "run-done".
import { useEffect, useState, type ReactNode } from "react";
import { Face } from "../face/Face";
import type { AgentState } from "../face/agentState";
import { Attachments } from "./Attachments";
import { copyText, useThread } from "./context";
import { formatDuration, shortReason, stepLabel, stepsSummary } from "./format";
import { Icon, ICONS } from "./icons";
import { Markdown } from "./markdown";
import { fullOutput, type Block } from "./model";
import { withMentions } from "../rooms/RoomMessage";

type Of<K extends Block["kind"]> = Extract<Block, { kind: K }>;

/** Over 1,200 characters or 40 lines, your message shows its first 5 lines (§4.2.2 Parity adds "Long messages"). */
export function isLong(text: string): boolean {
  return text.length > 1200 || text.split("\n").length > 40;
}

export function UserMessage({ block, children }: { block: Of<"user">; children?: ReactNode }) {
  const long = isLong(block.text);
  const [open, setOpen] = useState(false);
  return (
    <div className={`msg user-msg${block.meta?.excluded ? " left-out" : ""}`} data-entry={block.meta?.entryId}>
      {children}
      {block.meta?.via ? (
        <span className="via-line">
          <Icon d={ICONS.chat} size={12} />
          {block.meta.via}
        </span>
      ) : null}
      <div className={long && !open ? "bubble folded" : "bubble"} data-testid="message" data-role="user">
        {block.attachments?.length ? <Attachments items={block.attachments} mine /> : null}
        {withMentions(block.text)}
      </div>
      {long ? (
        <button type="button" className="link-btn" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

/** Steered note (§4.2.2): what you told the Trunk while it worked, inside that turn (the preview's `.steered-b17`). */
export function SteeredNote({ name, text }: { name: string; text: string }) {
  return (
    <div className="steered-note indent" role="note" data-testid="steered-note">
      <Icon d={ICONS.retry} size={14} />
      <span>You steered {name}: “{text}”. It takes this at its next step; nothing done so far is lost.</span>
    </div>
  );
}

/** Your message that didn't go (§4.2.2 Parity adds "Not sent"): it stays, with a red pill, the reason, Try again
 *  and Discard. */
export function NotSent({ text, reason, onRetry, onDiscard }: { text: string; reason: string; onRetry: () => void; onDiscard: () => void }) {
  const why = shortReason(reason.replace(/^\s*Error:\s*/i, ""));
  return (
    <div className="queued-msg not-sent" data-testid="not-sent">
      <UserMessage block={{ kind: "user", key: "not-sent", text }} />
      <div className="send-status mine">
        <span className="pill bad"><i />Not sent</span>
        {why ? <span className="send-why" title={reason}>{why}</span> : null}
        <button type="button" className="btn ghost sm" onClick={onRetry}>Try again</button>
        <button type="button" className="btn ghost sm" title="Removes this copy." onClick={onDiscard}>Discard</button>
      </div>
    </div>
  );
}

/** A Trunk's reply. `face` is the gutter character, shown only on the first block of a run (§4.2.2 gutter rule). */
export function Reply({ block, face, from, working, children }: { block: Of<"text">; face?: ReactNode; from?: string; working?: boolean; children?: ReactNode }) {
  return (
    <div className={`msg reply${block.meta?.excluded ? " left-out" : ""}`} data-entry={block.meta?.entryId}>
      {children}
      <span className="gutter">{face ? <span className={working ? "gutter-face working-ring" : "gutter-face"}>{face}</span> : null}</span>
      <div className="reply-text" data-testid="message" data-role="assistant">
        {from ? <div className="reply-from">{from}</div> : null}
        {block.text ? <Markdown text={block.text} /> : null}
        {block.attachments?.length ? <Attachments items={block.attachments} /> : null}
      </div>
    </div>
  );
}

/** Live: the spark and the reasoning in italics. Finished: a closed fold under the reply (§4.2.2 rule 5). */
export function Thinking({ block }: { block: Of<"thinking"> }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!block.live || block.text) return;
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [block.live, block.text]);
  if (block.live) {
    return (
      <details className="fold indent" data-testid="thinking">
        <summary><Icon d={ICONS.spark} className="spark" />{block.text ? "Thinking" : `Thinking… · ${seconds}s`}</summary>
        {block.text ? <p className="fold-body thinking-text">{block.text}</p> : null}
      </details>
    );
  }
  return (
    <details className="fold indent" data-testid="thinking">
      <summary>
        <Icon d={ICONS.chev} className="chev" />
        Thinking
      </summary>
      <p className="fold-body thinking-text">{block.text}</p>
    </details>
  );
}

function StepOutput({ step }: { step: Of<"step"> }) {
  const { toast } = useThread();
  const [all, setAll] = useState(false);
  const outputKey = step.outputKey ?? step.key;
  const expanded = all ? fullOutput(outputKey) : undefined;
  const output = (expanded ?? step.output ?? "").trimEnd();
  const done = step.status !== "running";
  if (!output) {
    return done ? <p className="step-none">{step.status === "ok" ? "No output · it finished." : "No output · it failed."}</p> : null;
  }
  const lines = output.split("\n");
  const tail = lines.slice(-12).join("\n");
  return (
    <div className="step-output">
      <pre>{all ? output : tail}</pre>
      <div className="row-buttons">
        {lines.length > 12 || fullOutput(outputKey) ? <button type="button" className="btn sm ghost" onClick={() => setAll((v) => !v)}>{all ? "Show less" : "Show all"}</button> : null}
        <button type="button" className="btn sm ghost" onClick={() => void copyText(fullOutput(outputKey) ?? output, toast)}>
          Copy output
        </button>
      </div>
    </div>
  );
}

function ChangedFiles({ step }: { step: Of<"step"> }) {
  if (!step.changes?.length) return null;
  return <div className="changed-files" data-testid="files-changed">
    <b>Files changed</b>
    {step.changes.map((change) => <details key={change.path}>
      <summary>{change.path} <span>+{change.added} −{change.removed}</span></summary>
      {change.diff ? <pre>{change.diff}</pre> : null}
    </details>)}
  </div>;
}

const STEP_STATE: Record<Of<"step">["status"], string> = { running: "Running", ok: "Done", failed: "Failed", denied: "Not allowed" };

function StepRow({ step }: { step: Of<"step"> }) {
  const mark = step.status === "ok" ? ICONS.check : step.status === "running" ? ICONS.spin : ICONS.x;
  const exit = /^Exit \d+/.test(step.detail) ? step.detail : "";
  // The detail is the output's first lines unless it says how the call ended; don't print the output twice.
  const detail = !exit && step.detail && !(step.output ?? "").startsWith(step.detail) ? step.detail : "";
  return (
    <li className="step" data-testid="step" data-kind={step.tool} data-status={step.status}>
      <details>
      <summary>
      <span className={`step-mark ${step.status}`}>
        <Icon d={mark} />
      </span>
      <span className="step-label">{stepLabel(step)}</span>{step.title ? <> <code className="step-detail">{step.title}</code></> : null}
      <span className="step-state">{STEP_STATE[step.status]}{exit ? ` · ${exit}` : ""}</span>
      </summary>
      <div className="step-body">
        {step.input ? <pre className="step-input" data-testid="step-input">{step.input}</pre> : null}
        {detail ? <span>{detail}</span> : null}
        <ChangedFiles step={step} />
        <StepOutput step={step} />
      </div>
      </details>
    </li>
  );
}

/** Steps fold (§4.2.2): closed in the history, open while the run is live, so steps show as they happen. */
export function StepsFold({ steps, live, run }: { steps: Of<"step">[]; live: boolean; run?: { title: string; durationMs?: number } }) {
  const [open, setOpen] = useState(live);
  return (
    <details className="fold steps-fold indent" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Icon d={ICONS.chev} className="chev" />
        {stepsSummary(steps, live ? undefined : run)}
      </summary>
      <ol className="step-list">
        {steps.map((s) => (
          <StepRow key={s.key} step={s} />
        ))}
      </ol>
    </details>
  );
}

/** "Done in <duration>", starting with this Trunk's 20 px face in its "yay" state (§4.2.2 "Done in"). */
export function DoneLine({ block, name, words }: { block: Of<"done">; name: string; words: number }) {
  const state: AgentState = "yay";
  return (
    <div className="done-line indent" data-testid="run-done">
      <Face size={20} label={name} state={state} />
      {block.durationMs ? `Done in ${formatDuration(block.durationMs)}` : "Done"}{words ? ` · ${words} ${words === 1 ? "word" : "words"}` : ""}
    </div>
  );
}

/** "Couldn't finish" (§4.2.2 Parity adds): the reason, a Details fold, Copy error, and × Dismiss. */
export function ErrorBlock({ block, onDismiss }: { block: Of<"error">; onDismiss: () => void }) {
  const { name, toast } = useThread();
  return (
    <div className="strip indent" data-testid="run-error" role="alert">
      <div className="strip-line">
        <Icon d={ICONS.warn} />
        <span>
          {name} couldn’t finish: {shortReason(block.message)}
        </span>
        <button type="button" className="icon-sm" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
          <Icon d={ICONS.x} />
        </button>
      </div>
      <details className="fold">
        <summary>
          <Icon d={ICONS.chev} className="chev" />
          Details
        </summary>
        <pre className="fold-body mono">{block.message}</pre>
      </details>
      <div className="row-buttons">
        <button type="button" className="btn sm ghost" onClick={() => void copyText(block.message, toast)}>
          Copy error
        </button>
      </div>
    </div>
  );
}

/** A note the engine put in the conversation (§4.2.2 Parity adds "System notices"), in the Pass line style. */
export function Notice({ block }: { block: Of<"notice"> }) {
  return (
    <div className="pass-line" data-testid="notice">
      {block.text}
    </div>
  );
}

/** While a turn runs, the face and dots alone indicate typing (#31). */
export function Typing({ name }: { name: string }) {
  return (
    <div className="msg reply" aria-label="Typing" data-testid="typing">
      <span className="gutter">
        <Face size={28} label={name} state="think" priority={300} />
      </span>
      <div className="typing">
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}
