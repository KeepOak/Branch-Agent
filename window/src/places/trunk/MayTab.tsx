// Trunk editor › What it may do (preview 30-trunks mayHTMLC18, 31-trunksp mayMorePC18 at Advanced).
// Each row writes the Trunk's own config entry; rows the engine has no setting for are drawn greyed with the reason.
// The greyed reasons in this file say what is still missing, shown in plain words under each row.
import { useEffect, useState, type ReactNode } from "react";
import { useResource } from "../settings/hooks";
import { usableModelName, type ModelChoice } from "../../composer/model";
import type { WindowEngine } from "../../connect/engine";
import { Menu, type MenuAnchor } from "../../shell/Menu";
import { Segmented, Switch } from "../../shell/Popover";
import { Icon } from "../../shell/icons";
import { shows, type Level } from "../../places-nav/level";
import type { Draft } from "./api";
import { GitHubChoice } from "./GitHubChoice";
import type { May } from "./may";


function Row({ title, hint, children, off }: { title: string; hint: string; children: ReactNode; off?: string }) {
  return <div className={off ? "tk-ctl off" : "tk-ctl"}><b>{title}</b><span className="tk-right">{children}</span><small>{hint}</small>{off ? <small className="tk-why">{off}</small> : null}</div>;
}

const modelName = (models: ModelChoice[], ref: string) => usableModelName(ref, models);

function ModelPick({ draft, models, setModel, openSettings }: { draft: Draft; models: ModelChoice[]; setModel: (ref: string) => void; openSettings?: (page: string) => void }) {
  const options = models;
  const value = models.find((m) => m.ref === draft.model)?.ref ?? models[0]?.ref;
  // The control can only show a usable option. Write that into the draft so Save persists Gemma, not the leftover astra ref.
  useEffect(() => {
    if (value && value !== draft.model) setModel(value);
  }, [value, draft.model, setModel]);
  if (!models.length || !value) return <Row title="Which model" hint="No model is set up yet."><button type="button" className="btn sm" onClick={() => openSettings?.("models")} disabled={!openSettings}>Set up a model</button></Row>;
  return (
    <Row title="Which model" hint="Where this Trunk thinks.">
      {options.length <= 3 && <span className="tk-wide"><Segmented label="Which model" value={value} options={options.map((m) => ({ id: m.ref, name: m.name }))} onChange={setModel} /></span>}
      <select className={options.length <= 3 ? "inp tk-narrow" : "inp"} aria-label="Which model" value={value} onChange={(e) => setModel(e.target.value)}>{options.map((m) => <option key={m.ref} value={m.ref}>{m.name}</option>)}</select>
    </Row>
  );
}

function Fallbacks({ draft, models, setMay }: { draft: Draft; models: ModelChoice[]; setMay: (m: Partial<May>) => void }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const list = draft.may.fallbacks, main = modelName(models, draft.model) || "its model";
  const move = (i: number) => { const next = [...list]; next.splice(i - 1, 0, next.splice(i, 1)[0]); setMay({ fallbacks: next }); };
  const left = models.filter((m) => !list.includes(m.ref) && m.ref !== draft.model);
  return (
    <div className="tk-ctl tk-fallbacks">
      <b>If {main} can’t answer</b><small>Tried in this order, for this Trunk only.</small>
      <div className="tk-fb-list">
        {list.length ? list.map((ref, i) => <div className="tk-fb" key={ref}><span className="tk-fb-n">{i + 1}</span><span className="tk-grow">{modelName(models, ref)}</span>
          <button type="button" className="ib" aria-label="Move up" title="Move up" disabled={!i} onClick={() => move(i)}><Icon name="chev" small /></button>
          <button type="button" className="ib" aria-label="Remove" title="Remove" onClick={() => setMay({ fallbacks: list.filter((x) => x !== ref) })}><Icon name="x" small /></button></div>)
          : <p className="tk-hint">Same as everywhere: the order in Settings › Accounts.</p>}
      </div>
      <div><button type="button" className="btn sm" aria-haspopup="menu" disabled={!left.length} title={left.length ? undefined : "Every model that’s set up is already listed."} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>Add a stand-in…</button></div>
      {menu && <Menu at={menu} label="Add a stand-in" onClose={() => setMenu(null)} items={[{ kind: "head", label: "Add a stand-in" }, ...left.map((m) => ({ label: m.name, run: () => { setMay({ fallbacks: [...list, m.ref] }); setMenu(null); } }))]} />}
    </div>
  );
}

function Advanced({ engine, agentId, name, draft, models, setMay }: { engine: WindowEngine; agentId: string; name: string; draft: Draft; models: ModelChoice[]; setMay: (m: Partial<May>) => void }) {
  const decide = ["same", "none"].includes(draft.may.decide) || models.some((m) => m.ref === draft.may.decide) ? draft.may.decide : "same";
  useEffect(() => {
    if (decide !== draft.may.decide) setMay({ decide });
  }, [decide, draft.may.decide, setMay]);
  return (
    <>
      <Row title="Model for decisions" hint={`Small yes-or-no, pick-one and score calls inside ${name}’s work. None means it makes no such calls; its main model is never used for them.`}>
        <select className="inp" aria-label="Model for decisions" value={decide} onChange={(e) => setMay({ decide: e.target.value })}>
          <option value="same">Same as everywhere</option>
          {models.map((m) => <option key={m.ref} value={m.ref}>{m.name}</option>)}
          <option value="none">None for {name}</option>
        </select>
      </Row>
      <Fallbacks draft={draft} models={models} setMay={setMay} />
      <GitHubChoice engine={engine} agentId={agentId} />
    </>
  );
}

const NOT_OFFERED = "Its own tool list leaves these tools out, so this switch has no effect.";

type Props = { engine: WindowEngine; agentId: string; name: string; draft: Draft; models: ModelChoice[]; level: Level; set: (d: Partial<Draft>) => void; openSettings?: (page: string) => void };
export function MayTab({ engine, agentId, name, draft, models, level, set, openSettings }: Props) {
  const may = draft.may, setMay = (m: Partial<May>) => set({ may: { ...may, ...m } });
  // The browser switch is greyed when the Trunk's own tool list leaves the browser out (tools.catalog).
  const catalog = useResource<{ toolsets?: { id: string; offered?: boolean }[] }>(engine, "tools.catalog", { agentId });
  const browserLock = may.browseLock || (catalog.data?.toolsets?.find(t => t.id === "browser")?.offered === false ? NOT_OFFERED : "");
  return (
    <div className="tk-may">
      <Row title="Read files in Documents and Downloads" hint="Reading never changes a file."><Switch label="Read files in Documents and Downloads" on={may.read} onChange={(read) => setMay({ read })} /></Row>
      <Row title="Use the browser" hint="With your saved sign-ins." off={browserLock || undefined}>
        {browserLock
          ? <button type="button" role="switch" aria-checked={false} aria-label="Use the browser" className="switch" disabled />
          : <Switch label="Use the browser" on={may.browse} onChange={next => setMay({ browse: next })} />}
      </Row>
      <Row title="Spend money" hint="Never, whatever mode Branch is in."><span className="tk-fixed">Never</span></Row>
      <ModelPick draft={draft} models={models} setModel={(model) => set({ model })} openSettings={openSettings} />
      {shows(level, "advanced") && <Advanced engine={engine} agentId={agentId} name={name} draft={draft} models={models} setMay={setMay} />}
    </div>
  );
}
