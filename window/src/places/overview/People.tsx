// Overview › "Who is using Branch": each person's line (active or idle, "<n> open · <n> running") and the
// person card on hover or keyboard focus (preview 41-placesap §4.6.1 presLinePD18 / presCardPD18).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Face } from "../../face/Face";
import { openInboxWith } from "../inbox/handoff";
import type { PlaceId } from "../../places-nav/routes";
import { agentName, countable, type Agent, type Person, type Session } from "./engine";
import { ago } from "./format";

export type PersonLine = Person & { shared?: boolean };

const COUNT_TIP = "Conversations they can open, and how many are working now. Helpers, automations and Branch’s own conversations are not counted.";
const SHARED_TIP = "Connected with the Gateway’s key, not a personal sign-in.";

export function theirs(person: PersonLine, rows: Session[]): Session[] {
  return rows.filter(row => countable(row) && (person.shared ? !row.human : row.ownerId === person.id));
}

function onlineFor(person: Person, now: number): string {
  if (!person.online) return "Not connected now";
  if (person.onlineSince === undefined) return "Online now";
  return `Online for ${ago(now - person.onlineSince).replace(/^(\d+) min$/, "$1 minutes")}`;
}

function Card({ person, rows, agents, at, open, openPlace, keep, leave }: { person: PersonLine; rows: Session[]; agents: Agent[]; at: { x: number; y: number }; open: (key: string) => void; openPlace: (place: PlaceId) => void; keep: () => void; leave: () => void }) {
  const now = Date.now();
  const watching = person.watching.map(key => rows.find(row => row.key === key)).find(Boolean);
  const recent = theirs(person, rows).slice(0, 3);
  return createPortal(
    <div className="pop ov-pcard" role="dialog" aria-label={person.name} style={{ left: at.x, top: at.y }} onMouseEnter={keep} onMouseLeave={leave}>
      <div className="ov-pc-h"><span className="initial ov-pc-me">{person.name.slice(0, 1).toUpperCase()}</span><span className="ov-pc-grow"><b>{person.name}</b><small>{onlineFor(person, now)}</small></span></div>
      <dl className="ov-pc-kv">
        {person.where ? <><dt>Where</dt><dd>{person.where}</dd></> : null}
        {person.lastActive !== undefined ? <><dt>Last thing they did</dt><dd>{ago(now - person.lastActive)} ago</dd></> : null}
        {person.online ? <><dt>Looking at now</dt><dd>{watching ? watching.title : "Nothing open right now."}</dd></> : null}
      </dl>
      <div className="ov-pc-s"><b>Recent conversations</b>
        {recent.length ? recent.map(row => <button key={row.key} type="button" className="ov-pc-r" onClick={() => open(row.key)}><Face size={20} label={agentName(agents, row.agentId)} /><span className="ov-pc-grow">{row.title}</span>{row.updatedAt !== undefined ? <small>updated {ago(now - row.updatedAt)} ago</small> : null}</button>)
          : <p className="ov-hint">No recent conversations you can see.</p>}
      </div>
      {!person.shared ? <button type="button" className="ov-link" onClick={() => { openInboxWith({ tab: "history", people: [person.id] }); openPlace("inbox"); }}>See their activity</button> : null}
    </div>,
    document.body,
  );
}

export function PersonRow({ person, rows, agents, open, openPlace }: { person: PersonLine; rows: Session[]; agents: Agent[]; open: (key: string) => void; openPlace: (place: PlaceId) => void }) {
  const line = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = () => {
    clearTimeout(timer.current);
    const r = line.current?.getBoundingClientRect();
    if (r) setAt({ x: Math.max(8, Math.min(r.left, innerWidth - 288)), y: r.bottom + 6 + 300 > innerHeight ? Math.max(8, r.top - 306) : r.bottom + 6 });
  };
  const hideSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setAt(null), 220); };
  const mine = theirs(person, rows), running = mine.filter(row => row.working).length;
  const state = person.active ? "active" : person.online ? "idle" : "away";
  return <>
    <div ref={line} className="ov-pres" tabIndex={0} role="button" aria-haspopup="dialog" aria-expanded={at !== null}
      aria-label={`${person.name}, ${state === "active" ? "Active" : state === "idle" ? "Idle" : "Not connected"}. ${mine.length} open, ${running} running. Show details`}
      onMouseEnter={show} onMouseLeave={hideSoon} onFocus={show} onBlur={hideSoon}
      onKeyDown={e => { if (e.key === "Escape" && at) { e.stopPropagation(); setAt(null); } }}>
      <span className="initial ov-me">{person.name.slice(0, 1).toUpperCase()}</span>
      <span className="ov-presn">{person.name}<i className={`ov-pdot ${state}`} title={state === "active" ? "Active" : state === "idle" ? "Idle" : "Not connected"} /></span>
      <span className="ov-prescnt" title={person.shared ? SHARED_TIP : COUNT_TIP}>{mine.length} open · {running} running</span>
    </div>
    {at ? <Card person={person} rows={rows} agents={agents} at={at} open={open} openPlace={openPlace} keep={() => clearTimeout(timer.current)} leave={hideSoon} /> : null}
  </>;
}
