// People › Shared (§4.6.5.4): what you share and with whom (session.visibility.set, session.members.*), public
// links you can stop (session.publicShare.set), and what others share with you.
import { useEffect, useState } from "react";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import type { WindowEngine } from "../../connect/engine";
import { shows, type Level } from "../../places-nav/level";
import { useOperation, useResource } from "../library/data";
import { num, rec, recs, rows, str, strs, type Row } from "./data";
import { Avatar, Empty, Glyph, Section, Seg, Status, Sw } from "./ui";

export const SNAPSHOTS_OFF = "Needs the engine's snapshot inbox.";
const OPEN = new Set(["shared", "read-only", "suggest"]);
const WHO: Record<string, string> = { shared: "Everyone on this Branch may write in it", "read-only": "Everyone on this Branch may read it", suggest: "Everyone on this Branch may suggest" };
const VIS_NAME: Record<string, string> = { draft: "Only who I add", "read-only": "May read it", suggest: "May suggest", shared: "May write in it" };
const YOURS: Record<string, string> = { member: "you may read it and write in it", viewer: "you may read it" };
const isGroup = (r: Row) => r.chatType === "group" || r.kind === "group";
const mine = (r: Row, me: string | null) => r.sharingRole ? r.sharingRole === "owner" || r.sharingRole === "admin" : !r.ownerId || r.ownerId === me;
/** Public links only show through session.members.list; read at most this many of your conversations. */
const LINK_READS = 25;

export function SharedTab({ engine, me, level, openConversation }: { engine: WindowEngine; me: string | null; level: Level; openConversation: (key: string) => void }) {
  const list = useResource<unknown>(engine, "sessions.list", { includeDerivedTitles: true, includeLastMessage: true });
  const [manage, setManage] = useState<Row | null>(null);
  const all = rows(list.data);
  const ours = all.filter(r => mine(r, me));
  const shared = ours.filter(r => OPEN.has(r.visibility));
  const withYou = all.filter(r => !mine(r, me) && (r.sharingRole === "member" || r.sharingRole === "viewer"));
  const links = useLinks(engine, ours.slice(0, LINK_READS));
  const [stopped, setStopped] = useState<string[]>([]);
  const linked = ours.filter(r => links.has(r.key) && !stopped.includes(r.key));
  return <>
    <Status {...list} />
    {list.data != null && <>
      {shared.length || linked.length ? <div className="pp-rows">{shared.map(r => <div key={r.key} className="pp-prow kp-row">
        <span className="pp-tile"><Glyph name="chat" /></span>
        <span className="grow"><b>{r.title} <span className="pp-tag">{isGroup(r) ? "Group chat" : "Conversation"}</span></b><small>{WHO[r.visibility]}{r.participants.length ? ` · ${r.participants.join(", ")}` : ""}</small></span>
        <button type="button" className="btn ghost sm" onClick={() => setManage(r)}>Manage</button>
      </div>)}{linked.map(r => <LinkRow key={`link:${r.key}`} engine={engine} row={r} made={links.get(r.key)!} onStopped={() => setStopped(s => [...s, r.key])} />)}</div>
        : <Empty>Nothing is shared yet. Share a conversation or a Trunk from its ⋯ menu.</Empty>}
      {withYou.length > 0 && <Section title="Shared with you"><div className="pp-rows flat">{withYou.map(r => <div key={r.key} className="pp-prow">
        <Avatar id={r.ownerId || r.key} name={r.ownerLabel || "?"} size={32} />
        <span className="grow"><b>{r.ownerLabel ? `${r.ownerLabel}: ${r.title}` : r.title}</b><small>A conversation · {YOURS[r.sharingRole]}</small></span>
        <button type="button" className="btn sm" onClick={() => openConversation(r.key)}>Open</button></div>)}</div></Section>}
    </>}
    {shows(level, "advanced") && <Section title="Snapshots sent to you">
      <p className="pp-hint" style={{ margin: "0 0 8px" }}>Redacted copies of coding conversations others sent here, to read or carry on.</p>
      <div className="pp-ctl"><b>Snapshots</b><span className="right"><Sw label="Snapshots" on={false} off={SNAPSHOTS_OFF} /></span><small>Lets people you trust send redacted coding conversations here. Off until you choose: it accepts uploads from outside this computer. <span className="pp-why">{SNAPSHOTS_OFF}</span></small></div>
    </Section>}
    {manage && <ManageDialog engine={engine} row={manage} onClose={() => setManage(null)} onChanged={list.reload} />}
  </>;
}

/** A conversation's public link, with "Stop this link" (session.publicShare.set). */
function LinkRow({ engine, row, made, onStopped }: { engine: WindowEngine; row: Row; made: number; onStopped: () => void }) {
  const op = useOperation(engine);
  return <div className="pp-prow">
    <span className="pp-tile"><Icon name="globe" small /></span>
    <span className="grow"><b>{row.title} <span className="pp-tag">A copy</span></b><small>Anyone with the link can read it · made {new Date(made).toLocaleDateString()}</small>{op.error && <small role="alert" className="pp-error">{op.error}</small>}</span>
    <button type="button" className="btn ghost sm" disabled={op.busy || !row.sessionId} title={row.sessionId ? undefined : "The engine did not give this conversation's id."} onClick={() => void op.run("session.publicShare.set", { sessionKey: row.key, expectedSessionId: row.sessionId, enabled: false }, onStopped)}>Stop this link</button>
  </div>;
}

/** When each conversation's public link was made (session.members.list publicShare), read once per list. */
function useLinks(engine: WindowEngine, candidates: Row[]) {
  const id = JSON.stringify(candidates.map(r => r.key));
  const [links, setLinks] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let current = true;
    const keys = JSON.parse(id) as string[];
    void Promise.all(keys.map(key => engine.request<unknown>("session.members.list", { sessionKey: key })
      .then(r => [key, num(rec(rec(r).publicShare).createdAt)] as const, error => { console.error(error); return [key, undefined] as const; })))
      .then(found => { if (current) setLinks(new Map(found.filter((f): f is readonly [string, number] => f[1] !== undefined))); });
    return () => { current = false; };
  }, [engine, id]);
  return links;
}

function ManageDialog({ engine, row, onClose, onChanged }: { engine: WindowEngine; row: Row; onClose: () => void; onChanged: () => void }) {
  const members = useResource<unknown>(engine, "session.members.list", { sessionKey: row.key });
  const op = useOperation(engine);
  const data = rec(members.data);
  const identities = recs(data.identities);
  const label = (id: string) => { const i = identities.find(x => str(x.id) === id); return str(i?.displayName) || str(i?.label) || id; };
  const memberIds = recs(data.members).map(m => str(m.identityId));
  const owner = rec(data.owner);
  const allowed = strs(data.allowedVisibilities);
  const [visibility, setVisibility] = useState<string | null>(null);
  const current = visibility ?? row.visibility;
  const after = () => { members.reload(); onChanged(); };
  const addable = identities.filter(i => str(i.id) !== str(owner.id) && !memberIds.includes(str(i.id)) && str(i.type) !== "agent");
  return <Dialog title={`Manage ${row.title}`} onClose={onClose} footer={<button type="button" className="btn pri" onClick={onClose}>Done</button>}>
    <div className="ppl-dlg" style={{ display: "grid", gap: 12 }}>
      <Status {...members} />
      {members.data != null && <>
        {allowed.length > 0 && <div className="fld"><span>Everyone else on this Branch</span><Seg label="Everyone else on this Branch" value={current} options={allowed.map(v => ({ id: v, name: VIS_NAME[v] ?? v }))} off={op.busy ? "Saving…" : undefined} onChange={v => void op.run("session.visibility.set", { sessionKey: row.key, visibility: v }, () => { setVisibility(v); onChanged(); })} /></div>}
        {str(owner.id) && <p style={{ margin: 0 }}>Owner: {str(owner.displayName) || str(owner.label) || str(owner.id)}</p>}
        {memberIds.length ? <div className="pp-rows flat">{memberIds.map(id => <div key={id} className="pp-prow"><span className="grow"><b>{label(id)}</b></span>
          <button type="button" className="btn ghost sm" disabled={op.busy} onClick={() => void op.run("session.members.remove", { sessionKey: row.key, identityId: id }, after)}>Remove</button></div>)}</div>
          : <p className="pp-hint" style={{ margin: 0 }}>No one added yet.</p>}
        {addable.length > 0 && <AddMember options={addable.map(i => ({ id: str(i.id), name: str(i.displayName) || str(i.label) || str(i.id) }))} busy={op.busy} add={id => void op.run("session.members.add", { sessionKey: row.key, identityId: id }, after)} />}
        <p className="pp-hint" style={{ margin: 0 }}>They see who started it, who owns it, and who else is in it. Their drafts stay private until they send.</p>
      </>}
      {op.error && <p role="alert" className="pp-error">{op.error}</p>}
    </div>
  </Dialog>;
}

function AddMember({ options, busy, add }: { options: { id: string; name: string }[]; busy: boolean; add: (id: string) => void }) {
  const [pick, setPick] = useState(options[0].id);
  return <div className="pp-acts"><select className="inp" aria-label="Add someone" value={pick} onChange={e => setPick(e.target.value)}>{options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    <button type="button" className="btn sm" disabled={busy} onClick={() => add(pick)}>Add</button></div>;
}
