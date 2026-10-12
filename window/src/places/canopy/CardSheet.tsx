// A card's detail sheet (§4.6.7 "Card detail tabs"): Overview · Activity · Conversation · Details [T], read live
// from the card the engine returns (canopy.cards.list) and changed with canopy.cards.* methods.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState, type ReactNode } from "react";
import { shownWhy } from "../../shell/shown-why";
import { shows } from "../../places-nav/level";
import { Dialog } from "../../shell/Dialog";
import type { MenuAnchor } from "../../shell/Menu";
import { Popover } from "../../shell/Popover";
import { errorText, rec, rows, str, type Row } from "../automations/runtime";
import { BLOCK, cardBoard, isArchived, trunkName, waitsFor, whyOf } from "./data";
import { blocksCount, boardName, convState, meta, PRIOS, prioName, STATUSES, statusName } from "./cards-model";
import { ActivityTab, DetailsTab } from "./SheetRecords";
import { anchorOf, ChoiceMenu, Nobody, Pill, Sec, TrunkFace, when, type Ctx } from "./ui";


export function CardSheet({ ctx, id, close, edit }: { ctx: Ctx; id: string; close: () => void; edit: (c: Row) => void }) {
  const tech = shows(ctx.level, "technical");
  const [tab, setTab] = useState("Overview"), [desc, setDesc] = useState<string | null>(null), [asking, setAsking] = useState(false);
  const c = ctx.d.cards.find(x => str(x.id) === id);
  // The dialog focuses its first field; the sheet opens on its tabs instead, scrolled to the top.
  useEffect(() => { const t = document.querySelector<HTMLElement>("[data-testid=cn-sheet] [role=tab][aria-selected=true]"); t?.focus({ preventScroll: true }); t?.closest(".dlg-b")?.scrollTo?.({ top: 0 }); }, [id]);
  if (!c) return <Dialog title="Card" onClose={close}><p className="dlg-p">This card is gone. It may have been deleted elsewhere.</p></Dialog>;
  const leave = () => desc !== null && desc !== str(c.notes) ? setAsking(true) : close();
  if (asking) return <Dialog title="Discard changes?" onClose={() => setAsking(false)} footer={<><button className="btn ghost" type="button" onClick={() => setAsking(false)}>Keep editing</button><button className="btn pri" type="button" onClick={close}>Discard</button></>}><p className="dlg-p">Your changes will be lost.</p></Dialog>;
  const agent = str(c.agentId), why = c.status === "blocked" ? whyOf(c, ctx.d.cards) : null;
  const tabs = ["Overview", "Activity", "Conversation", ...(tech ? ["Details"] : [])];
  return (
    <Dialog title={str(c.title)} wide onClose={leave} testid="cn-sheet"
      footer={<><button className="btn ghost" type="button" disabled={!ctx.write} onClick={() => edit(c)}>Edit card</button></>}>
      <div className="cn-who">{agent ? <TrunkFace name={trunkName(ctx.d, agent)} size={34} /> : <Nobody size={34} />}
        <span className="cn-grow"><b>{agent ? trunkName(ctx.d, agent) : "No Trunk yet"}</b><small>{statusName(str(c.status))} · {convState(c, ctx.d.sessions, ctx.now)[0]}</small></span>
        {why ? <Pill tone={BLOCK[why.why][0]} tip={why.detail || undefined}>{BLOCK[why.why][1]}</Pill> : null}{isArchived(c) ? <Pill tone="idle">Archived</Pill> : null}</div>
      <div className="cn-tabs cn-stabs" role="tablist" aria-label={str(c.title)}>{tabs.map(t => <button key={t} type="button" role="tab" aria-selected={(tabs.includes(tab) ? tab : "Overview") === t} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Activity" ? <ActivityTab ctx={ctx} c={c} /> : tab === "Conversation" ? <ConversationTab ctx={ctx} c={c} /> : tab === "Details" && tech ? <DetailsTab c={c} />
        : <Overview ctx={ctx} c={c} desc={desc} setDesc={setDesc} />}
    </Dialog>
  );
}

type Prop = "status" | "priority" | "agentId" | "labels";
function Props({ ctx, c }: { ctx: Ctx; c: Row }) {
  const [menu, setMenu] = useState<{ k: Prop; at: MenuAnchor } | null>(null), [labels, setLabels] = useState("");
  const upd = (patch: Row, msg: string) => { setMenu(null); void ctx.act(() => patch.status ? ctx.engine.request("canopy.cards.move", { id: c.id, status: patch.status, expectedUpdatedAt: c.updatedAt }) : ctx.engine.request("canopy.cards.update", { id: c.id, expectedUpdatedAt: c.updatedAt, patch }), msg); };
  const b = ctx.d.boards.find(x => str(x.id) === cardBoard(c)), agent = str(c.agentId), auto = rec(meta(c).automation);
  const row = (k: Prop, label: string, value: ReactNode) => <><dt>{label}</dt><dd><button type="button" className="link" aria-haspopup="menu" disabled={!ctx.write} onClick={e => { setLabels(Array.isArray(c.labels) ? c.labels.join(", ") : ""); setMenu({ k, at: anchorOf(e.currentTarget) }); }}>{value}</button></dd></>;
  const opts = menu?.k === "status" ? STATUSES : menu?.k === "priority" ? PRIOS : [["", `Default Trunk (${trunkName(ctx.d, ctx.d.defaultTrunk)})`], ...ctx.d.trunks.map(t => [t.id, t.name])];
  const cur = menu?.k === "status" ? str(c.status) : menu?.k === "priority" ? str(c.priority) || "normal" : agent;
  return <>
    <dl className="kv cn-kv">
      {row("status", "Status", statusName(str(c.status)))}{row("priority", "Priority", prioName(c.priority))}
      {row("agentId", "Trunk", agent ? <><TrunkFace name={trunkName(ctx.d, agent)} size={18} /> {trunkName(ctx.d, agent)}</> : `Default Trunk (${trunkName(ctx.d, ctx.d.defaultTrunk)})`)}
      {row("labels", "Labels", Array.isArray(c.labels) && c.labels.length ? c.labels.join(", ") : "Add labels")}
      <dt>Board</dt><dd>{boardName(b) || (cardBoard(c) === "default" ? "Default board" : cardBoard(c))}</dd>
      <dt>When scheduled</dt><dd>{when(auto.scheduledAt)}</dd><dt>Template</dt><dd>{str(meta(c).templateId) || "—"}</dd>
    </dl>
    {menu && menu.k !== "labels" ? <ChoiceMenu at={menu.at} label={menu.k} radio onClose={() => setMenu(null)} options={opts.map(([id, label]) => ({ id, label, checked: cur === id }))}
      onPick={id => upd(menu.k === "status" ? { status: id } : menu.k === "priority" ? { priority: id } : { agentId: id || null }, menu.k === "agentId" ? "Trunk changed." : "Saved.")} /> : null}
    {menu?.k === "labels" ? <Popover at={menu.at} label="Labels" onClose={() => setMenu(null)}><form className="cn-nl" onSubmit={e => { e.preventDefault(); upd({ labels: labels.split(",").map(x => x.trim()).filter(Boolean) }, "Saved."); }}>
      <input className="inp" autoFocus value={labels} placeholder="for example ui, docs" aria-label="Labels, separated by commas" onChange={e => setLabels(e.target.value)} /><button className="btn sm" type="submit">Save</button></form></Popover> : null}
  </>;
}

function Overview({ ctx, c, desc, setDesc }: { ctx: Ctx; c: Row; desc: string | null; setDesc: (v: string | null) => void }) {
  const [note, setNote] = useState(""), [bad, setBad] = useState(false), notes = rows(meta(c).comments);
  const saveDesc = () => void ctx.act(() => ctx.engine.request("canopy.cards.update", { id: c.id, expectedUpdatedAt: c.updatedAt, patch: { notes: desc ?? "" } }), "Saved.").then(ok => ok && setDesc(null));
  const addNote = () => { if (!note.trim()) return setBad(true); void ctx.act(() => ctx.engine.request("canopy.cards.comment", { id: c.id, body: note.trim() }), "Note added.").then(ok => ok && setNote("")); };
  return <>
    <Props ctx={ctx} c={c} />
    <Sec title="Description">{desc !== null ? <><textarea className="inp" rows={4} autoFocus aria-label="Description" value={desc} onChange={e => setDesc(e.target.value)} />
      <div className="cn-acts"><button className="btn ghost sm" type="button" onClick={() => setDesc(null)}>Cancel</button><button className="btn pri sm" type="button" disabled={ctx.busy} onClick={saveDesc}>Save</button></div></>
      : <>{str(c.notes) ? <p className="cn-desc">{str(c.notes)}</p> : null}<button className="link cn-left" type="button" disabled={!ctx.write} onClick={() => setDesc(str(c.notes))}>{str(c.notes) ? "Edit description" : "Add description"}</button></>}</Sec>
    <Sec title="Notes">{notes.length ? notes.map(n => <p className="cn-cm" key={str(n.id)}>{str(n.body)} <small className="cn-hint">{when(n.createdAt)}</small></p>) : <p className="cn-hint cn-flush">No notes yet.</p>}
      <form className="cn-nl" onSubmit={e => { e.preventDefault(); addNote(); }}><input className="inp" value={note} aria-invalid={bad} placeholder="Add a decision, a blocker or proof…" aria-label="Add a note" autoComplete="off" onChange={e => { setBad(false); setNote(e.target.value); }} />
        <button className="btn sm" type="submit" disabled={!ctx.write || ctx.busy}>Add note</button></form><p className="cn-hint cn-flush">A Trunk working the card reads the notes.</p></Sec>
    {shows(ctx.level, "advanced") ? <WaitsFor ctx={ctx} c={c} /> : null}
    <Follow ctx={ctx} c={c} />
  </>;
}

function WaitsFor({ ctx, c }: { ctx: Ctx; c: Row }) {
  const [at, setAt] = useState<MenuAnchor | null>(null), deps = waitsFor(c), n = blocksCount(c, ctx.d.cards);
  const cand = ctx.d.cards.filter(x => str(x.id) !== str(c.id) && !isArchived(x) && !deps.includes(str(x.id)));
  return <Sec title="Waits for">
    {deps.length ? <div className="cn-rows">{deps.map(d => { const x = ctx.d.cards.find(y => str(y.id) === d);
      return <div className="cn-prow" key={d}><span className="cn-grow"><b>{x ? str(x.title) : "A card that’s gone"}</b></span>{x ? <Pill tone={x.status === "done" ? "ok" : "idle"}>{statusName(str(x.status))}</Pill> : <Pill tone="warn">Missing</Pill>}
        <button className="btn ghost sm" type="button" disabled title={shownWhy("Needs the engine's unlink method for card dependencies.")}>Take it out</button></div>; })}</div> : <p className="cn-hint cn-flush">It doesn’t wait for any card.</p>}
    <button className="btn sm cn-left" type="button" aria-haspopup="menu" disabled={!ctx.write} onClick={e => setAt(anchorOf(e.currentTarget))}>Add a card it waits for</button>
    {n ? <p className="cn-hint cn-flush">{n} blocked: {n === 1 ? "1 card waits" : `${n} cards wait`} for this one.</p> : null}
    {at ? <ChoiceMenu at={at} label="Waits for" head="Waits for" radio onClose={() => setAt(null)} options={cand.map(x => ({ id: str(x.id), checked: false, label: <>{str(x.title)}<span className="cn-mi-r">{statusName(str(x.status))}</span></> }))}
      onPick={pid => { setAt(null); void ctx.act(() => ctx.engine.request("canopy.cards.linkDependency", { parentId: pid, childId: c.id }), "Link added."); }}
      foot={!cand.length ? <p className="cn-hint cn-pad">No other cards.</p> : null} /> : null}
  </Sec>;
}

function Follow({ ctx, c }: { ctx: Ctx; c: Row }) {
  const [subs, setSubs] = useState<Row[] | null>(null), [err, setErr] = useState(""), notices = rows(meta(c).notifications).slice().reverse();
  useEffect(() => { let live = true; ctx.engine.request("canopy.notifications.list", { cardId: c.id }).then(r => { if (live) setSubs(rows(rec(r).subscriptions)); }, e => { if (live) setErr(errorText(e)); }); return () => { live = false; }; }, [ctx.engine, c.id, ctx.d]);
  const on = (subs ?? []).find(s => str(s.cardId) === str(c.id));
  const toggle = () => void ctx.act(() => on ? ctx.engine.request("canopy.notifications.delete", { id: on.id }) : ctx.engine.request("canopy.notifications.subscribe", { boardId: cardBoard(c), cardId: c.id }), on ? "Stopped following." : "Following. Its moves and notes reach your notifications.");
  return <Sec title="Notifications">
    <button className="btn sm cn-left" type="button" aria-pressed={!!on} disabled={!ctx.write || subs === null} onClick={toggle}>{on ? "Following" : "Follow this card"}</button>
    {err ? <p className="cn-err">{err}</p> : null}
    {notices.length ? <ol className="cn-tl">{notices.map(n => <li key={str(n.id)}><span>{str(n.message)}</span><time>{when(n.createdAt)}</time></li>)}</ol> : <p className="cn-hint cn-flush">No notices for this card yet.</p>}
  </Sec>;
}

function ConversationTab({ ctx, c }: { ctx: Ctx; c: Row }) {
  const key = str(c.sessionKey), agent = str(c.agentId) || ctx.d.defaultTrunk, name = trunkName(ctx.d, agent);
  const startable = ["backlog", "todo", "ready"].includes(str(c.status)), off = !ctx.write || ctx.busy || !startable;
  const start = <button className="btn pri sm" type="button" disabled={off} title={startable ? undefined : "Move it to Backlog, To do or Ready first."} onClick={() => void ctx.act(() => ctx.engine.request("canopy.cards.start", { id: c.id }), `Started ${name} on “${str(c.title)}”. It shows in Canopy › Now.`)}>Start</button>;
  if (!key) return <><p className="cn-flush">No conversation yet</p><div className="cn-acts">{start}
    <button className="btn sm" type="button" disabled={!ctx.write} onClick={() => { const k = `agent:${agent}:${ctx.d.mainKey}`; void ctx.act(() => ctx.engine.request("canopy.cards.update", { id: c.id, expectedUpdatedAt: c.updatedAt, patch: { sessionKey: k } }), `Linked “${str(c.title)}” to ${name}’s conversation. Nothing was sent.`).then(ok => ok && ctx.openConversation(k)); }}>Open a conversation by hand</button></div>
    <p className="cn-hint cn-flush">Start {name} on this card.</p></>;
  const row = ctx.d.sessions.find(s => str(s.key) === key), who = trunkName(ctx.d, str(row?.agentId) || agent);
  return <><div className="cn-who"><TrunkFace name={who} size={34} /><span className="cn-grow"><b>{row ? who : "Not available"}</b><small>{convState(c, ctx.d.sessions, ctx.now)[0]}</small></span></div>
    <div className="cn-acts"><button className="btn sm" type="button" onClick={() => ctx.openConversation(key)}>Open conversation</button>
      {c.status === "running" ? <button className="btn ghost sm cn-stop" type="button" disabled={!ctx.write || ctx.busy} onClick={() => void ctx.act(() => ctx.engine.request("sessions.abort", { key }), "Stopped. What it did so far is kept.")}>Stop</button> : start}</div></>;
}
