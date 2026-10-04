// Helpers on this task (DESIGN-SPEC §4.2.2 "Helpers chip", §4.4.10; DECISIONS.md items 49 and 50): the chip in
// the thread and the live tree with status marks (never faces). Each helper can be stopped on its own
// (sessions.abort) and answers its own approvals here. The spec opens the tree in Side panel › Activity; this
// shell supplies the Activity navigation callback; standalone thread mounts retain the glass popover.
import { useState } from "react";
import { useThread } from "./context";
import { Popover } from "./Dialog";
import { Icon, ICONS } from "./icons";
import type { ApprovalDecision } from "./model";
import type { ApprovalDetails, Helper } from "./useEngineData";

type Mark = "working" | "done" | "waiting" | "stopped";

export function helperMark(h: Helper, waiting: boolean): Mark {
  if (waiting) return "waiting";
  if (h.status === "running" || h.status === "queued") return "working";
  if (h.status === "done") return "done";
  return h.status ? "stopped" : "working";
}

const MARK_ICON: Record<Mark, string> = { working: ICONS.spin, done: ICONS.check, waiting: ICONS.warn, stopped: ICONS.x };

function pillWords(h: Helper, mark: Mark): string {
  if (mark === "waiting") return "Waiting for you";
  if (mark === "working") return "Working";
  if (mark === "done") return "Done";
  return h.status === "killed" || h.status === "interrupted" ? "Stopped · by you" : "Stopped";
}

/** "1 needs you", "2 need you". */
export const needsYou = (n: number): string => `${n} ${n === 1 ? "needs" : "need"} you`;

export function chipWords(count: number, waiting: number, allDone: boolean): { lead: string; tail: string | null } {
  const lead = count === 1 ? "1 helper" : `${count} helpers`;
  if (waiting) return { lead, tail: needsYou(waiting) };
  return { lead, tail: allDone ? "done" : null };
}

type TreeProps = {
  helpers: Helper[];
  approvals: ApprovalDetails[];
  root: string;
  onStop: (h: Helper) => void;
  onAnswer: (id: string, decision: ApprovalDecision) => void;
  onOpenSession?: (key: string) => void;
};

function Row({ h, depth, props }: { h: Helper; depth: number; props: TreeProps }) {
  const asks = props.approvals.filter((a) => a.sessionKey === h.key && !a.decision);
  const mark = helperMark(h, asks.length > 0);
  return (
    <li className="helper" style={{ marginLeft: depth * 16 }} data-testid="helper" data-helper-state={mark}>
      <div className="helper-top">
        <span className={`hmark ${mark}`} aria-hidden="true"><Icon d={MARK_ICON[mark]} /></span>
        <span className="helper-name">
          {props.onOpenSession ? <button type="button" className="btn sm ghost" onClick={() => props.onOpenSession?.(h.key)}>{h.name}</button> : <b>{h.name}</b>}
          {h.model ? <small>{h.model}</small> : null}
        </span>
        <span className={`pill ${mark === "done" ? "ok" : mark === "stopped" ? "bad" : "wait"}`}>{pillWords(h, mark)}</span>
        {mark === "working" || mark === "waiting" ? (
          <button type="button" className="btn sm ghost" aria-label={`Stop ${h.name}`} onClick={() => props.onStop(h)}>Stop</button>
        ) : null}
      </div>
      {h.task ? <p className="helper-job">{h.task}</p> : null}
      {h.error ? <p className="helper-error">{h.error}</p> : null}
      {asks.map((a) => (
        <div key={a.id} className="helper-ask">
          <b>{a.command}</b>
          <small>asked by {h.name}</small>
          <button type="button" className="btn sm ghost" onClick={() => props.onAnswer(a.id, "deny")}>No</button>
          <button type="button" className="btn sm primary" onClick={() => props.onAnswer(a.id, "allow-once")}>Allow once</button>
        </div>
      ))}
    </li>
  );
}

function Branch({ parent, depth, props, visited = new Set<string>() }: { parent: string; depth: number; props: TreeProps; visited?: Set<string> }) {
  return (
    <>
      {props.helpers.filter((h) => h.parent === parent && !visited.has(h.key)).map((h) => (
        <li key={h.key} className="helper-branch">
        <ul className="helper-children">
          <Row h={h} depth={depth} props={props} />
          <Branch parent={h.key} depth={depth + 1} props={props} visited={new Set([...visited, h.key])} />
        </ul>
        </li>
      ))}
    </>
  );
}

/** The tree: the Trunk at the root, its helpers under it, theirs one level further in. */
export function HelpersTree(props: TreeProps) {
  const { name } = useThread();
  const waiting = props.approvals.filter((a) => !a.decision && props.helpers.some((h) => h.key === a.sessionKey)).length;
  const direct = props.helpers.filter((h) => h.parent === props.root).length;
  return (
    <section className="helpers-tree" aria-label="Helpers on this task" data-testid="helpers-tree">
      <div className="pop-head">Helpers on this task</div>
      <p className="helpers-count">{`${direct} started by ${name}`}{waiting ? ` · ${needsYou(waiting)}` : ""}</p>
      <ul>
        <Branch parent={props.root} depth={0} props={props} />
      </ul>
      <p className="hint">Each helper runs on its own model and asks for its own approvals. Nothing a helper does skips your rules.</p>
    </section>
  );
}

/** The chip in the thread: one status mark per helper (up to five, then "+n"), the count, and a chevron. */
export function HelpersChip(props: TreeProps & {onOpenActivity?: () => void}) {
  const [open, setOpen] = useState(false);
  const marks = props.helpers.map((h) => helperMark(h, props.approvals.some((a) => a.sessionKey === h.key && !a.decision)));
  const waiting = marks.filter((m) => m === "waiting").length;
  const words = chipWords(props.helpers.length, waiting, marks.every((m) => m === "done"));
  return (
    <div className="helpers-wrap">
      <button type="button" className="helpers-chip" aria-expanded={props.onOpenActivity ? undefined : open} data-testid="helpers-chip" onClick={() => props.onOpenActivity ? props.onOpenActivity() : setOpen((v) => !v)}>
        <span className="hmarks">
          {marks.slice(0, 5).map((m, i) => <span key={i} className={`hmark ${m}`}><Icon d={MARK_ICON[m]} size={14} /></span>)}
          {marks.length > 5 ? <span className="hmore">+{marks.length - 5}</span> : null}
        </span>
        <span>
          {words.lead}
          {words.tail ? <> · {waiting ? <b className="needs">{words.tail}</b> : words.tail}</> : null}
        </span>
        <Icon d={ICONS.chev} />
      </button>
      {open ? (
        <Popover label="Helpers on this task" align="left" onClose={() => setOpen(false)}>
          <HelpersTree {...props} />
        </Popover>
      ) : null}
    </div>
  );
}
