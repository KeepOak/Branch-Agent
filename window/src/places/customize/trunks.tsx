// Customize › Trunks (preview 40-places trunks tab + 30-trunks/31-trunksp): A new Trunk and New group chat, one row
// per Trunk (face and name open its profile; Who it knows; Edit; a ⋯ menu, also on right-click, for Make default and a red
// Remove), the job tiles and,
// at Technical, the defaults for every Trunk. Customize only mounts it; the dialogs live in places/trunk.
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { shownWhy } from "../../shell/shown-why";
import { Jobs } from "./jobs";
import { Icon } from "../../shell/icons";
import { openNewGroupChat } from "../../rooms/NewGroupChat";
import { Menu, type MenuAnchor, type MenuItem } from "../../shell/Menu";
import { notify } from "../../shell/notify";
import { whoItKnowsItems } from "../../shell/who-it-knows-menu";
import { shows } from "../../places-nav/level";
import type { PlaceProps } from "../../places-nav/PlaceFrame";
import type { useResource, Trunks } from "../library/data";
import { Status } from "../library/ui";
import { RequestGeneration } from "../library/data";
import { createTrunk, defaultBlock, makeDefault } from "../trunk/api";
import { NewTrunkPreview, type TrunkChoice } from "../trunk/NewTrunkPreview";
import { canWrite, WRITE_WHY } from "../trunk/data";
import { creationProblem, errorText, readRoster, type Roster, type TrunkRow } from "../trunk/model";
import { RemoveTrunkDialog } from "../trunk/RemoveTrunk";
import { ShareTrunkDialog } from "../trunk/ShareTrunk";
import { TrunkDefaults } from "../trunk/TrunkDefaults";
import { TrunkEditor } from "../trunk/TrunkEditor";
import { RowFace } from "../trunk/TrunkFace";
import { TrunkProfile } from "../trunk/TrunkProfile";
import "../trunk/trunk.css";

/** The preview's row face (40-places Trunks rows). */
const ROW_FACE = 36; // av(t, 36) in renderCustomize
type Open = { kind: "profile" | "edit" | "remove" | "share"; id: string } | null;
type Props = Pick<PlaceProps, "engine" | "level" | "openSettings" | "startConversation"> & {
  openConversation?: PlaceProps["openConversation"];
  trunks: ReturnType<typeof useResource<Trunks>>;
  openPlace?: PlaceProps["openPlace"];
  /** Settings › Trunks (preview.html PG trunksP17): rows with only Edit and •••, Who it knows in the ••• menu with the
   *  preview's other items, and one "Start from a template" row that opens Seedbank instead of the job tiles. */
  settings?: { openTemplates: () => void };
};

/** The ••• items the preview has that nothing stands behind yet (R1-10: one plain line each). */
export const SETTINGS_MENU_COMING = {
  pause: "Pausing a Trunk comes in a later update.",
  watch: "Showing a Trunk how, once, comes in a later update.",
  packages: "Packaging a Trunk comes in a later update.",
  seed: "Copying a Trunk as a seed comes in a later update.",
  download: "Downloading a Trunk’s seed comes in a later update.",
  look: "Copying a Trunk’s look comes in a later update.",
  share: "Sharing a Trunk to Seedbank comes in a later update.",
} as const;


// DA-54: only Who it knows and Edit sit on the row. Remove is destructive, so it lives in the ⋯ menu, drawn red there,
// with the reason beside it when it can't run. Pause has no engine method yet, so the row draws no greyed Pause at all.
function TrunkRowView({ row, roster, open, menu, knows, settings }: { row: TrunkRow; roster: Roster; open: (o: Open) => void; menu: (e: ReactMouseEvent, row: TrunkRow) => void; knows: (e: ReactMouseEvent, row: TrunkRow) => void; settings?: boolean }) {
  return (
    <div className="tk-row" onContextMenu={(e) => menu(e, row)} onKeyDown={(e) => { if ((e.key === "F10" && e.shiftKey) || e.key === "ContextMenu") menu(e as unknown as ReactMouseEvent, row); }}>
      <button type="button" className="tk-row-who" aria-label={`${row.name}: profile`} onClick={() => open({ kind: "profile", id: row.id })}>
        <RowFace row={row} size={ROW_FACE} />
        <span className="tk-grow"><b>{row.name}{row.id === roster.defaultId && <span className="tk-pill">Default</span>}</b><small>{row.theme || "Just made"}</small></span>
      </button>
      {settings ? null : <button type="button" className="btn ghost sm" onClick={(e) => knows(e, row)}>Who it knows</button>}
      <button type="button" className="btn sm" onClick={() => open({ kind: "edit", id: row.id })}>Edit</button>
      <button type="button" className="ib sm tk-row-more" aria-label={`More for ${row.name}`} title="More" aria-haspopup="menu" onClick={(e) => menu(e, row)}><Icon name="more" small /></button>
    </div>
  );
}

export function TrunksTab(props: Props) {
  const { engine, level, trunks, openSettings } = props;
  const roster = trunks.data ? readRoster(trunks.data) : null;
  const [open, setOpen] = useState<Open>(null);
  const [menu, setMenu] = useState<{ at: MenuAnchor; row: TrunkRow } | null>(null);
  const [known, setKnown] = useState<{ at: MenuAnchor; items: MenuItem[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const generation = useRef(new RequestGeneration());
  useEffect(() => {
    const guard = generation.current;
    const current = guard.next();
    pending.current = false;
    queueMicrotask(() => { if (current()) { setBusy(false); setError(null); } });
    return () => { guard.retire(); pending.current = false; };
  }, [engine]);
  const write = canWrite(engine);
  const add = async (choice: TrunkChoice) => {
    if (!roster || pending.current) return;
    pending.current = true;
    const current = generation.current.next();
    setBusy(true); setError(null);
    try {
      const name = choice.name, id = await createTrunk(engine, name, choice.avatar);
      if (!current()) return;
      setAdding(false);
      notify(`${name} is made.`);
      trunks.reload();
      // Its first conversation opens through the shell, which knows the new conversation once its list has it.
      // Without that hand-over the new Trunk's profile opens here, so the person sees what was made.
      if (props.startConversation) props.startConversation(id);
      else setOpen({ kind: "profile", id });
    }
    catch (e) { if (current()) { setError(creationProblem(e)); trunks.reload(); } }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  };
  const showMenu = (e: ReactMouseEvent, row: TrunkRow) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu({ at: e.clientX ? { x: e.clientX, y: e.clientY } : { x: r.left + 40, y: r.top + 30 }, row });
  };
  const knownAt = async (at: MenuAnchor, row: TrunkRow) => {
    if (!roster) return;
    try {
      const items = await whoItKnowsItems((method, params) => engine.request(method, params),
        { id: row.id, name: row.name }, roster.agents.map((agent) => ({ ...agent, isDefault: agent.id === roster.defaultId })));
      setKnown({ at, items });
    } catch (error) { setError(errorText(error)); }
  };
  const showKnown = async (e: ReactMouseEvent, row: TrunkRow) => {
    const r = e.currentTarget.getBoundingClientRect();
    await knownAt({ x: r.right - 340, y: r.bottom + 4 }, row);
  };
  return <div className="tk-tab-root">
    <div className="tk-toolbar">
      <button type="button" className="btn pri" disabled={busy || !roster || !write} title={write ? undefined : WRITE_WHY} onClick={() => setAdding(true)}><Icon name="plus" small />{busy ? "Making…" : "A new Trunk"}</button>
      <button type="button" className="btn" onClick={() => openNewGroupChat()}><Icon name="users" small />New group chat</button>
    </div>
    <Status {...trunks} />
    {error && !adding && <p role="alert" className="tk-error">{error}</p>}
    {roster && <div className="tk-list">{roster.agents.map((row) => <TrunkRowView key={row.id} row={row} roster={roster} open={setOpen} menu={showMenu} knows={(e, trunk) => void showKnown(e, trunk)} settings={Boolean(props.settings)} />)}</div>}
    {adding && roster && <NewTrunkPreview roster={roster} busy={busy} error={error} onClose={() => setAdding(false)} onConfirm={(choice) => void add(choice)} />}
    {props.settings ? (
      <div className="r1s-row" data-row="trunks.templates">
        <b className="g-label">Start from a template</b>
        <small className="g-label" data-lines>Trunk Doctor, Home Desk, Project Lead and 5 more live in Seedbank › Agents, once.</small>
        <div className="r1s-ctl"><button type="button" className="r1s-btn" data-local="" onClick={props.settings.openTemplates}>Templates in Seedbank</button></div>
      </div>
    ) : <Jobs engine={engine} reload={trunks.reload} />}
    {shows(level, "technical") && <TrunkDefaults engine={engine} heading={!props.settings} />}
    {menu && roster && <Menu at={menu.at} label={`${menu.row.name} menu`} onClose={() => setMenu(null)} items={props.settings ? settingsMenu(props, roster, menu.row, setOpen, setError, () => void knownAt(menu.at, menu.row)) : rowMenu(props, roster, menu.row, setOpen, setError)} />}
    {known && <Menu at={known.at} label="Who it knows" testid="who-it-knows" onClose={() => setKnown(null)} items={known.items} />}
    {open?.kind === "profile" && <TrunkProfile engine={engine} agentId={open.id} level={level} openSettings={openSettings} openPlace={props.openPlace} openConversation={props.openConversation} onClose={() => { setOpen(null); trunks.reload(); }} />}
    {open?.kind === "edit" && <TrunkEditor engine={engine} agentId={open.id} level={level} openSettings={openSettings} onClose={() => setOpen(null)} onSaved={trunks.reload} />}
    {open?.kind === "share" && roster && <ShareTrunkDialog engine={engine} agentId={open.id} name={roster.agents.find((a) => a.id === open.id)?.name || open.id} onClose={() => setOpen(null)} />}
    {open?.kind === "remove" && roster && <RemoveTrunkDialog engine={engine} agentId={open.id} name={roster.agents.find((a) => a.id === open.id)?.name || open.id} onClose={() => setOpen(null)} onRemoved={trunks.reload} />}
  </div>;
}

// The ••• items of Settings › Trunks (CUSTOMIZE-PROPOSAL §3, owner approved) that the engine can't run yet: greyed, each
// naming the call it waits for. TODO(engine-lane): agents.pause/resume, trunks.watch and claws.packages.
export const TRUNK_MENU_COMING = {
  pause: "Needs the engine’s pause for a Trunk (agents.pause, agents.resume).",
  watch: "Needs the engine to record a task you show it (trunks.watch).",
  packages: "Needs the engine’s Trunk packages (claws.packages).",
} as const;

function rowMenu(p: Props, roster: Roster, row: TrunkRow, setOpen: (o: Open) => void, setError: (e: string | null) => void): MenuItem[] {
  const block = defaultBlock(roster, row.id), last = roster.agents.length <= 1, write = canWrite(p.engine);
  const toDefault = () => makeDefault(p.engine, roster, row.id).then(() => { notify(`${row.name} is now your default Trunk. Unrouted chats go to it.`); p.trunks.reload(); }, (e: unknown) => setError(errorText(e)));
  const cannotRemove = row.id === roster.defaultId ? "The default Trunk cannot be removed." : last ? "Branch needs at least one Trunk." : write ? undefined : WRITE_WHY;
  return [
    { label: `Pause ${row.name}`, run: () => undefined, disabled: TRUNK_MENU_COMING.pause },
    row.id === roster.defaultId ? { kind: "info", label: `${row.name} is your default Trunk.` } : { label: "Make default", run: () => void toDefault(), disabled: block || (write ? undefined : WRITE_WHY) },
    { label: "Share this Trunk…", run: () => setOpen({ kind: "share", id: row.id }) },
    { label: "Show it how once", run: () => undefined, disabled: TRUNK_MENU_COMING.watch },
    { label: "Package…", run: () => undefined, disabled: TRUNK_MENU_COMING.packages },
    { kind: "sep" },
    // Red (danger) always; when it can't run, the reason is written under it rather than only in a tooltip.
    { label: `Remove ${row.name}…`, danger: true, testid: "trunk-row-remove", run: () => setOpen({ kind: "remove", id: row.id }), disabled: cannotRemove, sub: shownWhy(cannotRemove) },
  ];
}

/** Settings › Trunks' ••• menu, in the preview's order and words: Change picture…, Pause, Make default, Share this
 *  Trunk…, Who it knows, Show it how, once, Package…, Copy seed, Download seed, Copy its look, Share to Seedbank…, Remove
 *  Trunk…. Change picture opens the editor, where its face is changed; the items nothing stands behind yet are greyed. */
function settingsMenu(p: Props, roster: Roster, row: TrunkRow, setOpen: (o: Open) => void, setError: (e: string | null) => void, whoItKnows: () => void): MenuItem[] {
  const block = defaultBlock(roster, row.id), last = roster.agents.length <= 1, write = canWrite(p.engine);
  const toDefault = () => makeDefault(p.engine, roster, row.id).then(() => { notify(`${row.name} is now your default Trunk. Unrouted chats go to it.`); p.trunks.reload(); }, (e: unknown) => setError(errorText(e)));
  const cannotRemove = row.id === roster.defaultId ? "The default Trunk cannot be removed." : last ? "Branch needs at least one Trunk." : write ? undefined : WRITE_WHY;
  const soon = (label: string, why: string): MenuItem => ({ label, run: () => undefined, disabled: why });
  return [
    { label: "Change picture…", run: () => setOpen({ kind: "edit", id: row.id }) },
    soon("Pause", SETTINGS_MENU_COMING.pause),
    row.id === roster.defaultId ? { kind: "info", label: `${row.name} is your default Trunk.` } : { label: "Make default", run: () => void toDefault(), disabled: block || (write ? undefined : WRITE_WHY) },
    { label: "Share this Trunk…", run: () => setOpen({ kind: "share", id: row.id }) },
    { label: "Who it knows", run: whoItKnows },
    soon("Show it how, once", SETTINGS_MENU_COMING.watch),
    soon("Package…", SETTINGS_MENU_COMING.packages),
    soon("Copy seed", SETTINGS_MENU_COMING.seed),
    soon("Download seed", SETTINGS_MENU_COMING.download),
    soon("Copy its look", SETTINGS_MENU_COMING.look),
    soon("Share to Seedbank…", SETTINGS_MENU_COMING.share),
    { kind: "sep" },
    { label: "Remove Trunk…", danger: true, testid: "trunk-row-remove", run: () => setOpen({ kind: "remove", id: row.id }), disabled: cannotRemove, sub: shownWhy(cannotRemove) },
  ];
}
