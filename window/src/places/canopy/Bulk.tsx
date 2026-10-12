// [A] Select several (§4.6.7): the selection bar above the board and its actions, via canopy.cards.bulk.
import { useState } from "react";
import type { MenuAnchor } from "../../shell/Menu";
import { errorText, rec, rows, str, type Row } from "../automations/runtime";
import { BulkDialog, Confirm, labelsOf, type BulkDraft } from "./CardDialogs";
import { STATUSES } from "./cards-model";
import { anchorOf, ChoiceMenu, TrunkFace, type Ctx } from "./ui";

const PARTWAY = "It stopped partway. The rest are still selected; refresh and try again.";

/** Applies a bulk change; "Done for n of n cards." only when the engine changed every selected card. */
function bulk(ctx: Ctx, ids: string[], params: Row, after?: (done: Row[]) => Promise<number>) {
  return ctx.act(async () => {
    try {
      const res = Object.keys(params).length ? rows(rec(await ctx.engine.request("canopy.cards.bulk", { ids, ...params })).cards) : [];
      if ((after ? await after(res) : res.length) < ids.length) throw new Error("Fewer cards changed than were selected.");
    } catch (e) { throw new Error(`${PARTWAY} (${errorText(e)})`); }
  }, `Done for ${ids.length} of ${ids.length} cards.`);
}

export function SelectionBar({ ctx, ids, clear }: { ctx: Ctx; ids: string[]; clear: () => void }) {
  const [menu, setMenu] = useState<{ k: "assign" | "move"; at: MenuAnchor } | null>(null), [dlg, setDlg] = useState<"edit" | "delete" | null>(null);
  const run = (params: Row) => void bulk(ctx, ids, params).then(ok => ok && clear());
  const edit = (b: BulkDraft) => {
    const patch: Row = { ...(b.status ? { status: b.status } : {}), ...(b.priority ? { priority: b.priority } : {}), ...(b.agentId ? { agentId: b.agentId } : {}), ...(b.lab === "replace" ? { labels: labelsOf(b.labels) } : {}) };
    const perCard = b.lab === "add" || b.lab === "remove";
    if (!perCard && !Object.keys(patch).length) return Promise.resolve(true);
    return bulk(ctx, ids, Object.keys(patch).length ? { patch } : {}, async () => {
      if (!perCard) return ids.length;
      let n = 0;
      for (const id of ids) {
        const c = ctx.d.cards.find(x => str(x.id) === id), have = Array.isArray(c?.labels) ? c.labels.map(String) : [], L = labelsOf(b.labels);
        await ctx.engine.request("canopy.cards.update", { id, patch: { labels: b.lab === "add" ? [...new Set([...have, ...L])] : have.filter(x => !L.includes(x)) } });
        n++;
      }
      return n;
    }).then(ok => { if (ok) clear(); return ok; });
  };
  const del = () => bulk(ctx, ids, {}, async () => { let n = 0; for (const id of ids) { const c = ctx.d.cards.find(x => str(x.id) === id); await ctx.engine.request("canopy.cards.delete", { id, expectedUpdatedAt: c?.updatedAt }); n++; } return n; }).then(ok => { if (ok) clear(); return ok; });
  const off = !ctx.write || ctx.busy;
  return (
    <div className="cn-selbar" role="toolbar" aria-label="Selected cards">
      <b>{ids.length} selected</b>
      <button className="btn sm" type="button" aria-haspopup="menu" disabled={off} onClick={e => setMenu({ k: "assign", at: anchorOf(e.currentTarget) })}>Assign Trunk…</button>
      <button className="btn sm" type="button" disabled={off} onClick={() => setDlg("edit")}>Edit properties</button>
      <button className="btn sm" type="button" aria-haspopup="menu" disabled={off} onClick={e => setMenu({ k: "move", at: anchorOf(e.currentTarget) })}>Move to…</button>
      <button className="btn sm" type="button" disabled={off} onClick={() => run({ patch: {}, archived: true })}>Archive</button>
      <button className="btn sm cn-badt" type="button" disabled={off} onClick={() => setDlg("delete")}>Delete</button>
      <button className="btn ghost sm" type="button" onClick={clear}>Clear selection</button>
      {menu?.k === "assign" ? <ChoiceMenu at={menu.at} label="Assign Trunk" radio onClose={() => setMenu(null)} onPick={id => { setMenu(null); run({ patch: { agentId: id } }); }}
        options={ctx.d.trunks.map(t => ({ id: t.id, checked: false, label: <><TrunkFace name={t.name} size={20} /> {t.name}</> }))} /> : null}
      {menu?.k === "move" ? <ChoiceMenu at={menu.at} label="Move to" head="Move to" radio onClose={() => setMenu(null)} onPick={id => { setMenu(null); run({ patch: { status: id } }); }}
        options={STATUSES.map(([id, label]) => ({ id, label, checked: false }))} /> : null}
      {dlg === "edit" ? <BulkDialog ctx={ctx} n={ids.length} apply={edit} close={() => setDlg(null)} /> : null}
      {dlg === "delete" ? <Confirm title={`Delete ${ids.length} cards?`} body="They can’t be brought back. Running conversations carry on." yes="Delete" no="Keep them" busy={ctx.busy} run={del} close={() => setDlg(null)} /> : null}
    </div>
  );
}
