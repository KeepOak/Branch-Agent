// The thread's block kinds (DESIGN-SPEC §4.2.2): your message, the Trunk's reply, thinking, steps, Done,
// "Couldn't finish" and notes. Hooks for the scripts: data-testid="message" with data-role, "step" with
// data-kind, "run-done".
import { useEffect, useState, type ReactNode } from "react";
import { Face } from "../face/Face";
import type { AgentState } from "../face/agentState";
import { Attachments } from "./Attachments";
import { copyText, useThread } from "./context";
import { useFreshClass } from "./fresh";
import { Dialog } from "./Dialog";
import {
  formatDuration,
  parseDiffLines,
  rawDiffText,
  shortReason,
  stepExitCode,
  stepInputLines,
  stepKind,
  stepLabel,
  stepOutputFilename,
  stepOutputTail,
  stepsSummary,
} from "./format";
import { Icon, ICONS, StepKindIcon } from "./icons";
import { Markdown } from "./markdown";
import { computerStepDetail, isComputerToolName, isScreenToolName } from "./computer-action-label";
import { fullOutput, type Block, type FileChange } from "./model";
import { readTextToolCall, stepFromTextToolCall } from "./text-tool-call";
import { withMentions } from "../rooms/RoomMessage";

type Of<K extends Block["kind"]> = Extract<Block, { kind: K }>;

/** Asks the window to open a workspace file from a step's File changes card (preview pathPB18). */
export const OPEN_FILE_EVENT = "branch:open-file";

/** Over 1,200 characters or 40 lines, your message shows its first 5 lines (§4.2.2 Parity adds "Long messages"). */
export function isLong(text: string): boolean {
  return text.length > 1200 || text.split("\n").length > 40;
}

export function UserMessage({ block, children }: { block: Of<"user">; children?: ReactNode }) {
  const long = isLong(block.text);
  const [open, setOpen] = useState(false);
  const fresh = useFreshClass(block.key);
  return (
    <div className={`msg user-msg${block.meta?.excluded ? " left-out" : ""}${fresh}`} data-entry={block.meta?.entryId}>
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
  const call = readTextToolCall(block.text);
  const step = call ? stepFromTextToolCall(call, block.key) : null;
  const fresh = useFreshClass(block.key);
  return (
    <div className={`msg reply${block.meta?.excluded ? " left-out" : ""}${fresh}`} data-entry={block.meta?.entryId}>
      {children}
      <span className="gutter">{face ? <span className={working ? "gutter-face working-ring" : "gutter-face"}>{face}</span> : null}</span>
      <div className="reply-text" data-testid="message" data-role="assistant">
        {from ? <div className="reply-from">{from}</div> : null}
        {step ? (
          <ol className="step-list">
            <StepRow step={step} />
          </ol>
        ) : block.text ? (
          <Markdown text={block.text} />
        ) : null}
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

function saveTextFile(name: string, text: string, toast: (msg: string) => void): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  toast(`Saved ${name}.`);
}

/** Preview outPB18: last 4 lines, Exit code pill, Show full output · Copy output · Save output. */
function StepOutput({ step }: { step: Of<"step"> }) {
  const { toast } = useThread();
  const [fullOpen, setFullOpen] = useState(false);
  const outputKey = step.outputKey ?? step.key;
  const whole = (fullOutput(outputKey) ?? step.output ?? "").replace(/\s+$/u, "");
  const done = step.status !== "running";
  const exit = stepExitCode(step.detail);
  if (!whole) {
    const ran = stepKind(step.tool) === "run" || step.output != null || Boolean(step.outputKey);
    return done && ran ? <p className="nout-pb18 step-none">{step.status === "ok" ? "No output · it finished." : "No output · it failed."}</p> : null;
  }
  const tail = stepOutputTail(whole);
  const name = stepOutputFilename(step.title || stepLabel(step));
  return (
    <div className="out-pb18 step-output" data-testid="step-output">
      <pre>{tail}</pre>
      {exit != null ? <span className="pill no"><i />Exit code {exit}</span> : null}
      <div className="acts row-buttons">
        <button type="button" className="btn ghost sm" onClick={() => setFullOpen(true)}>Show full output</button>
        <button type="button" className="btn ghost sm" onClick={() => void copyText(whole, toast)}>Copy output</button>
        <button type="button" className="btn ghost sm" onClick={() => saveTextFile(name, whole, toast)}>Save output</button>
      </div>
      {fullOpen ? (
        <Dialog
          title="Full output"
          onClose={() => setFullOpen(false)}
          testid="step-full-output"
          footer={
            <>
              <button type="button" className="btn ghost" onClick={() => void copyText(whole, toast)}>Copy output</button>
              <button type="button" className="btn primary" onClick={() => setFullOpen(false)}>Close</button>
            </>
          }
        >
          {step.title ? <p className="hint"><code>{step.title}</code></p> : null}
          {fullOutput(outputKey) ? <p className="hint">Only part of the output was kept.</p> : null}
          <pre className="err-pb18">{whole}</pre>
        </Dialog>
      ) : null}
    </div>
  );
}

function FileChangeRow({ change }: { change: FileChange }) {
  const { engine, sessionKey, toast } = useThread();
  const [raw, setRaw] = useState(false);
  const [opened, setOpened] = useState<string | null>(null);
  const lines = change.diff ? parseDiffLines(change.diff) : [];
  const body = raw
    ? rawDiffText(lines)
    : lines.map((line) => `${line.mark === " " ? "  " : `${line.mark} `}${line.text}`).join("\n");
  const openFile = () => {
    window.dispatchEvent(new CustomEvent(OPEN_FILE_EVENT, { detail: { path: change.path } }));
    if (!engine || !sessionKey) {
      toast("The Files pane opens this from the conversation’s folder.");
      return;
    }
    void engine.request<{ file?: { content?: string } }>("sessions.files.get", { sessionKey, path: change.path }).then(
      (result) => setOpened(typeof result.file?.content === "string" ? result.file.content : change.diff ?? ""),
      (error: unknown) => toast(error instanceof Error ? error.message : String(error)),
    );
  };
  return (
    <div className="fch-row-pb18">
      <div className="fch-top-pb18">
        <code>{change.path}</code>
        <span className="fch-n-pb18"><b className="a">+{change.added}</b> <b className="d">−{change.removed}</b></span>
        <span className="seg" role="group" aria-label={`Show ${change.path} as`}>
          <button type="button" aria-pressed={!raw} onClick={() => setRaw(false)}>Diff</button>
          <button type="button" aria-pressed={raw} onClick={() => setRaw(true)}>Raw</button>
        </span>
        <button type="button" className="btn ghost sm" onClick={openFile}>Open file</button>
      </div>
      {body ? (
        <pre className="diff-pb18" data-testid={raw ? "file-raw" : "file-diff"}>
          {raw
            ? body
            : lines.map((line, i) => (
                <span key={i} className={line.mark === "+" ? "add" : line.mark === "-" ? "del" : ""}>
                  {line.mark === " " ? `  ${line.text}` : `${line.mark} ${line.text}`}
                </span>
              ))}
        </pre>
      ) : null}
      {opened != null ? (
        <Dialog
          title={change.path}
          onClose={() => setOpened(null)}
          testid="step-open-file"
          footer={<button type="button" className="btn primary" onClick={() => setOpened(null)}>Close</button>}
        >
          <pre className="err-pb18">{opened}</pre>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Preview fileChangesPB18: File changes / Attempted changes, +/−, Diff · Raw, Open file. */
function ChangedFiles({ step }: { step: Of<"step"> }) {
  if (!step.changes?.length) return null;
  const failed = step.status === "failed" || step.status === "denied";
  return (
    <div className="card fch-pb18" data-testid="files-changed">
      <div className="card-h"><b>{failed ? "Attempted changes" : "File changes"}</b></div>
      {step.changes.map((change) => <FileChangeRow key={change.path} change={change} />)}
    </div>
  );
}

const STEP_STATE: Record<Of<"step">["status"], string> = { running: "Running", ok: "Done", failed: "Failed", denied: "Not allowed" };

function StepInput({ input }: { input: string }) {
  const lines = stepInputLines(input);
  if (!lines.length) return null;
  return (
    <div className="step-input" data-testid="step-input">
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );
}

function StepRow({ step }: { step: Of<"step"> }) {
  const kind = stepKind(step.tool);
  const exit = stepExitCode(step.detail);
  const failed = step.status === "failed" || step.status === "denied";
  const [open, setOpen] = useState(true);
  const label = stepLabel(step);
  const detail = isComputerToolName(step.tool) || isScreenToolName(step.tool) ? computerStepDetail(step, label) : step.title || undefined;
  return (
    <li
      className={`step step-pb18${failed ? " errR118" : ""}`}
      data-testid="step"
      data-kind={step.tool}
      data-step-kind={kind ?? "check"}
      data-status={step.status}
    >
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
      <StepKindIcon kind={kind} className="s" />
      <span>
        <span className="step-label">{label}</span>
        {detail ? <small className="step-detail">{detail}</small> : null}
      </span>
      <span className="step-state">{STEP_STATE[step.status]}{exit != null ? ` · Exit code ${exit}` : ""}</span>
      </summary>
      <div className="step-body">
        {step.input ? <StepInput input={step.input} /> : null}
        <ChangedFiles step={step} />
        <StepOutput step={step} />
      </div>
      </details>
    </li>
  );
}

const foldChoice = new Map<string, boolean>();

/** Test hook: forget which steps folds the person opened or closed. */
export function resetStepsFoldChoice(): void {
  foldChoice.clear();
}

/** Steps fold (§4.2.2): open while the run is live; keep the person's choice when it finishes. */
export function StepsFold({ steps, live, run }: { steps: Of<"step">[]; live: boolean; run?: { title: string; durationMs?: number } }) {
  const id = steps[0]?.key ?? "";
  if (live && id && !foldChoice.has(id)) foldChoice.set(id, true);
  const [open, setOpen] = useState(() => foldChoice.get(id) ?? live);
  return (
    <details
      className="fold steps-fold steps-pb18 stepsR118 indent"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (id) foldChoice.set(id, next);
        setOpen(next);
      }}
    >
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

/** "Done in <duration>", starting with this Trunk's 20 px face in its "yay" state (§4.2.2 "Done in"). A turn you
 *  stopped says so instead, with the red Stopped pill (§4.2.2 Status pills). */
export function DoneLine({ block, name, words }: { block: Of<"done">; name: string; words: number }) {
  const state: AgentState = "yay";
  if (block.stopped) {
    return (
      <div className="done-line indent stopped" data-testid="run-stopped">
        <span className="pill bad"><i />Stopped</span>
        What it did so far is kept.
      </div>
    );
  }
  return (
    <div className="done-line indent" data-testid="run-done">
      <Face size={20} label={name} state={state} />
      {block.durationMs ? `Done in ${formatDuration(block.durationMs)}` : "Done"}{words ? ` · ${words} ${words === 1 ? "word" : "words"}` : ""}
    </div>
  );
}

/** Asks the window to open the Gateway popover (§4.9.3) from the thread ("Couldn't finish" › Check status). */
export const CHECK_STATUS_EVENT = "branch:check-status";

/** The real Settings switch named by the computer tool when no device is connected. */
export const SCREEN_CONTROL_SWITCH = "See the screen and use the mouse";

export function isScreenControlSetupError(message: string): boolean {
  return message.includes(SCREEN_CONTROL_SWITCH);
}

function openScreenControlSwitch(): void {
  window.dispatchEvent(new CustomEvent("branch:navigate-settings", { detail: { page: "computer" } }));
}

/** "Couldn't finish" (§4.2.2 Parity adds): the reason, a Details fold, Copy error, Check status and × Dismiss. */
export function ErrorBlock({ block, onDismiss }: { block: Of<"error">; onDismiss: () => void }) {
  const { name, toast } = useThread();
  const screenSwitch = isScreenControlSetupError(block.message);
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
        {screenSwitch ? (
          <button type="button" className="btn sm" data-testid="open-screen-control" onClick={openScreenControlSwitch}>
            Open that switch
          </button>
        ) : null}
        <button type="button" className="btn sm ghost" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); window.dispatchEvent(new CustomEvent(CHECK_STATUS_EVENT, { detail: { left: r.left, right: r.right, top: r.top } })); }}>
          Check status
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
