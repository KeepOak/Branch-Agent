// Inbox › History › [A] "Every conversation" (preview 41-placesap everyPD18): every stored conversation as a
// table with filters, or the working copies; [T] adds Branch-wide and unmatched conversations.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Face } from "../../face/Face";
import { Icon } from "../../shell/icons";
import { Menu, type MenuAnchor } from "../../shell/Menu";
import { shows, type Level } from "../../places-nav/level";
import { agentName, conversationTitle, type Session } from "../overview/engine";
import { clock, dayWord } from "../overview/format";
import { errorText, rec, rows, str, type Row } from "./data";
import type { HistoryData } from "./History";

type Filters = { arch: "active" | "archived"; q: string; trunk: string; mins: string; max: string; glob: boolean; unk: boolean };
const START: Filters = { arch: "active", q: "", trunk: "", mins: "", max: "50", glob: true, unk: false };
const kindWord = (s: Session) => s.kind === "global" ? "Branch-wide" : s.kind === "unknown" ? "Unmatched" : s.kind === "group" || s.kind === "channel" ? "Group chat" : "Conversation";
const when = (ms?: number) => ms === undefined ? "" : dayWord(new Date(ms)) === "Today" ? clock(new Date(ms)) : dayWord(new Date(ms));

export function everyRows(list: Session[], f: Filters, level: Level, names: (id: string) => string, now = Date.now()): Session[] {
  const q = f.q.trim().toLowerCase(), max = Math.max(0, parseInt(f.max, 10) || 0), mins = parseInt(f.mins, 10);
  const out = list.filter(s => (f.arch === "archived" ? s.archived : !s.archived)
    && (s.kind !== "global" || (f.glob && shows(level, "technical"))) && (s.kind !== "unknown" || (f.unk && shows(level, "technical")))
    && (!q || [conversationTitle(s, names(s.agentId)), kindWord(s), names(s.agentId)].some(t => t.toLowerCase().includes(q)))
    && (!f.trunk || s.agentId === f.trunk)
    && (f.arch === "archived" || !(mins > 0) || s.working || now - (s.updatedAt ?? 0) <= mins * 6e4));
  return max ? out.slice(0, max) : out;
}

function WorkingCopies({ engine, open }: { engine: WindowEngine; open: (key: string) => void }) {
  const [state, setState] = useState<{ list?: Row[]; error?: string }>({});
  useEffect(() => {
    let live = true;
    engine.request("worktrees.list", {}).then(r => { if (live) setState({ list: rows(rec(r).worktrees) }); }, e => { if (live) setState({ error: errorText(e) }); });
    return () => { live = false; };
  }, [engine]);
  if (state.error) return <p className="ib-err" role="alert">{state.error}</p>;
  if (!state.list) return <p className="ib-hint" role="status">Reading working copies…</p>;
  const live = state.list.filter(w => !w.removedAt);
  return live.length ? <div className="ib-list">{live.map(w => <div className="ib-row" key={str(w.id)}><span className="ib-grow"><b>{str(w.name)} · <code>{str(w.branch)}</code></b><small>{str(w.path)}</small></span>{w.ownerKind === "session" && str(w.ownerId) ? <span className="ib-acts"><button type="button" className="btn sm" onClick={() => open(str(w.ownerId))}>Open</button></span> : null}</div>)}</div> : <p className="ib-empty">No working copies.</p>;
}

export function Every({ engine, data, level, open }: { engine: WindowEngine; data: HistoryData; level: Level; open: (key: string) => void }) {
  const [f, setF] = useState<Filters>(START);
  const [seg, setSeg] = useState<"conv" | "wc">("conv");
  const [menu, setMenu] = useState<{ at: MenuAnchor; kind: "trunk" | "row"; row?: Session } | null>(null);
  const [busy, setBusy] = useState("");
  const names = (id: string) => agentName(data.agents.list, id);
  const all = data.sessions.filter(s => !s.helper), live = all.filter(s => !s.archived && s.kind !== "global" && s.kind !== "unknown");
  const list = everyRows(all, f, level, names);
  const set = JSON.stringify(f) !== JSON.stringify(START);
  const archive = async (s: Session) => { setBusy(""); try { await engine.request("sessions.patch", { key: s.key, ...(s.agentId ? { agentId: s.agentId } : {}), archived: !s.archived }); } catch (e) { setBusy(errorText(e)); } };
  const at = (e: React.MouseEvent<HTMLElement>) => { const r = e.currentTarget.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4 }; };
  return <section className="ib-sec ib-every">
    <div className="ib-sec-h"><h2>Every conversation</h2></div>
    <p className="ib-mono">{live.length} live · {live.filter(s => s.unread).length} unread · {all.filter(s => s.archived).length} archived</p>
    <div className="ib-seg" role="group" aria-label="Show"><button type="button" aria-pressed={seg === "conv"} onClick={() => setSeg("conv")}>Conversations</button><button type="button" aria-pressed={seg === "wc"} onClick={() => setSeg("wc")}>Working copies</button></div>
    {seg === "wc" ? <WorkingCopies engine={engine} open={open} /> : <>
      <div className="ib-evf">
        <input className="ib-inp" value={f.q} placeholder="Filter by title, Trunk, label or kind" aria-label="Filter by title, Trunk, label or kind" onChange={e => setF({ ...f, q: e.target.value })} />
        <div className="ib-seg" role="group" aria-label="Active or archived"><button type="button" aria-pressed={f.arch === "active"} onClick={() => setF({ ...f, arch: "active" })}>Active</button><button type="button" aria-pressed={f.arch === "archived"} onClick={() => setF({ ...f, arch: "archived" })}>Archived</button></div>
        <button type="button" className="btn sm" aria-haspopup="menu" onClick={e => setMenu({ at: at(e), kind: "trunk" })}>{f.trunk ? names(f.trunk) : "Trunk"}<Icon name="down" small /></button>
        {f.arch === "active" ? <label className="ib-evn">Changed within <input className="ib-inp ib-num" inputMode="numeric" value={f.mins} aria-label="Changed within, minutes" onChange={e => setF({ ...f, mins: e.target.value.replace(/\D/g, "") })} /> minutes</label> : null}
        <label className="ib-evn">Show up to <input className="ib-inp ib-num" inputMode="numeric" value={f.max} aria-label="Show up to, conversations" onChange={e => setF({ ...f, max: e.target.value.replace(/\D/g, "") })} /></label>
        {shows(level, "technical") ? <><label className="check"><input type="checkbox" checked={f.glob} onChange={e => setF({ ...f, glob: e.target.checked })} /> Include Branch-wide conversations</label><label className="check"><input type="checkbox" checked={f.unk} onChange={e => setF({ ...f, unk: e.target.checked })} /> Include unmatched conversations</label></> : null}
        {set ? <button type="button" className="btn ghost sm" onClick={() => setF(START)}>Clear</button> : null}
      </div>
      {busy ? <p className="ib-err" role="alert">{busy}</p> : null}
      <div className="ib-evwrap"><table className="ib-evt"><thead><tr><th>Title</th><th>Trunk</th><th>Kind</th><th>Last activity</th><th>Context left</th><th>Archived</th><th><span className="ib-sr">More</span></th></tr></thead>
        <tbody>{list.length ? list.map(s => <tr key={s.key}>
          <td><button type="button" className="ib-title-btn" onClick={() => open(s.key)}>{conversationTitle(s, names(s.agentId))}</button></td><td><Face size={20} label={names(s.agentId)} /></td><td>{kindWord(s)}</td><td>{when(s.updatedAt)}</td>
          <td className="ib-mono">{s.room === undefined ? "—" : `${Math.round(s.room * 100)}%`}</td><td>{s.archived ? "Archived" : "—"}</td>
          <td>{s.kind === "global" || s.kind === "unknown" ? null : <button type="button" className="ib-ib" aria-haspopup="menu" aria-label={`More for ${conversationTitle(s, names(s.agentId))}`} title={`More for ${conversationTitle(s, names(s.agentId))}`} onClick={e => setMenu({ at: at(e), kind: "row", row: s })}><Icon name="more" /></button>}</td></tr>)
          : <tr><td colSpan={7} className="ib-hint">Nothing matches.</td></tr>}</tbody></table></div>
    </>}
    {menu?.kind === "trunk" ? <Menu at={menu.at} label="Trunk" onClose={() => setMenu(null)} items={[{ label: `${!f.trunk ? "✓ " : ""}All Trunks`, run: () => setF({ ...f, trunk: "" }) }, ...data.agents.list.map(a => ({ label: `${f.trunk === a.id ? "✓ " : ""}${a.name}`, run: () => setF({ ...f, trunk: a.id }) }))]} /> : null}
    {menu?.kind === "row" && menu.row ? <Menu at={menu.at} label="Conversation" onClose={() => setMenu(null)} items={[{ label: menu.row.archived ? "Unarchive" : "Archive", run: () => void archive(menu.row!) }]} /> : null}
  </section>;
}
