// The ring's popover (HANDOFF R1-04, preview ACTS.ringP17): This computer, Running, Context, then the protected Every
// account list exactly as the status bar shows it (shell/StatusPopovers EveryAccount). Opening reads only what the
// engine already reported; the context breakdown and the cost are read when the popover opens.
import { useEffect, useState, type RefObject } from "react";
import type { Conversation as ListRow } from "../../connect/conversations";
import { num, rec, type WindowEngine } from "../../composer/engine";
import type { OpenTarget } from "../../composer/nav";
import { Popover } from "../../glass/Popover";
import { EveryAccount } from "../../shell/StatusPopovers";
import { readRoom, type Limits, type Room } from "../../shell/status-data";
import type { ContextUse } from "./usage";

export type RunningRow = { key: string; title: string; line: string; needsYou?: boolean };

type Props = {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  engine: WindowEngine;
  sessionKey: string | null;
  name: string;
  working: boolean;
  offline: boolean;
  context: ContextUse | null;
  row?: ListRow;
  running: RunningRow[];
  limits: Limits | null;
  onOpen: (target: OpenTarget) => void;
  onOpenConversation: (key: string) => void;
};

export function RingPopover(p: Props) {
  const [room, setRoom] = useState<Room | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const total = p.row?.totalTokens ?? 0, size = p.row?.contextTokens ?? 0;
  useEffect(() => {
    if (!p.sessionKey || p.offline) return;
    let live = true;
    void p.engine.request("sessions.usage", { key: p.sessionKey, limit: 1, includeContextWeight: true }).then(
      (usage) => { if (live) setRoom(readRoom(total, size, usage)); }, () => undefined);
    void p.engine.request("sessions.usage", { key: p.sessionKey, range: "all" }).then(
      (result) => { const value = num(rec(rec(result).totals).totalCost); if (live && value !== undefined) setCost(value); }, () => undefined);
    return () => { live = false; };
  }, [p.engine, p.sessionKey, p.offline, total, size]);
  const others = p.running.filter((r) => r.key !== p.sessionKey);
  return <Popover anchor={p.anchor} label="Usage, running and context" onClose={p.onClose} width={340} align="end" placement="above">
    <div className="r1c-menu r1c-ringpop">
      <section className="r1c-sec">
        <div className="c-pt">This computer</div>
        <div className="r1c-line"><i className="r1c-dot" data-state={p.offline ? "off" : "on"} />{p.offline ? "Offline · reconnecting to Branch" : "Online · you are here"}</div>
      </section>
      <section className="r1c-sec">
        <div className="c-pt">Running</div>
        {p.working ? <div className="r1c-line"><i className="r1c-dot" data-state="working" />{p.name} is working</div> : null}
        {others.map((r) => <button type="button" key={r.key} className="r1c-line r1c-run" data-need="sessions.list" onClick={() => p.onOpenConversation(r.key)}>
          <i className="r1c-dot" data-state={r.needsYou ? "waiting" : "working"} /><b>{r.title}</b>{r.line ? <small>{r.line}</small> : null}
        </button>)}
        {!p.working && !others.length ? <p className="c-pp">Nothing is running.</p> : null}
      </section>
      <section className="r1c-sec">
        <div className="c-pt">Context</div>
        {p.context ? <details className="r1c-ctx">
          <summary><span>{p.context.line}</span><span className="r1c-bar"><i style={{ width: `${Math.max(p.context.percent, 1)}%` }} /></span></summary>
          <div className="r1c-more">
            <p className="c-pp">{100 - p.context.percent}% of this conversation's context is free.</p>
            {room?.parts.length ? <div className="bars">{room.parts.map((part) => <div className="brow" key={part.name}><span>{part.name}</span><span className="track"><u style={{ width: `${Math.min(100, part.share)}%` }} /></span><span className="v">{Math.round(part.share)}%</span></div>)}</div> : null}
          </div>
        </details> : <p className="c-pp">Not measured yet. It shows after the first answer.</p>}
        {cost !== null ? <div className="r1c-line"><small>${cost.toFixed(2)} so far in this conversation</small></div> : null}
      </section>
      <EveryAccount limits={p.limits} request={(method, params) => p.engine.request(method, params)} onOpenUsage={() => { p.onClose(); p.onOpen("settings/usage"); }} />
    </div>
  </Popover>;
}
