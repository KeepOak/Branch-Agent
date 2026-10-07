// Inbox › Finished (§4.6.2.2), Later (§4.6.2.4) and the Messages section under every tab (preview 93-g3p).
import { useState } from "react";
import { shownWhy } from "../../shell/shown-why";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Icon } from "../../shell/icons";
import { Face } from "../../face/Face";
import { agentName, type Agent, type Session } from "../overview/engine";
import { InboxRow } from "./Rows";
import { clock, dayWord } from "../overview/format";

export const DEFERRED_GAP = "Needs the engine's deferred-work queue (callbacks, steps you do by hand, work handed over to later).";
// TODO(engine-lane): Messages (Important / Everything else / All) needs the engine's message triage method.
export const MESSAGES_GAP = "Needs the engine's message triage method.";

/** Conversations whose work has finished, newest first. */
export function finishedRows(list: Session[]): Session[] {
  return list.filter(s => !s.working && !s.helper && !s.automation && !s.archived && !s.global && (s.status === "done" || Boolean(s.lastRunId)));
}

/** Conversations snoozed until a future time, soonest wake first. */
export function snoozedRows(list: Session[], now = Date.now()): Session[] {
  return list.filter(s => typeof s.snoozedUntil === "number" && s.snoozedUntil > now)
    .sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0));
}

/** "Wakes tomorrow at 9:00 AM", using the shared day and clock words. */
export function wakeWords(until: number, now = Date.now()): string {
  const at = new Date(until);
  const day = dayWord(at, new Date(now));
  const time = clock(at);
  return day === "Today" || day === "Tomorrow" ? `Wakes ${day.toLowerCase()} at ${time}` : `Wakes ${day} at ${time}`;
}

export function Finished({ list, agents, loading, open }: { list: Session[]; agents: Agent[]; loading: boolean; open: (key: string) => void }) {
  const [shown, setShown] = useState(20);
  const done = finishedRows(list);
  if (!done.length) return loading ? null : <EmptyLine icon={<Icon name="inbox" />}>Nothing has finished yet.</EmptyLine>;
  return <>
    <div className="ib-list">{done.slice(0, shown).map(s => {
      const trunk = agentName(agents, s.agentId);
      return <InboxRow key={s.key} unread={s.unread} lead={<Face size={34} label={trunk} />} title={s.title} sub={[trunk, s.recap || s.preview].filter(Boolean).join(" · ")}>
        <button type="button" className="btn sm" onClick={() => open(s.key)}>Open</button>
      </InboxRow>;
    })}</div>
    {done.length > shown ? <div className="ib-show"><small>Showing {shown} of {done.length}</small><button type="button" className="btn ghost sm" onClick={() => setShown(shown + 20)}>Show more</button></div> : null}
  </>;
}

export function Later({ list, agents, open, wake }: { list: Session[]; agents: Agent[]; open: (key: string) => void; wake: (row: Session) => void }) {
  const snoozed = snoozedRows(list);
  return <>
    <p className="ib-hint ib-lead">Work that finishes later: by a reply it waits for, a step only you can do, or a job handed over to another time.</p>
    {!snoozed.length ? <EmptyLine icon={<Icon name="clock" />}><span title={shownWhy(DEFERRED_GAP)}>Nothing is waiting to finish later.</span></EmptyLine> : <div className="ib-list">{snoozed.map(s => {
      const trunk = agentName(agents, s.agentId);
      return <InboxRow key={s.key} unread={s.unread} lead={<Face size={34} label={trunk} />} title={s.title} sub={s.snoozedUntil ? wakeWords(s.snoozedUntil) : ""}>
        <button type="button" className="btn sm" onClick={() => open(s.key)}>Open</button>
        <button type="button" className="btn sm" onClick={() => wake(s)}>Wake now</button>
      </InboxRow>;
    })}</div>}
  </>;
}

export function Messages() {
  return <section className="ib-sec ib-messages" aria-label="Messages">
    <div className="ib-sec-h"><h2>Messages</h2></div>
    <div className="ib-seg" role="group" aria-label="Show">
      {["Important", "Everything else", "All"].map((name, i) => <button key={name} type="button" aria-pressed={i === 0} disabled title={shownWhy(MESSAGES_GAP)}>{name}</button>)}
    </div>
    <label className="ib-search"><Icon name="search" small /><input disabled placeholder="Search messages" aria-label="Search messages" title={shownWhy(MESSAGES_GAP)} /></label>
    {shownWhy(MESSAGES_GAP) && <p className="ib-hint ib-after">{shownWhy(MESSAGES_GAP)}</p>}
  </section>;
}
