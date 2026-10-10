// Trunk editor › Permissions and Models (preview 30-trunks mayHTMLC18, 31-trunksp mayMorePC18 at Advanced).
// Each row writes the Trunk's own config entry through the editor draft; rows the engine has no setting for are drawn greyed with the reason.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { ReactNode } from "react";
import { shownWhy } from "../../shell/shown-why";
import type { ModelChoice } from "../../composer/model";
import { Segmented, Switch } from "../../shell/Popover";
import { shows, type Level } from "../../places-nav/level";
import type { Draft } from "./api";
import type { May } from "./may";
import { Fallbacks } from "./Fallbacks";
import { modelName } from "./fallback-list";

export const SEND_WHY = "Needs the engine’s per-Trunk setting for asking before it sends.";
export const NOTES_WHY = "Each Trunk keeps its notes in its own folder; the engine has no setting to share them.";

export function Row({ title, hint, children, off }: { title: string; hint: string; children: ReactNode; off?: string }) {
  return <div className={off ? "tk-ctl off" : "tk-ctl"} title={shownWhy(off)}><b>{title}</b><span className="tk-right">{children}</span><small>{shownWhy(off) || hint}</small></div>;
}

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

type PermissionsProps = { draft: Draft; set: (d: Partial<Draft>) => void };
/** What the Trunk may do on its own: files, the browser, sending, spending and its notes. */
export function PermissionsTab({ draft, set }: PermissionsProps) {
  const may = draft.may, setMay = (m: Partial<May>) => set({ may: { ...may, ...m } });
  return (
    <div className="tk-may">
      <Row title="Read files in Documents and Downloads" hint="Reading never changes a file."><Switch label="Read files in Documents and Downloads" on={may.read} onChange={(read) => setMay({ read })} /></Row>
      <Row title="Use the browser" hint="With your saved sign-ins." off={may.browseLock || undefined}>
        {may.browseLock ? <button type="button" role="switch" aria-checked={false} aria-label="Use the browser" className="switch" disabled /> : <Switch label="Use the browser" on={may.browse} onChange={(browse) => setMay({ browse })} />}
      </Row>
      <Row title="Send email and messages" hint="Overrides the mode for this Trunk only." off={SEND_WHY}>
        <span className="tk-seg">{["Ask first", "Allowed"].map((l) => <button key={l} type="button" disabled>{l}</button>)}</span>
      </Row>
      <Row title="Spend money" hint="Never, whatever mode Branch is in."><span className="tk-fixed">Never</span></Row>
      <Row title="Keep its own notes" hint="Separate from other Trunks’ memory." off={NOTES_WHY}>
        <button type="button" role="switch" aria-checked={true} aria-label="Keep its own notes" className="switch" disabled />
      </Row>
    </div>
  );
}

type ModelsProps = { name: string; draft: Draft; models: ModelChoice[]; level: Level; set: (d: Partial<Draft>) => void; openSettings?: (page: string) => void };
/** Which model this Trunk thinks with, and (at Advanced) the model for decisions and the stand-ins it falls back to. */
export function ModelsTab({ name, draft, models, level, set, openSettings }: ModelsProps) {
  const may = draft.may, setMay = (m: Partial<May>) => set({ may: { ...may, ...m } });
  return (
    <div className="tk-may">
      <ModelPick draft={draft} models={models} setModel={(model) => set({ model })} openSettings={openSettings} />
      {shows(level, "advanced") && <>
        <Row title="Model for decisions" hint={`Small yes-or-no, pick-one and score calls inside ${name}’s work. None means it makes no such calls; its main model is never used for them.`}>
          <select className="inp" aria-label="Model for decisions" value={may.decide} onChange={(e) => setMay({ decide: e.target.value })}>
            <option value="same">Same as everywhere</option>
            {models.map((m) => <option key={m.ref} value={m.ref}>{m.name}</option>)}
            {!["same", "none"].includes(may.decide) && !models.some((m) => m.ref === may.decide) && <option value={may.decide}>{may.decide}</option>}
            <option value="none">None for {name}</option>
          </select>
        </Row>
        <Fallbacks draft={draft} models={models} setMay={setMay} />
      </>}
    </div>
  );
}
