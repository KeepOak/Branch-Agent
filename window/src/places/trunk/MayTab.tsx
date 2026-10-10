// Trunk editor › What it may do (preview 30-trunks mayHTMLC18, 31-trunksp mayMorePC18 at Advanced).
// Each row writes the Trunk's own config entry; rows the engine has no setting for are drawn greyed with the reason.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useState, type ReactNode } from "react";
import { shownWhy } from "../../shell/shown-why";
import type { ModelChoice } from "../../composer/model";
import type { WindowEngine } from "../../connect/engine";
import { GitHubSettings } from "../settings/GitHubSettings";
import { Menu, type MenuAnchor } from "../../shell/Menu";
import { Segmented, Switch } from "../../shell/Popover";
import { Icon } from "../../shell/icons";
import { useResource } from "../settings/hooks";
import { shows, type Level } from "../../places-nav/level";
import type { Draft } from "./api";
import type { May } from "./may";

export const SEND_WHY = "Needs the engine’s per-Trunk setting for asking before it sends.";
export const NOTES_WHY = "Each Trunk keeps its notes in its own folder; the engine has no setting to share them.";

function Row({ title, hint, children, off }: { title: string; hint: string; children: ReactNode; off?: string }) {
  return <div className={off ? "tk-ctl off" : "tk-ctl"} title={shownWhy(off)}><b>{title}</b><span className="tk-right">{children}</span><small>{shownWhy(off) || hint}</small></div>;
}

const modelName = (models: ModelChoice[], ref: string) => models.find((m) => m.ref === ref)?.name || ref.split("/").pop() || ref;

function ModelPick({ draft, models, setModel, openSettings }: { draft: Draft; models: ModelChoice[]; setModel: (ref: string) => void; openSettings?: (page: string) => void }) {
  if (!models.length) return <Row title="Which model" hint="No model is set up yet."><button type="button" className="btn sm" onClick={() => openSettings?.("models")} disabled={!openSettings}>Set up a model</button></Row>;
  const options = models.some((m) => m.ref === draft.model) || !draft.model ? models : [{ ref: draft.model, name: modelName(models, draft.model) } as ModelChoice, ...models];
  const value = draft.model || options[0].ref;
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
  return (
    <>
      <Row title="Model for decisions" hint={`Small yes-or-no, pick-one and score calls inside ${name}’s work. None means it makes no such calls; its main model is never used for them.`}>
        <select className="inp" aria-label="Model for decisions" value={draft.may.decide} onChange={(e) => setMay({ decide: e.target.value })}>
          <option value="same">Same as everywhere</option>
          {models.map((m) => <option key={m.ref} value={m.ref}>{m.name}</option>)}
          {!["same", "none"].includes(draft.may.decide) && !models.some((m) => m.ref === draft.may.decide) && <option value={draft.may.decide}>{draft.may.decide}</option>}
          <option value="none">None for {name}</option>
        </select>
      </Row>
      <Fallbacks draft={draft} models={models} setMay={setMay} />
      <div className="kit-page">
        <p className="tk-hint">GitHub connection changes save immediately for {name}, even if you cancel this editor. Other changes use Save below.</p>
        <GitHubSettings engine={engine} agentId={agentId} />
      </div>
    </>
  );
}

type ToolsetRow = { id: string; label: string; description: string; offered?: boolean };

const NOT_OFFERED = "Its own tool list leaves these tools out, so this switch has no effect.";
/** Until tools.catalog answers, or when it doesn't, the browser switch stays available on its own. */
const BROWSER_ONLY: ToolsetRow[] = [
  { id: "browser", label: "Browser", description: "Open pages, click, type and read them in the built-in browser." },
];

/** One switch per toolset the engine offers (tools.catalog). Each switch shows the state the Trunk's own tool list allows. */
function ToolsSection({ engine, agentId, may, setMay }: { engine: WindowEngine; agentId: string; may: May; setMay: (m: Partial<May>) => void }) {
  const catalog = useResource<{ toolsets?: ToolsetRow[] }>(engine, "tools.catalog", { agentId });
  const toolsets = catalog.data?.toolsets?.length ? catalog.data.toolsets : BROWSER_ONLY;
  const rowFor = (t: ToolsetRow) => {
    const browser = t.id === "browser";
    const lock = (browser ? may.browseLock : "") || (t.offered === false ? NOT_OFFERED : "");
    const label = browser ? "Use the browser" : `Use ${t.label}`;
    const on = browser ? may.browse : may.toolsets[t.id] !== false;
    const onChange = (next: boolean) => (browser ? setMay({ browse: next }) : setMay({ toolsets: { ...may.toolsets, [t.id]: next } }));
    return (
      <Row key={t.id} title={t.label} hint={t.description} off={lock || undefined}>
        {lock
          ? <button type="button" role="switch" aria-checked={false} aria-label={label} className="switch" disabled />
          : <Switch label={label} on={on} onChange={onChange} />}
      </Row>
    );
  };
  return (
    <section className="tk-tools" aria-label="Tools">
      <h4 className="tk-tools-title">Tools</h4>
      <p className="tk-hint">Switch off what this Trunk should never reach. The reply tool, its questions and its status stay on.</p>
      {toolsets.map(rowFor)}
    </section>
  );
}

type Props = { engine: WindowEngine; agentId: string; name: string; draft: Draft; models: ModelChoice[]; level: Level; set: (d: Partial<Draft>) => void; openSettings?: (page: string) => void };
export function MayTab({ engine, agentId, name, draft, models, level, set, openSettings }: Props) {
  const may = draft.may, setMay = (m: Partial<May>) => set({ may: { ...may, ...m } });
  return (
    <div className="tk-may">
      <Row title="Read files in Documents and Downloads" hint="Reading never changes a file."><Switch label="Read files in Documents and Downloads" on={may.read} onChange={(read) => setMay({ read })} /></Row>
      <ToolsSection engine={engine} agentId={agentId} may={may} setMay={setMay} />
      <Row title="Send email and messages" hint="Overrides the mode for this Trunk only." off={SEND_WHY}>
        <span className="tk-seg">{["Ask first", "Allowed"].map((l) => <button key={l} type="button" disabled>{l}</button>)}</span>
      </Row>
      <Row title="Spend money" hint="Never, whatever mode Branch is in."><span className="tk-fixed">Never</span></Row>
      <ModelPick draft={draft} models={models} setModel={(model) => set({ model })} openSettings={openSettings} />
      {shows(level, "advanced") && <Advanced engine={engine} agentId={agentId} name={name} draft={draft} models={models} setMay={setMay} />}
      <Row title="Keep its own notes" hint="Separate from other Trunks’ memory." off={NOTES_WHY}>
        <button type="button" role="switch" aria-checked={true} aria-label="Keep its own notes" className="switch" disabled />
      </Row>
    </div>
  );
}
