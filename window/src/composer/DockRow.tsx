// The dock row above the composer (DESIGN-SPEC §4.3.7): waiting line, background, goal, attachments, the people a
// message tells, and Steer. Chip order is fixed (rule 1); the row shows only when it has a chip.
import { useEffect, useRef, useState } from "react";
import { formatSize, preparingLine, type DraftFile } from "./attachments";
import { Pebble } from "../face/Pebble";
import { Icon } from "./icons";
import { Popover } from "./Popover";
import { chipWords, type QueueItem } from "./queue";

export type BackgroundJob = { key: string; title: string; running: boolean; step: string };
export type Goal = { id: string; objective: string; status: string; rounds: number; note: string };
export type Person = { profileId: string; name: string };

type Props = {
  trunkName: string;
  working: boolean;
  offline: boolean;
  line: QueueItem[];
  onReword: (id: string, text: string) => void;
  onMoveUp: (id: string) => void;
  onRemove: (id: string) => void;
  onSteerQueued: (id: string) => void;
  onRetry: (id: string) => void;
  jobs: BackgroundJob[];
  onStopJob: (key: string) => void;
  onOpenJob?: (key: string) => void;
  goal: Goal | null;
  onGoal: (action: "pause" | "resume" | "clear" | "edit", text?: string) => void;
  files: DraftFile[];
  preparing: number;
  onRemoveFile: (id: string) => void;
  onShowText: (id: string) => void;
  people: Person[];
  onForget: (profileId: string) => void;
  onSteer: (text: string) => Promise<boolean>;
  /** The plan's progress while the Trunk works ("1 of 4"); shown only while the Plan card is out of view. */
  plan?: { done: number; total: number; steps: { step: string; status: string }[] } | null;
  /** "Task progress starts" (§4.7.1): the plan above the box starts open or folded; on a phone always folded. */
  planStarts?: "open" | "folded";
};

const GOAL_STATE: Record<string, string> = {
  active: "Working toward it",
  paused: "Paused",
  blocked: "Blocked",
  complete: "Done",
  usage_limited: "Paused",
  budget_limited: "Paused",
};

function goalChip(goal: Goal): string {
  if (goal.status === "paused") return "Goal paused";
  if (goal.status === "blocked") return "Goal blocked";
  return `Goal · round ${goal.rounds}`;
}

export function DockRow(p: Props) {
  const [open, setOpen] = useState<"queue" | "bg" | "goal" | "steer" | null>(null);
  const refs = { queue: useRef<HTMLButtonElement>(null), bg: useRef<HTMLButtonElement>(null), goal: useRef<HTMLButtonElement>(null), steer: useRef<HTMLButtonElement>(null) };
  const toggle = (k: NonNullable<typeof open>) => setOpen(open === k ? null : k);
  const close = () => setOpen(null);
  const finished = p.jobs.filter((j) => !j.running).length;
  const running = p.jobs.length - finished;
  const has = p.line.length || p.jobs.length || p.goal || p.files.length || p.preparing || p.people.length || p.working;
  // the plan chip shows only while working, so `working` already covers it
  if (!has) return null;
  return (
    <div className="c-dock-row" data-testid="dock-row">
      {p.line.length ? (
        <button ref={refs.queue} type="button" className="c-chip" data-testid="queue-chip" aria-expanded={open === "queue"} onClick={() => toggle("queue")}>
          <Icon name="clock" size={14} />
          {chipWords(p.line.length, p.offline)}
        </button>
      ) : null}
      {p.jobs.length ? (
        <button ref={refs.bg} type="button" className="c-chip" data-testid="bg-chip" aria-expanded={open === "bg"} onClick={() => toggle("bg")}>
          {running ? <i className="c-bgdot" /> : <Icon name="check" size={14} />}
          {running ? `${running} in the background` : `${finished} finished in the background`}
        </button>
      ) : null}
      {p.goal ? (
        <button ref={refs.goal} type="button" className="c-chip" data-testid="goal-chip" aria-expanded={open === "goal"} onClick={() => toggle("goal")}>
          <Icon name="target" size={14} />
          {goalChip(p.goal)}
        </button>
      ) : null}
      {p.plan && p.working ? <PlanChip plan={p.plan} starts={p.planStarts ?? "open"} /> : null}
      {p.preparing ? <span className="c-chip quiet">{preparingLine(p.preparing)}</span> : null}
      {p.files.map((f) => (
        <FileChip key={f.id} file={f} onRemove={() => p.onRemoveFile(f.id)} onShowText={() => p.onShowText(f.id)} />
      ))}
      {p.people.length ? (
        <span className="c-chip" data-testid="tells-chip">
          <Icon name="bell" size={14} />
          Tells {p.people.map((x) => x.name).join(", ")}
          {p.people.map((x) => (
            <button key={x.profileId} type="button" className="c-x" aria-label={`Don't tell ${x.name}`} onClick={() => p.onForget(x.profileId)}>
              <Icon name="x" size={12} />
            </button>
          ))}
        </span>
      ) : null}
      {p.working ? (
        <button ref={refs.steer} type="button" className="c-chip steer" data-testid="steer-chip" aria-expanded={open === "steer"} onClick={() => toggle("steer")}>
          <Icon name="retry" size={14} />
          Steer {p.trunkName}
        </button>
      ) : null}
      {open === "queue" ? <QueuePop {...p} anchor={refs.queue} onClose={close} /> : null}
      {open === "bg" ? <JobsPop {...p} anchor={refs.bg} onClose={close} /> : null}
      {open === "goal" && p.goal ? <GoalPop goal={p.goal} onGoal={p.onGoal} anchor={refs.goal} onClose={close} /> : null}
      {open === "steer" ? <SteerPop trunkName={p.trunkName} onSteer={p.onSteer} anchor={refs.steer} onClose={close} /> : null}
    </div>
  );
}

/** The plan above the message box (§4.2.2, §4.7.1 "Task progress above the message box"): while the Trunk works and
 *  the Plan card is out of view, its ticked steps show here, open or folded to "1 of 4"; a click on the count
 *  brings the card back into view. */
function PlanChip({ plan, starts }: { plan: NonNullable<Props["plan"]>; starts: "open" | "folded" }) {
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(() => starts === "open" && !matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const card = document.querySelector('.thread [data-testid="plan-card"]');
    if (!card || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(([entry]) => setHidden(entry.isIntersecting), { root: card.closest(".scroll"), threshold: 0.2 });
    watch.observe(card);
    return () => watch.disconnect();
  }, [plan.done, plan.total]);
  if (hidden) return null;
  const toCard = () => document.querySelector('.thread [data-testid="plan-card"]')?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  const count = (
    <button type="button" className="c-chip" data-testid="plan-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      <Icon name="plan" size={14} />
      {plan.done} of {plan.total}
    </button>
  );
  if (!open) return count;
  return (
    <div className="c-plan" data-testid="plan-dock">
      <div className="c-plan-h">
        {count}
        <button type="button" className="c-link sm" onClick={toCard}>Show the plan</button>
      </div>
      <ul>
        {plan.steps.map((s, i) => (
          <li key={i} className={s.status === "completed" ? "done" : s.status === "in_progress" ? "now" : ""}>
            <span className="box" aria-hidden="true">{s.status === "completed" ? "✓" : ""}</span>
            <span>{s.step}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FileChip({ file, onRemove, onShowText }: { file: DraftFile; onRemove: () => void; onShowText: () => void }) {
  return (
    <span className={`c-chip file${file.problem ? " bad" : ""}`} data-testid="file-chip" title={file.detail}>
      {file.preview ? <img src={file.preview} alt="" width={20} height={20} /> : <Icon name={file.kind === "text" ? "text" : "file"} size={14} />}
      {file.problem ?? file.fileName}
      {!file.problem ? <small>{formatSize(file.sizeBytes)}</small> : null}
      {file.kind === "text" ? (
        <button type="button" className="c-link sm" onClick={onShowText}>Show in text field</button>
      ) : null}
      <button type="button" className="c-x" aria-label={`Remove ${file.fileName}`} onClick={onRemove}>
        <Icon name="x" size={12} />
      </button>
    </span>
  );
}

type PopBase = { anchor: React.RefObject<HTMLElement | null>; onClose: () => void };

function QueuePop(p: Props & PopBase) {
  return (
    <Popover anchor={p.anchor} onClose={p.onClose} label="Waiting line" className="c-queue">
      <div className="c-ph">{p.offline ? "Sends when Branch is back" : "Waiting line · sent after this step"}</div>
      {p.line.map((item, i) => (
        <div key={item.id} className="c-qrow" data-testid="queue-row">
          <span className="c-qn">{i + 1}</span>
          <input
            aria-label={`Waiting message ${i + 1}`}
            defaultValue={item.text}
            // A message that may already be with the engine goes again word for word, if at all.
            readOnly={item.state === "checking"}
            onBlur={(e) => e.target.value !== item.text && p.onReword(item.id, e.target.value)}
          />
          {item.state === "waiting" && p.working ? (
            <button type="button" className="btn sm ghost" title={`Hand this to ${p.trunkName} now`} onClick={() => p.onSteerQueued(item.id)}>Steer now</button>
          ) : null}
          {item.state === "failed" ? (
            <button type="button" className="btn sm ghost" onClick={() => p.onRetry(item.id)}>Retry</button>
          ) : null}
          <button type="button" className="c-x" aria-label="Move up" disabled={i === 0} onClick={() => p.onMoveUp(item.id)}><Icon name="up" size={13} /></button>
          <button type="button" className="c-x" aria-label="Remove" onClick={() => p.onRemove(item.id)}><Icon name="x" size={13} /></button>
          {item.state === "failed" ? <small className="c-qstate">Not sent{item.error ? `: ${item.error}` : ""}</small> : null}
          {item.state === "sending" ? <small className="c-qstate">Sending…</small> : null}
          {item.state === "checking" ? <small className="c-qstate">Not confirmed yet · Branch checks whether it arrived</small> : null}
          {p.offline && item.state === "waiting" ? <small className="c-qstate">Offline · sends when Branch is back</small> : null}
        </div>
      ))}
    </Popover>
  );
}

function JobsPop(p: Props & PopBase) {
  return (
    <Popover anchor={p.anchor} onClose={p.onClose} label="Running in the background" className="c-jobs">
      <div className="c-ph">Running in the background</div>
      {p.jobs.map((j) => (
        <div key={j.key} className="c-qrow" data-testid="bg-row">
          <Pebble size={22} label={p.trunkName} />
          <span className="c-tool-t"><b>{j.title}</b><small>{j.running ? <><i className="c-bgdot c-inline" /> {j.step}</> : "Finished · ready to read"}</small></span>
          {j.running ? <button type="button" className="btn sm ghost" onClick={() => p.onStopJob(j.key)}>Stop</button> : null}
          {p.onOpenJob ? <button type="button" className="btn sm ghost" onClick={() => p.onOpenJob?.(j.key)}>Open</button> : null}
        </div>
      ))}
      <p className="c-pp">Start one with /bg or + › Run in the background.</p>
    </Popover>
  );
}

function GoalPop({ goal, onGoal, anchor, onClose }: { goal: Goal; onGoal: Props["onGoal"] } & PopBase) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(goal.objective);
  return (
    <Popover anchor={anchor} onClose={onClose} label="Goal" className="c-goal">
      {editing ? (
        <>
          <textarea className="c-field" aria-label="Goal" value={text} onChange={(e) => setText(e.target.value)} />
          <div className="c-btns">
            <button type="button" className="btn sm ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button type="button" className="btn sm pri" onClick={() => { onGoal("edit", text); setEditing(false); }}>Save goal</button>
          </div>
        </>
      ) : (
        <>
          <p className="c-goal-t">{goal.objective}</p>
          <p className="c-pp">{GOAL_STATE[goal.status] ?? goal.status}{goal.status === "blocked" && goal.note ? `: ${goal.note}` : ""}</p>
          <div className="c-btns">
            <button type="button" className="btn sm" onClick={() => setEditing(true)}>Edit</button>
            {goal.status === "paused" ? (
              <button type="button" className="btn sm" onClick={() => onGoal("resume")}>Resume</button>
            ) : (
              <button type="button" className="btn sm" onClick={() => onGoal("pause")}>Pause</button>
            )}
            <button type="button" className="btn sm bad" onClick={() => onGoal("clear")}>Clear</button>
          </div>
        </>
      )}
    </Popover>
  );
}

function SteerPop({ trunkName, onSteer, anchor, onClose }: { trunkName: string; onSteer: Props["onSteer"] } & PopBase) {
  const [text, setText] = useState("");
  const [hint, setHint] = useState("");
  const go = async () => {
    if (!text.trim()) {
      setHint("Type what to change first.");
      return;
    }
    if (await onSteer(text.trim())) onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} label={`Steer ${trunkName} while it works`} className="c-steer">
      <div className="c-pt">Steer {trunkName} while it works</div>
      <input
        autoFocus
        className="c-field"
        data-testid="steer-field"
        placeholder="Tell it what to change"
        aria-label="Tell it what to change"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && void go()}
      />
      {hint ? <p className="c-pp">{hint}</p> : null}
      <div className="c-btns">
        <button type="button" className="btn sm pri" data-testid="steer-now" onClick={() => void go()}>Steer now</button>
      </div>
    </Popover>
  );
}
