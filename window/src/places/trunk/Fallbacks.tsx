// The stand-in models a Trunk tries, in order, when its main model can't answer. Every row has the same controls:
// move up, move down, remove. The order is saved with the editor's Save.
import { useState } from "react";
import { Menu, type MenuAnchor } from "../../shell/Menu";
import { Icon } from "../../shell/icons";
import type { ModelChoice } from "../../composer/model";
import type { Draft } from "./api";
import type { May } from "./may";
import { modelName, moved } from "./fallback-list";

type RowProps = { model: string; index: number; count: number; models: ModelChoice[]; move: (from: number, to: number) => void; remove: () => void };
function FallbackRow({ model, index, count, models, move, remove }: RowProps) {
  return (
    <div className="tk-fb">
      <span className="tk-fb-n">{index + 1}</span>
      <span className="tk-grow">{modelName(models, model)}</span>
      <button type="button" className="ib" aria-label={`Move ${modelName(models, model)} up`} title="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}><Icon name="chev" small /></button>
      <button type="button" className="ib" aria-label={`Move ${modelName(models, model)} down`} title="Move down" disabled={index === count - 1} onClick={() => move(index, index + 1)}><Icon name="chev" small /></button>
      <button type="button" className="ib" aria-label={`Remove ${modelName(models, model)}`} title="Remove" onClick={remove}><Icon name="x" small /></button>
    </div>
  );
}

type Props = { draft: Draft; models: ModelChoice[]; setMay: (m: Partial<May>) => void };
export function Fallbacks({ draft, models, setMay }: Props) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const list = draft.may.fallbacks, main = modelName(models, draft.model) || "its model";
  const left = models.filter((m) => !list.includes(m.ref) && m.ref !== draft.model);
  const move = (from: number, to: number) => setMay({ fallbacks: moved(list, from, to) });
  return (
    <div className="tk-ctl tk-fallbacks">
      <b>If {main} can’t answer</b><small>Tried in this order, for this Trunk only.</small>
      <div className="tk-fb-list">
        {list.length ? list.map((ref, i) => <FallbackRow key={ref} model={ref} index={i} count={list.length} models={models} move={move} remove={() => setMay({ fallbacks: list.filter((x) => x !== ref) })} />)
          : <p className="tk-hint">Same as everywhere: the order in Settings › Accounts.</p>}
      </div>
      <div><button type="button" className="btn sm" aria-haspopup="menu" disabled={!left.length} title={left.length ? undefined : "Every model that’s set up is already listed."} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>Add a stand-in…</button></div>
      {menu && <Menu at={menu} label="Add a stand-in" onClose={() => setMenu(null)} items={[{ kind: "head", label: "Add a stand-in" }, ...left.map((m) => ({ label: m.name, run: () => { setMay({ fallbacks: [...list, m.ref] }); setMenu(null); } }))]} />}
    </div>
  );
}
