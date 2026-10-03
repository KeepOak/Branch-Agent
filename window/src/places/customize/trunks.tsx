// Customize › Trunks (preview 40-places trunks tab + 30-trunks/31-trunksp): A new Trunk and New group chat, one row
// per Trunk (face and name open its profile; Edit; Pause), right-click for Make default / Remove, the job tiles and,
// at Technical, the defaults for every Trunk. Customize only mounts it; the dialogs live in places/trunk.
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { Jobs } from "./jobs";
import { Icon } from "../../shell/icons";
import { openNewGroupChat } from "../../rooms/NewGroupChat";
import { Menu, type MenuAnchor, type MenuItem } from "../../shell/Menu";
import { notify } from "../../shell/notify";
import { shows } from "../../places-nav/level";
import type { PlaceProps } from "../../places-nav/PlaceFrame";
import type { useResource, Trunks } from "../library/data";
import { Status } from "../library/ui";
import { createTrunk, defaultBlock, makeDefault, newTrunkName } from "../trunk/api";
import { canWrite, WRITE_WHY } from "../trunk/data";
import { errorText, readRoster, type Roster, type TrunkRow } from "../trunk/model";
import { RemoveTrunkDialog } from "../trunk/RemoveTrunk";
import { TrunkDefaults } from "../trunk/TrunkDefaults";
import { TrunkEditor } from "../trunk/TrunkEditor";
import { RowFace } from "../trunk/TrunkFace";
import { PAUSE_WHY, TrunkProfile } from "../trunk/TrunkProfile";
import "../trunk/trunk.css";

/** The preview's row face (40-places Trunks rows). */
const ROW_FACE = 36; // av(t, 36) in renderCustomize
type Open = { kind: "profile" | "edit" | "remove"; id: string } | null;
type Props = Pick<PlaceProps, "engine" | "level" | "openConversation" | "openSettings" | "startConversation"> & {
  trunks: ReturnType<typeof useResource<Trunks>>;
  openPlace?: PlaceProps["openPlace"];
};


function TrunkRowView({ row, roster, open, menu }: { row: TrunkRow; roster: Roster; open: (o: Open) => void; menu: (e: ReactMouseEvent, row: TrunkRow) => void }) {
  return (
    <div className="tk-row" onContextMenu={(e) => menu(e, row)} onKeyDown={(e) => { if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") menu(e as unknown as ReactMouseEvent, row); }}>
      <button type="button" className="tk-row-who" aria-label={`${row.name}’s profile`} onClick={() => open({ kind: "profile", id: row.id })}>
        <RowFace row={row} size={ROW_FACE} />
        <span className="tk-grow"><b>{row.name}{row.id === roster.defaultId && <span className="tk-pill">Default</span>}</b><small>{row.theme || "Just made"}</small></span>
      </button>
      <button type="button" className="btn sm" onClick={() => open({ kind: "edit", id: row.id })}>Edit</button>
      <button type="button" className="btn ghost sm" disabled title={PAUSE_WHY}>Pause</button>
    </div>
  );
}

export function TrunksTab(props: Props) {
  const { engine, level, trunks, openSettings } = props;
  const roster = trunks.data ? readRoster(trunks.data) : null;
  const [open, setOpen] = useState<Open>(null);
  const [menu, setMenu] = useState<{ at: MenuAnchor; row: TrunkRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const write = canWrite(engine);
  const add = async () => {
    if (!roster) return;
    setBusy(true); setError(null);
    try {
      const name = newTrunkName(roster), id = await createTrunk(engine, name);
      trunks.reload();
      // Its first conversation opens through the shell, which knows the new conversation once its list has it.
      // Without that hand-over the new Trunk's profile opens here, so the person sees what was made.
      if (props.startConversation) props.startConversation(id);
      else { notify(`${name} is made.`); setOpen({ kind: "profile", id }); }
    }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const showMenu = (e: ReactMouseEvent, row: TrunkRow) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ at: e.clientX ? { x: e.clientX, y: e.clientY } : { x: r.left + 40, y: r.top + 30 }, row });
  };
  return <div className="tk-tab-root">
    <div className="tk-toolbar">
      <button type="button" className="btn pri" disabled={busy || !roster || !write} title={write ? undefined : WRITE_WHY} onClick={() => void add()}><Icon name="plus" small />{busy ? "Making…" : "A new Trunk"}</button>
      <button type="button" className="btn" onClick={openNewGroupChat}><Icon name="users" small />New group chat</button>
    </div>
    <Status {...trunks} />
    {error && <p role="alert" className="tk-error">{error}</p>}
    {roster && <div className="tk-list">{roster.agents.map((row) => <TrunkRowView key={row.id} row={row} roster={roster} open={setOpen} menu={showMenu} />)}</div>}
    <Jobs engine={engine} reload={trunks.reload} />
    {shows(level, "technical") && <TrunkDefaults engine={engine} />}
    {menu && roster && <Menu at={menu.at} label={`${menu.row.name} menu`} onClose={() => setMenu(null)} items={rowMenu(props, roster, menu.row, setOpen, setError)} />}
    {open?.kind === "profile" && <TrunkProfile engine={engine} agentId={open.id} level={level} openSettings={openSettings} openPlace={props.openPlace} onClose={() => { setOpen(null); trunks.reload(); }} />}
    {open?.kind === "edit" && <TrunkEditor engine={engine} agentId={open.id} level={level} openSettings={openSettings} onClose={() => setOpen(null)} onSaved={trunks.reload} />}
    {open?.kind === "remove" && roster && <RemoveTrunkDialog engine={engine} agentId={open.id} name={roster.agents.find((a) => a.id === open.id)?.name || open.id} onClose={() => setOpen(null)} onRemoved={trunks.reload} />}
  </div>;
}

function rowMenu(p: Props, roster: Roster, row: TrunkRow, setOpen: (o: Open) => void, setError: (e: string | null) => void): MenuItem[] {
  const block = defaultBlock(roster, row.id), last = roster.agents.length <= 1, write = canWrite(p.engine);
  const toDefault = () => makeDefault(p.engine, roster, row.id).then(() => { notify(`${row.name} is now your default Trunk. Unrouted chats go to it.`); p.trunks.reload(); }, (e: unknown) => setError(errorText(e)));
  return [
    row.id === roster.defaultId ? { kind: "info", label: `${row.name} is your default Trunk.` } : { label: "Make default", run: () => void toDefault(), disabled: block || (write ? undefined : WRITE_WHY) },
    { kind: "sep" },
    { label: `Remove ${row.name}…`, danger: true, run: () => setOpen({ kind: "remove", id: row.id }), disabled: last ? "Branch needs at least one Trunk." : write ? undefined : WRITE_WHY },
  ];
}
