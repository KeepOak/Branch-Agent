// The R1 details panel: clicking the conversation header pill docks it at the right, and the frame gives it a column so
// the conversation narrows to make room (the preview's .body.pane-on). A big face, the name and its line, the Trunk's own
// actions, then tabs. A Trunk has Details (its routines, each with an on/off switch, and "Ask it in chat to set one up"),
// Library (the files it made) and Computer (its live screen, or Asleep when there is no screen). A group has Details,
// Library and Members; Members has Add a Trunk and a Remove on each member. A grafted agent (an outside agent connected
// as a contact) has only Details, which says that its routines, files and computer stay outside Branch. Every tab re-hosts
// what the window already has: the profile's Automations list (cron.list / cron.update), Library's made files
// (sessions.list + artifacts.list), the Classic computer stage, and the rooms.members.add / rooms.members.remove calls
// the sidebar's group drop makes. A group's Details and Library use the room's lead Trunk. The panel remembers its last
// tab per kind; Escape or × closes it and the frame hands focus back to the pill.
import { useEffect, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { SaplingSession } from "../../connect/session";
import { Coming } from "../../glass/coming";
import { Automations } from "../../places/trunk/TrunkProfile";
import { readAutomations, type Automation } from "../../places/trunk/profile-data";
import { MadeFiles } from "../../places/library/made";
import { useListPeople } from "../../shell/engine-data";
import { useGroupRooms, type GroupMember } from "../../shell/group-drop";
import { Icon } from "../../shell/icons";
import { Menu, type MenuAnchor } from "../../shell/Menu";
import { ComputerStage, type PipTarget, type StageMode } from "../../stage/ComputerStage";
import { listComputers } from "../../stage/computers";
import type { Block } from "../../thread/model";
import "./r1-details.css";
import { plainError } from "../../shell/plain-error";

export type DetailsKind = "trunk" | "group" | "grafted";
export type DetailsTab = "Details" | "Library" | "Computer" | "Members";
export const DETAILS_TABS: Readonly<Record<DetailsKind, readonly DetailsTab[]>> = { trunk: ["Details", "Library", "Computer"], group: ["Details", "Library", "Members"], grafted: ["Details"] };
/** Where the last tab is kept, one key per kind of panel. */
export const detailsTabKey = (kind: DetailsKind) => `branch.r1.details.${kind}`;

export function readDetailsTab(kind: DetailsKind): DetailsTab {
  const tabs = DETAILS_TABS[kind];
  try { const saved = localStorage.getItem(detailsTabKey(kind)) as DetailsTab | null; if (saved && tabs.includes(saved)) return saved; } catch { /* storage off: the first tab */ }
  return tabs[0];
}
function saveDetailsTab(kind: DetailsKind, tab: DetailsTab) {
  try { localStorage.setItem(detailsTabKey(kind), tab); } catch { /* storage off: this opening only */ }
}

// No engine sentence, code, stack or path at Regular (Private #1089); Advanced keeps the exact words.
const errorText = (e: unknown): string => plainError(e);
/** Coming reasons name the preview label: "<label> comes in a later update." */
const ROUTINES_COMING = "Routines comes in a later update.";
/** The Details tab's own line, under the routines list and on its own when there are none yet. */
const ASK_ROUTINE = "Ask it in chat to set one up";
const LIBRARY_COMING = "Made by Trunks comes in a later update.";
const WAKE_COMING = "Wake it comes in a later update.";
const ADD_TRUNK_COMING = "Add a Trunk comes in a later update.";
const REMOVE_COMING = "Remove comes in a later update.";

type Props = {
  session: SaplingSession; engine: WindowEngine; ready: boolean; kind: DetailsKind;
  name: string; face: ReactNode; line?: string;
  /** The Trunk behind the conversation (none for a grafted agent). */
  agentId?: string;
  /** A Branch group chat's room id; a chat-app group has none. */
  roomId?: string | null;
  /** The group's member names as the header reads them, for a group without a room id. */
  memberNames?: readonly string[];
  trunks: readonly { id: string; name: string }[];
  gatewayUrl: string; blocks: Block[]; running: boolean;
  /** The Trunk's own actions (Customize, Profile, the character), kept from the agent popover this panel replaces. */
  actions?: ReactNode;
  onClose: () => void; onOpenStage: (mode: StageMode) => void; onPip: (small: PipTarget) => void; onChooseComputer: () => void;
  openConversation: (key: string) => void;
};

export function R1DetailsPanel(props: Props) {
  const { kind, name, face, line, actions, onClose, session, ready, roomId, agentId } = props;
  const tabs = DETAILS_TABS[kind];
  const [tab, setTab] = useState<DetailsTab>(() => readDetailsTab(kind));
  const shown = tabs.includes(tab) ? tab : tabs[0];
  const choose = (next: DetailsTab) => { setTab(next); saveDetailsTab(kind, next); };
  // A group's routines and files belong to the room's lead Trunk. The rooms list starts empty, so the first paint waits
  // until that read finishes; an empty result stops waiting and the tabs say there is nothing to list.
  const groups = useGroupRooms(session, ready && kind === "group" && Boolean(roomId));
  const [roomsRead, setRoomsRead] = useState(false);
  useEffect(() => {
    if (kind !== "group" || !roomId) return;
    let live = true;
    void session.request("rooms.list", {}).then(() => { if (live) setRoomsRead(true); }, () => { if (live) setRoomsRead(true); });
    return () => { live = false; };
  }, [session, kind, roomId]);
  const room = roomId && Array.isArray(groups.rooms) ? groups.rooms.find((r) => r.roomId === roomId) : undefined;
  const leadId = agentId ?? room?.lead ?? room?.members.find((m) => m.kind === "trunk")?.id;
  const leadPending = kind === "group" && !agentId && Boolean(roomId) && !room && !roomsRead;
  useEffect(() => {
    // Escape closes the panel unless a menu, dialog or popover above it takes Escape first.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"]')) return;
      event.preventDefault(); onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);
  return <aside className="r1-details g-clear" aria-label={`${name || "Conversation"} details`} data-kind={kind} data-tab={shown}>
    <button type="button" className="r1-details-x" data-local="" aria-label="Close details" title="Close" onClick={onClose}><Icon name="x" /></button>
    <div className="r1-details-head r1-agent-details">
      <span className="r1-details-face">{face}</span>
      <strong className="g-label">{name}</strong>{line ? <p className="g-label">{line}</p> : null}
      {actions ? <div className="r1-details-acts">{actions}</div> : null}
    </div>
    <div className="r1-details-tabs" role="tablist" aria-label="Details">
      {tabs.map((t) => <button key={t} type="button" role="tab" data-local="" id={`r1-details-tab-${t}`} aria-selected={shown === t} aria-controls="r1-details-body" onClick={() => choose(t)}>{t}</button>)}
    </div>
    <div className="r1-details-body" id="r1-details-body" role="tabpanel" aria-labelledby={`r1-details-tab-${shown}`}>
      {shown === "Details" ? kind === "grafted" ? <GraftedTab name={name} /> : <RoutinesTab {...props} agentId={leadId} pending={leadPending} /> : shown === "Library" ? <LibraryTab {...props} agentId={leadId} pending={leadPending} /> : shown === "Computer" ? <ComputerTab {...props} /> : <MembersTab {...props} groups={groups} />}
    </div>
  </aside>;
}

/** A grafted agent's Details: it runs outside Branch, so nothing of its own is listed here. */
function GraftedTab({ name }: { name: string }) {
  return <p className="g-label r1-details-empty" data-testid="details-grafted">{name || "This agent"} is a grafted agent. It runs outside Branch, so its routines, files and computer stay with it.</p>;
}

/** Details: its routines, the same list and switch as its profile (cron.list, cron.update). */
function RoutinesTab({ engine, agentId, pending }: Props & { pending?: boolean }) {
  const [state, setState] = useState<{ list: Automation[] | null; error: string | null }>({ list: null, error: null });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!agentId) return;
    let live = true;
    void Promise.resolve(engine.request("cron.list", { agentId, includeDisabled: true })).then(
      (r) => { if (live) setState({ list: readAutomations(r, agentId), error: null }); },
      (e: unknown) => { if (live) setState({ list: null, error: errorText(e) }); });
    return () => { live = false; };
  }, [engine, agentId, revision]);
  if (pending) return <p className="g-label" role="status">Loading…</p>;
  if (!agentId) return <p className="g-label r1-details-empty">{ASK_ROUTINE}</p>;
  return <Coming engine={engine} need={["cron.list", "cron.update"]} reason={ROUTINES_COMING} where="Details · routines">
    <section className="r1-details-routines" aria-label="Its routines">
      {state.error ? <p className="g-label r1-details-bad" role="alert">{state.error}</p>
        : state.list === null ? <p className="g-label" role="status">Loading…</p>
        : <>
          {state.list.length ? <Automations engine={engine} data={{ automations: state.list }} reload={() => setRevision((n) => n + 1)} /> : null}
          <p className="g-label r1-details-empty">{ASK_ROUTINE}</p>
        </>}
    </section>
  </Coming>;
}

/** Library: the files this Trunk made, Library › Made by Trunks narrowed to it. A group uses its lead. */
function LibraryTab({ engine, agentId, name, trunks, openConversation, pending }: Props & { pending?: boolean }) {
  if (pending) return <p className="g-label" role="status">Loading…</p>;
  if (!agentId) return <p className="g-label r1-details-empty">Nothing made yet.</p>;
  const own = trunks.filter((t) => t.id === agentId);
  return <Coming engine={engine} need={["sessions.list", "artifacts.list"]} reason={LIBRARY_COMING} where="Details · Library">
    <section className="r1-details-library" aria-label={`Files ${name} made`}>
      <MadeFiles engine={engine} trunks={own.length ? own : [{ id: agentId, name }]} agentId={agentId} openConversation={openConversation} />
    </section>
  </Coming>;
}

/** Computer: the live screen through the re-hosted Classic stage; with no screen to show, a calm Asleep card. */
function ComputerTab({ engine, name, gatewayUrl, blocks, running, onOpenStage, onPip, onChooseComputer }: Props) {
  const [screen, setScreen] = useState<"looking" | "live" | "asleep">("looking");
  useEffect(() => {
    let live = true;
    void listComputers(engine).then(({ computers }) => { if (live) setScreen(computers.some((c) => c.desktop && c.available) ? "live" : "asleep"); }, () => { if (live) setScreen("asleep"); });
    return () => { live = false; };
  }, [engine]);
  if (screen === "looking") return <p className="g-label" role="status">Looking for its screen…</p>;
  if (screen === "asleep") return <div className="r1-details-asleep" data-testid="details-asleep">
    <span className="r1-details-asleep-ico" aria-hidden="true"><Icon name="monitor" /></span>
    <b className="g-label">Asleep</b>
    <small className="g-label">It wakes by itself when {name || "it"} has work.</small>
    <Coming engine={engine} need="computer.wake" unwired reason={WAKE_COMING} where="Details · Computer · Wake it">
      <button type="button" className="btn sm">Wake it</button>
    </Coming>
  </div>;
  return <div className="r1-details-computer">
    <ComputerStage engine={engine} gatewayUrl={gatewayUrl} name={name} mode="Computer" blocks={blocks} running={running} onMode={onOpenStage} onClose={() => undefined} onChooseComputer={onChooseComputer} onPip={onPip} />
    <button type="button" className="btn ghost sm" data-local="" onClick={() => onOpenStage("Computer")}>Open full size</button>
  </div>;
}

/** Members: everyone in the group, with Add a Trunk and Remove (rooms.members.add / rooms.members.remove). */
function MembersTab({ session, engine, ready, roomId, memberNames, trunks, name, groups }: Props & { groups: ReturnType<typeof useGroupRooms> }) {
  const people = useListPeople(session, ready && Boolean(roomId));
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = roomId && Array.isArray(groups.rooms) ? groups.rooms.find((r) => r.roomId === roomId) : undefined;
  const nameOf = (m: GroupMember) => m.kind === "trunk" ? trunks.find((t) => t.id === m.id)?.name ?? m.id : m.kind === "person" ? people.names.get(m.id) ?? m.id : m.id;
  const run = (method: string, params: Record<string, unknown>) => {
    setBusy(true); setError(null);
    void session.request(method, params).then(() => groups.reload(), (e: unknown) => setError(errorText(e))).finally(() => setBusy(false));
  };
  if (!roomId) return <section className="r1-details-members" aria-label="Members">
    <ul className="r1-details-rows">{(memberNames ?? []).map((n) => <li key={n}><span className="g-label">{n}</span>
      <Coming engine={engine} need="rooms.members.remove" unwired reason={REMOVE_COMING} where="Details · Members · Remove"><button type="button" className="btn ghost sm" aria-label={`Remove ${n}`}>Remove</button></Coming></li>)}</ul>
    <Coming engine={engine} need="rooms.members.add" unwired reason={ADD_TRUNK_COMING} where="Details · Members · Add a Trunk"><button type="button" className="btn sm">Add a Trunk</button></Coming>
  </section>;
  const outside = trunks.filter((t) => !room?.members.some((m) => m.kind === "trunk" && m.id === t.id));
  return <section className="r1-details-members" aria-label="Members">
    {!room ? <p className="g-label" role="status">Loading…</p> : <ul className="r1-details-rows">{room.members.map((m) => <li key={`${m.kind}:${m.id}`}>
      <span className="g-label">{nameOf(m)}{m.role === "lead" ? " · lead" : ""}</span>
      <Coming engine={engine} need="rooms.members.remove" reason={REMOVE_COMING} where="Details · Members · Remove">
        <button type="button" className="btn ghost sm" aria-label={`Remove ${nameOf(m)}`} disabled={busy} onClick={() => run("rooms.members.remove", { roomId, kind: m.kind, id: m.id })}>Remove</button>
      </Coming>
    </li>)}</ul>}
    <Coming engine={engine} need="rooms.members.add" reason={ADD_TRUNK_COMING} where="Details · Members · Add a Trunk">
      <button type="button" className="btn sm" aria-haspopup="menu" disabled={busy || !room} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }); }}>Add a Trunk</button>
    </Coming>
    {menu ? <Menu at={menu} label={`Add a Trunk to ${name}`} onClose={() => setMenu(null)} items={outside.length
      ? [{ kind: "head", label: `Add a Trunk to ${name}` }, ...outside.map((t) => ({ label: t.name, run: () => { setMenu(null); run("rooms.members.add", { roomId, kind: "trunk", id: t.id }); } }))]
      : [{ kind: "head", label: "Every Trunk is in this room already." }]} /> : null}
    {error ? <p className="g-label r1-details-bad" role="alert">{error}</p> : null}
  </section>;
}
