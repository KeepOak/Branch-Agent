// The thread's block kinds (DESIGN-SPEC §4.2.2): your message, the Trunk's reply, thinking, steps, Done,
// "Couldn't finish" and notes. Hooks for the scripts: data-testid="message" with data-role, "step" with
// data-kind, "run-done".
import { useState, type ReactNode } from "react";
import { Face } from "../face/Face";
import type { AgentState } from "../face/agentState";
import { Attachments } from "./Attachments";
import { copyText, useThread } from "./context";
import { formatDuration, phaseWords, shortReason, stepLabel, stepsSummary } from "./format";
import { Icon, ICONS } from "./icons";
import { Markdown } from "./markdown";
import type { Block } from "./model";
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
    <div className="msg user-msg" data-entry={block.meta?.entryId}>
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

/** A Trunk's reply. `face` is the gutter character, shown only on the first block of a run (§4.2.2 gutter rule). */
export function Reply({ block, face, from, children }: { block: Of<"text">; face?: ReactNode; from?: string; children?: ReactNode }) {
  return (
    <div className="msg reply" data-entry={block.meta?.entryId}>
      {children}
      <span className="gutter">{face}</span>
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
  if (block.live) {
    return (
      <div className="thinking indent" data-testid="thinking">
        <Icon d={ICONS.spark} className="spark" />
        <span>{block.text}</span>
      </div>
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
  const output = (step.output ?? "").trimEnd();
  const done = step.status !== "running";
  if (!output) {
    return done ? <p className="step-none">{step.status === "ok" ? "No output · it finished." : "No output · it failed."}</p> : null;
  }
  const lines = output.split("\n");
  const tail = lines.slice(-12).join("\n");
  return (
    <div className="step-output">
      <pre>{tail}</pre>
      <div className="row-buttons">
        <button type="button" className="btn sm ghost" onClick={() => void copyText(output, toast)}>
          Copy output
        </button>
      </div>
    </div>
  );
}

function StepRow({ step }: { step: Of<"step"> }) {
  const mark = step.status === "ok" ? ICONS.check : step.status === "running" ? ICONS.spin : ICONS.x;
  return (
    <li className="step" data-testid="step" data-kind={step.tool} data-status={step.status}>
      <span className={`step-mark ${step.status}`}>
        <Icon d={mark} />
      </span>
      <div className="step-body">
        <span className="step-label">{stepLabel(step)}</span>
        <code className="step-detail">{step.title}</code>
        <StepOutput step={step} />
      </div>
    </li>
  );
}

/** Steps fold (§4.2.2): closed in the history, open while the run is live, so steps show as they happen. */
export function StepsFold({ steps, live }: { steps: Of<"step">[]; live: boolean }) {
  const [open, setOpen] = useState(live);
  return (
    <details className="fold steps-fold indent" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <Icon d={ICONS.chev} className="chev" />
        {stepsSummary(steps)}
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
export function DoneLine({ block, name }: { block: Of<"done">; name: string }) {
  const state: AgentState = "yay";
  return (
    <div className="done-line indent" data-testid="run-done">
      <Face size={20} label={name} state={state} />
      {block.durationMs ? `Done in ${formatDuration(block.durationMs)}` : "Done"}
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

/** Typing dots with this Trunk's face in its "think" state, and the getting-started words (§4.2.2, §4.2.5). */
export function Typing({ name, status }: { name: string; status: Of<"status"> | null }) {
  const words = status ? phaseWords(status) : "";
  return (
    <div className="msg reply" aria-label="Typing" data-testid="typing">
      <span className="gutter">
        <Face size={28} label={name} state="think" priority={300} />
      </span>
      <div className="typing">
        <i />
        <i />
        <i />
        {words ? <span className="typing-words">{words}</span> : null}
      </div>
    </div>
  );
}
