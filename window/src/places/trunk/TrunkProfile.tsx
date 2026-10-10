// A Trunk's profile (preview 30-trunks profileHTMLC18 + 31-trunksp): a wide dialog with the 84 px face, the counts the
// engine can give, one row per thing to change (each opens the editor where it changes), its automations, then
// Pause / Make default / Edit. It loads its own data, so any place (the thread header too) can open it by id.
import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import { notify } from "../../shell/notify";
import { Switch } from "../../shell/Popover";
import { shows, type Level } from "../../places-nav/level";
import type { PlaceId } from "../../places-nav/routes";
import { defaultBlock, makeDefault } from "./api";
import { canWrite, useLoad, WRITE_WHY } from "./data";
import { readMay } from "./may";
import { errorText, lookOf, type TrunkRow } from "./model";
import { loadProfile, skillsLine, type ProfileData } from "./profile-data";
import { TrunkEditor, type EditorTab } from "./TrunkEditor";
import { RemoveTrunkDialog } from "./RemoveTrunk";
import { TrunkFace } from "./TrunkFace";
import { LineIcon } from "./TrunkFace";
import { TrunkFiles } from "./TrunkFiles";
import { Layer } from "./layer";
import "./trunk.css";


// Shared with Customize › Trunks, which still shows its own greyed Pause until that place removes it.
export const PAUSE_WHY = "Needs the engine’s pause for a Trunk.";

export type TrunkProfileProps = {
  engine: WindowEngine;
  agentId: string;
  level: Level;
  onClose: () => void;
  openSettings?: (page: string) => void;
  openPlace?: (place: PlaceId) => void;
};

function Row({ icon, label, value, mono, onClick }: { icon: ReactNode; label: string; value: string; mono?: boolean; onClick?: () => void }) {
  return (
    <button type="button" className="tk-prow" onClick={onClick} disabled={!onClick}>
      <span className="tk-ico">{icon}</span><span className="tk-grow"><b>{label}</b></span>
      <span className={mono ? "tk-pf-val mono" : "tk-pf-val"}>{value}</span><span className="chev"><Icon name="chev" small /></span>
    </button>
  );
}

function Head({ row, data, isDefault, level }: { row: TrunkRow; data: ProfileData; isDefault: boolean; level: Level }) {
  const maker = row.createdVia === "agent" ? data.roster.agents.find((a) => a.id === row.creatorAgentId) : undefined;
  const copy = () => navigator.clipboard?.writeText(row.id).then(() => notify(`Copied ${row.name}’s ID.`), (e: unknown) => notify(`Couldn’t copy: ${errorText(e)}`, { tone: "bad" }));
  return <>
    <div className="tk-pf-head">
      <div className="tk-pf-face"><TrunkFace name={row.name} look={lookOf(row.avatar, row.name)} emoji={row.emoji} size={84} /></div>
      <div className="tk-pf-who">
        <b>{row.name}{isDefault && <span className="tk-pill">Default</span>}</b>
        {row.theme && <span>{row.theme}</span>}
        {data.working !== null && <small className="tk-pf-attn"><i />{data.working ? `Working · ${data.working}` : "Working"}</small>}
        {maker && <small>Made by {maker.name}</small>}
      </div>
    </div>
    {shows(level, "technical") && <p className="tk-pf-id"><span>ID {row.id}</span><button type="button" className="ib" aria-label="Copy ID" title="Copy ID" onClick={() => void copy()}><Icon name="copy" small /></button></p>}
    <div className="tk-pf-stats">
      {data.week !== null && <span><b>{data.week}</b>conversations this week</span>}
      {data.facts !== null && <span><b>{data.facts}</b>{data.facts === 1 ? "thing it remembers" : "things it remembers"}</span>}
      {data.automations !== null && <span><b>{data.automations.length}</b>automations</span>}
    </div>
  </>;
}

function Automations({ engine, data, reload }: { engine: WindowEngine; data: ProfileData; reload: () => void }) {
  const [error, setError] = useState<string | null>(null);
  if (!data.automations?.length) return null;
  const toggle = (id: string, enabled: boolean) => engine.request("cron.update", { id, patch: { enabled } }).then(reload, (e: unknown) => setError(errorText(e)));
  return <section className="tk-sec tk-sec-tight">
    <h3 className="tk-h">Automations</h3>
    <div className="tk-rows">{data.automations.map((a) => <div className="tk-prow" key={a.id}><span className="tk-ico"><Icon name="clock" small /></span><span className="tk-grow"><b>{a.name}</b><small>{a.when}</small></span>{canWrite(engine) ? <Switch label={`${a.name} on or off`} on={a.enabled} onChange={(on) => void toggle(a.id, on)} /> : <button type="button" role="switch" aria-checked={a.enabled} aria-label={`${a.name} on or off`} className="switch" disabled title={WRITE_WHY} />}</div>)}</div>
    {error && <p className="tk-error" role="alert">{error}</p>}
  </section>;
}

function Rows({ row, data, level, edit, openPlace, showFiles }: { row: TrunkRow; data: ProfileData; level: Level; edit: (t: EditorTab) => void; openPlace?: (p: PlaceId) => void; showFiles: () => void }) {
  const may = readMay(data.snap, row.id);
  const where = may.startOn === "this" ? "This computer" : data.computers.find((c) => c.id === may.startOn)?.name || may.startOn;
  const model = data.models.find((m) => m.ref === row.model)?.name || row.model.split("/").pop() || "Default model";
  const mayLine = [may.read ? "Reads your files" : "Only its own folder", may.browse ? "uses the browser" : "no browser"].join(" · ");
  return (
    <div className="tk-rows">
      <Row icon={<Icon name="monitor" small />} label="Its computer" value={where} onClick={() => edit("computers")} />
      <Row icon={<LineIcon name="spark" />} label="Model" value={model} onClick={() => edit("models")} />
      <Row icon={<LineIcon name="shield" />} label="May do" value={mayLine} onClick={() => edit("permissions")} />
      <Row icon={<LineIcon name="plug" />} label="Its tools" value="Customize › Tools" onClick={openPlace && (() => openPlace("customize"))} />
      <Row icon={<Icon name="book" small />} label="What it remembers" value={data.facts === null ? "Library › Memory" : data.facts === 1 ? "1 fact" : `${data.facts} facts`} onClick={openPlace && (() => openPlace("library"))} />
      {shows(level, "advanced") && <Row icon={<LineIcon name="spark" />} label="Skills it may use" value={skillsLine(data, row.id)} onClick={openPlace && (() => openPlace("customize"))} />}
      {shows(level, "technical") && <Row icon={<Icon name="folder" small />} label="Its folder" value={row.workspace || "Not reported"} mono onClick={showFiles} />}
      {shows(level, "technical") && <Row icon={<LineIcon name="bot" />} label="Runs on" value={!row.runtime || row.runtime === "branch" || row.runtime === "embedded" ? "Branch" : row.runtime} onClick={() => edit("models")} />}
    </div>
  );
}

export function TrunkProfile(props: TrunkProfileProps) {
  const { engine, agentId, level, onClose } = props;
  const data = useLoad(() => loadProfile(engine, agentId), agentId);
  const [editing, setEditing] = useState<EditorTab | null>(null);
  const [removing, setRemoving] = useState(false);
  const [files, setFiles] = useState(false);
  const row = data.data?.roster.agents.find((a) => a.id === agentId);
  if (editing) return <TrunkEditor engine={engine} agentId={agentId} level={level} tab={editing} openSettings={props.openSettings} onClose={() => setEditing(null)} onSaved={data.reload} />;
  if (removing && row) return <RemoveTrunkDialog engine={engine} agentId={agentId} name={row.name} onClose={() => setRemoving(false)} onRemoved={onClose} />;
  if (!data.data || !row) {
    const line = data.error || (data.loading ? "Reading this Trunk…" : "This Trunk is no longer in the engine’s list.");
    return <Layer><Dialog title="Trunk" wide onClose={onClose} testid="trunk-profile"><p className={data.error ? "tk-error" : "tk-hint"} role={data.error ? "alert" : "status"}>{line}</p></Dialog></Layer>;
  }
  return <ProfileBody {...props} data={data.data} row={row} reload={data.reload} edit={setEditing} remove={() => setRemoving(true)} files={files} setFiles={setFiles} />;
}

type BodyProps = TrunkProfileProps & { data: ProfileData; row: TrunkRow; reload: () => void; edit: (t: EditorTab) => void; remove: () => void; files: boolean; setFiles: (v: boolean) => void };
function ProfileBody({ engine, level, onClose, openPlace, data, row, reload, edit, remove, files, setFiles }: BodyProps) {
  const [error, setError] = useState<string | null>(null);
  const isDefault = data.roster.defaultId === row.id;
  const block = defaultBlock(data.roster, row.id), write = canWrite(engine);
  const toDefault = () => makeDefault(engine, data.roster, row.id).then(() => { notify(`${row.name} is now your default Trunk. Unrouted chats go to it.`); reload(); }, (e: unknown) => setError(errorText(e)));
  const footer = <>
    {!isDefault && <button type="button" className="btn ghost" disabled={!!block || !write} title={block || (write ? undefined : WRITE_WHY)} onClick={() => void toDefault()}>Make default</button>}
    {!isDefault && <button type="button" className="btn ghost" disabled={!write} title={write ? undefined : WRITE_WHY} onClick={remove}>Remove {row.name}…</button>}
    <button type="button" className="btn pri" onClick={() => edit("look")}>Edit {row.name}</button>
  </>;
  return (
    <Layer><Dialog title={row.name} wide onClose={onClose} footer={footer} testid="trunk-profile">
      <div className="tk-pf">
        <Head row={row} data={data} isDefault={isDefault} level={level} />
        <Rows row={row} data={data} level={level} edit={edit} openPlace={openPlace && ((p) => { onClose(); openPlace(p); })} showFiles={() => setFiles(!files)} />
        {files && shows(level, "technical") && <TrunkFiles engine={engine} agentId={row.id} />}
        <Automations engine={engine} data={data} reload={reload} />
        {data.notes.map((n) => <p key={n} className="tk-hint" role="status">{n}</p>)}
        {error && <p className="tk-error" role="alert">{error}</p>}
      </div>
    </Dialog></Layer>
  );
}
