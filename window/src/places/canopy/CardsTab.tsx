// Canopy › Cards (§4.6.7): Canopy's own boards with the nine statuses, wired to engine/extensions/canopy
// (canopy.cards.*, canopy.boards.*). Drag or "Move to" moves a card; the detail sheet opens from its body.
import { useEffect, useState, type DragEvent } from "react";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { shows } from "../../places-nav/level";
import { Icon } from "../../shell/icons";
import { Menu, type MenuAnchor } from "../../shell/Menu";
import type { BoardScope } from "../automations/board-route";
import { str, type Row } from "../automations/runtime";
import { cardBoard, isArchived, sessionsBoardIds, trunkName } from "./data";
import { boardIdFor, convState, dispatchLine, inScope, NO_CARD_FILTERS, STATUSES, visibleCards, type CardFilters } from "./cards-model";
import { CardFace, cardMenu, type CardOps } from "./CardFace";
import { BoardDialog, CardDialog, Confirm, cardPatch, draftOf, type BoardDraft, type CardDraft } from "./CardDialogs";
import { AutomationChip, BoardPicker, CardFilterRow, ViewMenu, type View } from "./CardsHeader";
import { SelectionBar } from "./Bulk";
import { SessionsBoard, SessionsBoardDialog } from "./SessionsBoard";
import { Glyph } from "./glyphs";
import { anchorOf, TrunkFace, type Ctx } from "./ui";

const VIEW_KEY = "branch.canopy.cards.view";
const DEFAULT_VIEW: View = { mode: "columns", density: "comfortable", empty: "show", collapsed: {} };
function readView(): View {
  try { return { ...DEFAULT_VIEW, ...JSON.parse(localStorage.getItem(VIEW_KEY) || "{}") }; }
  catch (e) { console.warn("Canopy view preference unreadable; using the default view.", e); return DEFAULT_VIEW; }
}
function saveView(v: View) {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(v)); }
  catch (e) { console.warn("Canopy view preference not saved; it applies until Branch closes.", e); }
}

type Dlg = { kind: "card"; base?: Row; start: CardDraft } | { kind: "board"; start: BoardDraft } | { kind: "delete"; c: Row } | { kind: "delboard"; b: Row } | { kind: "sboard"; b: Row } | null;

function useCardOps(ctx: Ctx, setDlg: (d: Dlg) => void, sheet: (c: Row) => void, sel: string[], setSel: (s: string[]) => void, density: View["density"]): CardOps {
  const e = ctx.engine, name = (c: Row) => trunkName(ctx.d, str(c.agentId) || ctx.d.defaultTrunk);
  return {
    move: (c, status) => void ctx.act(() => e.request("canopy.cards.move", { id: c.id, status, expectedUpdatedAt: c.updatedAt }), `Moved to ${STATUSES.find(s => s[0] === status)?.[1]}.`),
    edit: c => setDlg({ kind: "card", base: c, start: draftOf(c) }), sheet,
    start: (c, provider) => void ctx.act(() => e.request("canopy.cards.start", { id: c.id, ...(provider ? { provider } : {}) }), `Started ${name(c)} on “${str(c.title)}”. It shows in Canopy › Now.`),
    byHand: c => { const key = `agent:${str(c.agentId) || ctx.d.defaultTrunk}:${ctx.d.mainKey}`; void ctx.act(() => e.request("canopy.cards.update", { id: c.id, expectedUpdatedAt: c.updatedAt, patch: { sessionKey: key } }), `Linked “${str(c.title)}” to ${name(c)}’s conversation. Nothing was sent.`).then(ok => ok && ctx.openConversation(key)); },
    stop: c => void ctx.act(() => e.request("sessions.abort", { key: c.sessionKey }), "Stopped. What it did so far is kept."),
    archive: c => void ctx.act(() => e.request("canopy.cards.archive", { id: c.id, archived: !isArchived(c), expectedUpdatedAt: c.updatedAt }), isArchived(c) ? "Restored." : "Archived."),
    remove: c => setDlg({ kind: "delete", c }),
    selected: sel, select: (id, on) => setSel(on ? [...new Set([...sel, id])] : sel.filter(x => x !== id)), density,
  };
}

/** No cards to draw: each scope says what it shows and offers the whole board; a filtered view says to change its filters. */
function NoCards({ scope, onShowAll }: { scope: BoardScope; onShowAll?: () => void }) {
  if (scope === "all") return <p className="cn-hint cn-nomatch">No cards match this view. Try fewer filters or a different search.</p>;
  const words = scope === "running" ? "Nothing is running right now." : "Nothing is active or changed today.";
  return <div className="cn-center"><p className="cn-hint">{words}</p>{onShowAll ? <button className="btn sm" type="button" onClick={onShowAll}>Show all cards</button> : null}</div>;
}

export function CardsTab({ ctx, trunks, setTrunks, sheet, scope = "all", onShowAll }: { ctx: Ctx; trunks: string[]; setTrunks: (t: string[]) => void; sheet: (c: Row) => void; scope?: BoardScope; onShowAll?: () => void }) {
  const [board, setBoard] = useState("all"), [F, setF] = useState<CardFilters>(NO_CARD_FILTERS), [v, setV] = useState<View>(readView);
  const [sel, setSel] = useState<string[]>([]), [dlg, setDlg] = useState<Dlg>(null), [result, setResult] = useState("");
  useEffect(() => saveView(v), [v]);
  const adv = shows(ctx.level, "advanced"), b = ctx.d.boards.find(x => str(x.id) === board), e = ctx.engine;
  const ops = useCardOps(ctx, setDlg, sheet, sel, setSel, v.density);
  const pickBoard = (id: string) => { setBoard(id); setSel([]); setResult(""); };
  const saveCard = (base?: Row) => (d: CardDraft) => base
    ? ctx.act(() => e.request("canopy.cards.update", { id: base.id, expectedUpdatedAt: base.updatedAt, patch: cardPatch(d, base) }), "Saved.")
    : ctx.act(() => e.request("canopy.cards.create", { ...cardPatch(d), ...(board !== "all" && b?.kind !== "sessions" ? { boardId: board } : {}) }), `Made “${d.title.trim()}” in ${STATUSES.find(s => s[0] === d.status)?.[1]}.`);
  const saveBoard = (x: BoardDraft, reset?: boolean) => ctx.act(async () => {
    const id = x.id ?? boardIdFor(x.name, ctx.d.boards);
    const look = x.color ? { color: x.color } : x.id ? { clearAppearance: true } : {};
    const res = await e.request("canopy.boards.upsert", reset ? { id, clearAppearance: true } : { id, name: x.name.trim(), ...(x.id ? {} : { kind: x.kind }), ...look });
    if (!x.id) pickBoard(id);
    return res;
  }, x.id ? "Saved the board." : `Made ${x.name.trim()}.`);
  const dispatch = () => void ctx.act(async () => { const res = await e.request("canopy.cards.dispatch", board !== "all" ? { boardId: board } : {}); setResult(dispatchLine(res as Row)); return res; }, "Start Trunks ran.");
  const all = ctx.d.cards.filter(c => board === "all" ? !sessionsBoardIds(ctx.d.boards).has(cardBoard(c)) : cardBoard(c) === board);
  const list = visibleCards(ctx.d.cards, board, sessionsBoardIds(ctx.d.boards), F, trunks, ctx.now).filter(c => inScope(c, scope, ctx.now));
  const head = (
    <div className="cn-head">
      <BoardPicker ctx={ctx} board={board} setBoard={pickBoard} newBoard={() => setDlg({ kind: "board", start: { kind: "cards", name: "", color: "" } })}
        editBoard={x => setDlg(x.kind === "sessions" && adv ? { kind: "sboard", b: x } : { kind: "board", start: { id: str(x.id), kind: x.kind === "sessions" ? "sessions" : "cards", name: str(x.name), color: str(x.color) } })}
        archiveBoard={x => void ctx.act(() => e.request("canopy.boards.archive", { id: x.id, archived: !x.archivedAt }), x.archivedAt ? `Restored ${str(x.name) || str(x.id)}.` : `Archived ${str(x.name) || str(x.id)}.`).then(ok => { if (ok && !x.archivedAt) pickBoard("all"); })}
        deleteBoard={x => setDlg({ kind: "delboard", b: x })} />
      <AutomationChip ctx={ctx} b={b} /><span className="cn-grow-x" />
      {b?.kind === "sessions" ? null : <>
        <button className="btn sm" type="button" disabled={!ctx.write || ctx.busy} title={board === "all" ? "Starts the Ready cards on every board, up to 3 at a time." : "Starts this board’s Ready cards, up to 3 at a time."} onClick={dispatch}>Start Trunks</button>
        <button className="btn pri sm" type="button" disabled={!ctx.write} onClick={() => setDlg({ kind: "card", start: draftOf() })}>New card</button>
        {adv ? <ViewMenu v={v} setV={setV} /> : null}</>}
    </div>
  );
  return <>
    {head}{result ? <p className="cn-hint cn-res">{result}</p> : null}
    {b?.kind === "sessions" ? <SessionsBoard ctx={ctx} board={b} /> : !all.length ? <>
      <EmptyLine icon={<span className="cn-empty-i"><Glyph name="eye" /></span>}>No cards yet. Add one, or start from a suggestion.</EmptyLine>
      <div className="cn-center"><button className="btn sm" type="button" disabled={!ctx.write} onClick={() => setDlg({ kind: "card", start: draftOf() })}>New card</button></div>
    </> : <>
      <CardFilterRow ctx={ctx} F={F} setF={setF} trunks={trunks} setTrunks={setTrunks} />
      {adv && sel.length ? <SelectionBar ctx={ctx} ids={sel.filter(id => ctx.d.cards.some(c => str(c.id) === id))} clear={() => setSel([])} /> : null}
      {list.length ? <Board ctx={ctx} list={list} v={v} setV={setV} ops={ops} setDlg={setDlg} setSel={setSel} /> : <NoCards scope={scope} onShowAll={onShowAll} />}
    </>}
    {dlg?.kind === "card" ? <CardDialog ctx={ctx} base={dlg.base} start={dlg.start} save={saveCard(dlg.base)} close={() => setDlg(null)} /> : null}
    {dlg?.kind === "board" ? <BoardDialog start={dlg.start} busy={ctx.busy} save={saveBoard} close={() => setDlg(null)} /> : null}
    {dlg?.kind === "sboard" ? <SessionsBoardDialog ctx={ctx} board={dlg.b} close={() => setDlg(null)} /> : null}
    {dlg?.kind === "delete" ? <Confirm title={`Delete “${str(dlg.c.title)}”?`} body="It can’t be brought back. A running conversation carries on." yes="Delete" no="Keep it" busy={ctx.busy} close={() => setDlg(null)}
      run={() => ctx.act(() => e.request("canopy.cards.delete", { id: dlg.c.id, expectedUpdatedAt: dlg.c.updatedAt }), "Deleted.")} /> : null}
    {dlg?.kind === "delboard" ? <Confirm title={`Delete “${str(dlg.b.name) || str(dlg.b.id)}”?`} body="Running conversations carry on. An automation linked to it is kept." yes="Delete" no="Keep it" busy={ctx.busy} close={() => setDlg(null)}
      run={() => ctx.act(() => e.request("canopy.boards.delete", { id: dlg.b.id }), `Deleted ${str(dlg.b.name) || str(dlg.b.id)}.`).then(ok => { if (ok) pickBoard("all"); return ok; })} /> : null}
  </>;
}

function Board({ ctx, list, v, setV, ops, setDlg, setSel }: { ctx: Ctx; list: Row[]; v: View; setV: (v: View) => void; ops: CardOps; setDlg: (d: Dlg) => void; setSel: (s: string[]) => void }) {
  const [over, setOver] = useState(""), [menu, setMenu] = useState<{ k: string; at: MenuAnchor } | null>(null), adv = shows(ctx.level, "advanced");
  const drop = (k: string) => (ev: DragEvent) => { ev.preventDefault(); setOver(""); const c = ctx.d.cards.find(x => str(x.id) === ev.dataTransfer.getData("text/canopy-card")); if (c && c.status !== k) ops.move(c, k); };
  const cols = STATUSES.filter(([k]) => !(adv && v.empty === "hide" && !list.some(c => c.status === k)));
  if (adv && v.mode === "list") return <ListView ctx={ctx} list={list} cols={cols} ops={ops} />;
  return (
    <div className="cn-cboard" role="list" aria-label="Cards">
      {cols.map(([k, l]) => { const cs = list.filter(c => c.status === k), folded = adv && (v.collapsed[k] || (!cs.length && v.empty === "collapse"));
        return <section key={k} className={`cn-ccol${over === k ? " over" : ""}${folded ? " folded" : ""}`} aria-label={l} onDragOver={ev => { ev.preventDefault(); setOver(k); }} onDragLeave={() => setOver("")} onDrop={drop(k)}>
          <h3 className={k === "blocked" ? "bad" : undefined}><span className="cn-chh">{l}<span>{cs.length}</span></span>
            <button type="button" className="ib sm" aria-label={`New card in ${l}`} title={`New card in ${l}`} disabled={!ctx.write} onClick={() => setDlg({ kind: "card", start: draftOf(undefined, k) })}><Icon name="plus" /></button>
            {adv ? <button type="button" className="ib sm" aria-haspopup="menu" aria-label={`${l} menu`} title={`${l} menu`} onClick={ev => setMenu({ k, at: anchorOf(ev.currentTarget) })}><Icon name="more" /></button> : null}</h3>
          {folded ? null : cs.length ? cs.map(c => <CardFace key={str(c.id)} ctx={ctx} c={c} ops={ops} />) : <p className="cn-empty">Drop work here</p>}
        </section>; })}
      {menu ? <Menu at={menu.at} label="Column menu" onClose={() => setMenu(null)} items={[
        { label: v.collapsed[menu.k] ? `Expand ${STATUSES.find(s => s[0] === menu.k)?.[1]}` : `Collapse ${STATUSES.find(s => s[0] === menu.k)?.[1]}`, run: () => setV({ ...v, collapsed: { ...v.collapsed, [menu.k]: !v.collapsed[menu.k] } }) },
        { label: `Select all in ${STATUSES.find(s => s[0] === menu.k)?.[1]}`, run: () => setSel([...new Set([...ops.selected, ...list.filter(c => c.status === menu.k).map(c => str(c.id))])]) },
        { label: `New card in ${STATUSES.find(s => s[0] === menu.k)?.[1]}`, disabled: ctx.write ? undefined : "Needs permission to change cards.", run: () => setDlg({ kind: "card", start: draftOf(undefined, menu.k) }) },
      ]} /> : null}
    </div>
  );
}

function ListView({ ctx, list, cols, ops }: { ctx: Ctx; list: Row[]; cols: [string, string][]; ops: CardOps }) {
  const [menu, setMenu] = useState<{ c: Row; at: MenuAnchor } | null>(null);
  return <div className="cn-clist">{cols.map(([k, l]) => { const cs = list.filter(c => c.status === k);
    return <section key={k} aria-label={l}><h3 className={k === "blocked" ? "bad" : undefined}>{l} <span>{cs.length}</span></h3><div className="cn-rows">
      {cs.map(c => <div className="cn-prow" key={str(c.id)} tabIndex={0} onKeyDown={ev => { if (ev.key === "Enter" && ev.target === ev.currentTarget) ops.sheet(c); }} onClick={ev => { if (!(ev.target as Element).closest("button, input")) ops.sheet(c); }}>
        <input type="checkbox" checked={ops.selected.includes(str(c.id))} aria-label={`Select “${str(c.title)}”`} onChange={ev => ops.select(str(c.id), ev.target.checked)} />
        {str(c.agentId) ? <TrunkFace name={trunkName(ctx.d, str(c.agentId))} size={20} /> : null}
        <span className="cn-grow"><b>{str(c.title)}</b><small>{convState(c, ctx.d.sessions, ctx.now)[0]}{Array.isArray(c.labels) && c.labels.length ? ` · ${c.labels.join(", ")}` : ""}</small></span>
        <button type="button" className="ib sm" aria-haspopup="menu" aria-label={`More for “${str(c.title)}”`} onClick={ev => setMenu({ c, at: anchorOf(ev.currentTarget, true) })}><Icon name="more" /></button>
      </div>)}{!cs.length ? <p className="cn-empty">Drop work here</p> : null}</div></section>; })}
    {menu ? <CardMenuHost ctx={ctx} c={menu.c} at={menu.at} ops={ops} close={() => setMenu(null)} /> : null}
  </div>;
}

function CardMenuHost({ ctx, c, at, ops, close }: { ctx: Ctx; c: Row; at: MenuAnchor; ops: CardOps; close: () => void }) {
  return <Menu at={at} label={`More for “${str(c.title)}”`} items={cardMenu(ctx, c, ops)} onClose={close} />;
}
