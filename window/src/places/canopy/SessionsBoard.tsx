// [A] A Conversations board (§4.6.7 "Conversations board"): tiles are conversations sorted into the board's own
// columns by canopy.sessionsBoard.read; dragging one pins it there with canopy.sessionsBoard.move.
import { useEffect, useState, type DragEvent } from "react";
import { Dialog } from "../../shell/Dialog";
import { Segmented } from "../../shell/Popover";
import { errorText, rec, rows, str, type Row } from "../automations/runtime";
import { trunkName } from "./data";
import { TINTS } from "./cards-model";
import { clock, TrunkFace, type Ctx } from "./ui";

const HOW: Record<string, string> = { state: "by rule", model: "by model", operator: "pinned" };
const RUN: Record<string, string> = { active: "working", idle: "idle", failed: "failed" };

function useBoardRead(ctx: Ctx, boardId: string, mine: boolean) {
  const [state, setState] = useState<{ data: Row | null; error: string }>({ data: null, error: "" });
  useEffect(() => {
    let live = true;
    ctx.engine.request("canopy.sessionsBoard.read", { boardId, ...(mine ? { view: { involvingMe: true } } : {}) })
      .then(data => { if (live) setState({ data: rec(data), error: "" }); }, e => { if (live) setState({ data: null, error: errorText(e) }); });
    return () => { live = false; };
  }, [ctx.engine, ctx.d, boardId, mine]);
  return state;
}

export function SessionsBoard({ ctx, board }: { ctx: Ctx; board: Row }) {
  const [mine, setMine] = useState(false), [over, setOver] = useState(""), id = str(board.id);
  const { data, error } = useBoardRead(ctx, id, mine);
  if (error) return <p className="cn-err" role="alert">{error}</p>;
  if (!data) return <p className="cn-hint" role="status">Reading the board…</p>;
  const spec = rec(rec(data.board).sessions), hours = Number(rec(spec.scope).maxAgeHours) || 72;
  const sorter = str(spec.agentSessionKey).split(":")[1] || ctx.d.defaultTrunk, cols = rows(data.columns), tiles = rows(data.sessions);
  const drop = (col: Row) => (e: DragEvent) => { e.preventDefault(); setOver(""); const key = e.dataTransfer.getData("text/canopy-conversation");
    if (key) void ctx.act(() => ctx.engine.request("canopy.sessionsBoard.move", { boardId: id, sessionKey: key, columnId: str(col.id) }), `Pinned to ${str(col.label)}.`); };
  return <>
    <div className="cn-cfilt"><Segmented label="Whose conversations" value={mine ? "me" : "all"} options={[{ id: "all", name: "Everyone" }, { id: "me", name: "Involving me" }]} onChange={v => setMine(v === "me")} />
      <small className="cn-hint">The last {hours} hours · sorted by {trunkName(ctx.d, sorter)}</small></div>
    {str(data.warning) ? <p className="cn-hint">{str(data.warning)}</p> : null}
    <div className="cn-cboard" role="list" aria-label={str(board.name) || id} style={{ ["--n" as string]: cols.length }}>
      {cols.map(col => { const cs = tiles.filter(t => str(t.columnId) === str(col.id));
        return <section key={str(col.id)} className={over === str(col.id) ? "cn-ccol over" : "cn-ccol"} aria-label={str(col.label)}
          onDragOver={e => { e.preventDefault(); setOver(str(col.id)); }} onDragLeave={() => setOver("")} onDrop={drop(col)}>
          <h3 title={str(col.description) || undefined}><span className="cn-chh">{str(col.label)}<span>{cs.length}</span></span></h3>
          {cs.map(t => <Tile key={str(t.key)} ctx={ctx} t={t} />)}{!cs.length ? <p className="cn-empty">Drop work here</p> : null}
        </section>; })}
    </div>
  </>;
}

function Tile({ ctx, t }: { ctx: Ctx; t: Row }) {
  const name = trunkName(ctx.d, str(t.agentId)), title = str(t.label) || str(t.derivedTitle) || "Conversation";
  const line = str(rec(t.observerDigest).headline) || str(t.lastMessagePreview);
  return (
    <div className="cn-card" role="listitem" tabIndex={0} draggable={ctx.write} aria-label={title}
      onDragStart={e => { e.dataTransfer.setData("text/canopy-conversation", str(t.key)); e.dataTransfer.effectAllowed = "move"; }}
      onClick={() => ctx.openConversation(str(t.key))} onKeyDown={e => { if (e.key === "Enter") ctx.openConversation(str(t.key)); }}>
      <b>{title}</b>
      <span className="cn-foot"><TrunkFace name={name} size={20} working={t.run === "active"} /><small>{RUN[str(t.run)] ?? str(t.run)} · {clock(Number(t.lastActivityAt))}</small></span>
      {line ? <small className="cn-cstate">{line.slice(0, 70)}</small> : null}
      {rows(t.pullRequests).map(p => <span key={String(p.number)} className="cn-pill idle"><i />#{String(p.number)} · {str(p.state).replace(/^./, s => s.toUpperCase())}</span>)}
      <small className="cn-how">{HOW[str(t.source)] ?? ""}</small>
    </div>
  );
}

type Column = { id: string; label: string; color: string; description: string; fallback: boolean; match?: unknown };
const COLOURS = ["", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"];
const colourName = (c: string) => c ? c.charAt(0).toUpperCase() + c.slice(1) : "Default";

/** [A] Edit a Conversations board: name and colour (canopy.boards.upsert), then its columns, how to sort and the
 * Trunk that sorts (canopy.sessionsBoard.update). */
export function SessionsBoardDialog({ ctx, board, close }: { ctx: Ctx; board: Row; close: () => void }) {
  const spec = rec(board.sessions);
  const [name, setName] = useState(str(board.name)), [color, setColor] = useState(str(board.color));
  const [cols, setCols] = useState<Column[]>(rows(spec.columns).map(c => ({ id: str(c.id), label: str(c.label), color: str(c.color), description: str(c.description), fallback: c.fallback === true, ...(c.match !== undefined ? { match: c.match } : {}) })));
  const [how, setHow] = useState(str(spec.instructions)), [agent, setAgent] = useState(str(spec.agentSessionKey).split(":")[1] || ctx.d.defaultTrunk);
  const set = (i: number, p: Partial<Column>) => setCols(cols.map((c, j) => j === i ? { ...c, ...p } : p.fallback ? { ...c, fallback: false } : c));
  const swap = (i: number, j: number) => { const n = [...cols]; [n[i], n[j]] = [n[j], n[i]]; setCols(n); };
  const add = () => { let id = "column", k = 2; while (cols.some(c => c.id === id)) id = `column-${k++}`; setCols([...cols, { id, label: "New column", color: "", description: "New column", fallback: false }]); };
  const save = () => void ctx.act(async () => {
    await ctx.engine.request("canopy.boards.upsert", { id: board.id, name: name.trim(), ...(color ? { color } : { clearAppearance: true }) });
    const columns = cols.map(({ color: c, fallback, ...rest }) => ({ ...rest, ...(c ? { color: c } : {}), ...(fallback ? { fallback: true } : {}) }));
    return ctx.engine.request("canopy.sessionsBoard.update", { boardId: board.id, patch: { columns, instructions: how, agentSessionKey: `agent:${agent}:${ctx.d.mainKey}` } });
  }, "Saved the board.").then(ok => ok && close());
  return (
    <Dialog title="Edit board" wide onClose={close} footer={<><button className="btn ghost" type="button" onClick={close}>Cancel</button><button className="btn pri" type="button" disabled={ctx.busy || !name.trim()} onClick={save}>Save</button></>}>
      <label className="cn-fld"><span>Name</span><input className="inp" value={name} onChange={e => setName(e.target.value)} /></label>
      <div className="cn-fld"><span>Colour</span><span className="cn-tints" role="radiogroup" aria-label="Colour">{TINTS.map(([n, v]) => (
        <button key={n} type="button" role="radio" aria-checked={color === v} title={n} aria-label={n} onClick={() => setColor(v)}><i className="cn-dot" style={{ ["--c" as string]: v || "var(--ink-3)" }} /></button>))}</span></div>
      <section className="cn-ssec"><h2>Columns</h2>{cols.map((c, i) => (
        <div className="cn-bcol" key={c.id}>
          <input className="inp" value={c.label} aria-label={`Label, column ${i + 1}`} onChange={e => set(i, { label: e.target.value })} />
          <select className="inp" value={c.color} aria-label={`Colour, column ${i + 1}`} onChange={e => set(i, { color: e.target.value })}>{COLOURS.map(x => <option key={x} value={x}>{colourName(x)}</option>)}</select>
          <input className="inp" value={c.description} placeholder="Description" aria-label={`Description, column ${i + 1}`} onChange={e => set(i, { description: e.target.value })} />
          <label className="cn-sw"><input type="radio" name="cn-fallback" checked={c.fallback} onChange={() => set(i, { fallback: true })} /> Fallback column</label>
          <span className="cn-acts"><button className="btn ghost sm" type="button" disabled={i === 0} onClick={() => swap(i, i - 1)}>Move up</button><button className="btn ghost sm" type="button" disabled={i === cols.length - 1} onClick={() => swap(i, i + 1)}>Move down</button><button className="btn ghost sm" type="button" disabled={cols.length < 2} onClick={() => setCols(cols.filter((_, j) => j !== i))}>Remove column</button></span>
        </div>))}
        <button className="btn sm cn-left" type="button" onClick={add}>Add column</button></section>
      <label className="cn-fld"><span>How to sort</span><textarea className="inp" rows={3} value={how} placeholder="Instructions for the model for smaller jobs" onChange={e => setHow(e.target.value)} /><small className="cn-hint">Descriptions guide the sorting; instructions refine it for every column.</small></label>
      <label className="cn-fld"><span>Board Trunk</span><select className="inp" value={agent} onChange={e => setAgent(e.target.value)}>{ctx.d.trunks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><small className="cn-hint">The Trunk that sorts and may edit the rules.</small></label>
    </Dialog>
  );
}
