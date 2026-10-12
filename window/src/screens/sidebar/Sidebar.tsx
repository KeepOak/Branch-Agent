// The R1 sidebar (HANDOFF R1-02, card #807): top capsules and the folder chip, the Pinned grid, Trunks / People /
// Groups / Grafted rows, the Archived and Recently deleted bins, and the bottom row (avatar, Seedbank, update). It reads
// the engine through the Classic hooks (shell/engine-data.ts, group-drop.tsx, Projects.tsx) and acts through
// shell/conversation-actions.ts, so every control is a real call or says Coming.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { Conversation, ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { componentDesktop, stageWindowUpdate } from "../../connect/desktop-component-updates";
import { useBranchVersion, versionParts } from "../../connect/branch-version";
import { Coming } from "../../glass/coming";
import { Menu, type MenuEntry } from "../../glass/Menu";
import { Popover } from "../../glass/Popover";
import type { PlaceId } from "../../places-nav/routes";
import { PairDialog } from "../../places/customize/pairing";
import { createReadyTrunk } from "../../places/trunk/api";
import { RemoveTrunkDialog } from "../../places/trunk/RemoveTrunk";
import { NewGroupChatHost, openNewGroupChat } from "../../rooms/NewGroupChat";
import { ConfirmDelete, askBeforeDelete } from "../../shell/ConfirmDelete";
import { contactRowsFor, markContactRead, pinContact, projectContact, type Contact } from "../../shell/contacts-model";
import { conversationActions } from "../../shell/conversation-actions";
import { Dialog } from "../../shell/Dialog";
import { useContacts, useTrunks } from "../../shell/engine-data";
import { GetAppsDialog } from "../../shell/GetApps";
import { guideMenuItems } from "../../shell/guide-menu";
import { moveContactToProject, roomContact, useGroupRooms } from "../../shell/group-drop";
import { menuIcon } from "../../shell/menu-icons";
import { nextTrunkName } from "../../shell/NewTrunkFlow";
import { notify } from "../../shell/notify";
import { conversationLink, openConversationWindow, ownWindowUnavailable } from "../../shell/own-window";
import { usePersonName } from "../../shell/PersonMenu";
import { useProjects } from "../../shell/Projects";
import { copyMarkdown, copyText } from "../../shell/row-actions";
import { ShortcutsDialog } from "../../shell/ShortcutsDialog";
import { tidy } from "../../shell/StatusLayer";
import { useUpdate } from "../../shell/use-status";
import { readThemeChoice, setThemeChoice, type ThemeChoice } from "../../theme/theme";
import { buildSections, contactRows, personRows, type Folder, type Person, type SideRow } from "./model";
import { FolderChip, icons, PinnedGrid, SectionHead, SideRowView, TopCapsules, type RowHandlers } from "./parts";
import { rowMenu } from "./row-menu";
import "./sidebar.css";

export type SidebarProps = {
  session: SaplingSession;
  ready: boolean;
  list: ConversationList;
  sessions: Conversation[];
  mainKey: string | null;
  /** The open conversation, when a conversation is what the main column shows. */
  currentKey: string | null;
  waiting: ReadonlyMap<string, number>;
  searchRef: RefObject<HTMLInputElement | null>;
  onOpen: (key: string) => void;
  onSettings: (page: string) => void;
  onPlace: (place: PlaceId) => void;
};

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});
const str = (value: unknown) => (typeof value === "string" ? value : "");
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Who else is on this Branch (users.self + users.list), with the role each one has. */
function usePeople(session: SaplingSession, ready: boolean): { selfId: string | null; list: Person[] } {
  const [people, setPeople] = useState<{ selfId: string | null; list: Person[] }>({ selfId: null, list: [] });
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const load = () => Promise.allSettled([session.request("users.self", {}), session.request("users.list", {})]).then(([self, all]) => {
      if (!live) return;
      const profiles = all.status === "fulfilled" && Array.isArray(rec(all.value).profiles) ? (rec(all.value).profiles as unknown[]).map(rec) : [];
      setPeople({
        selfId: self.status === "fulfilled" ? str(rec(rec(self.value).profile).id) || null : null,
        list: profiles.filter(profile => str(profile.id) && !profile.mergedInto).map(profile => ({
          id: str(profile.id), name: str(profile.displayName) || str((profile.emails as unknown[] | undefined)?.[0]) || "Someone",
          ...(str(profile.effectiveRole) || str(profile.role) ? { role: str(profile.effectiveRole) || str(profile.role) } : {}),
        })),
      });
    });
    void load();
    const off = session.onGatewayEvent(event => { if (event === "users.changed") void load(); });
    return () => { live = false; off(); };
  }, [session, ready]);
  return people;
}

function useNarrow() {
  const query = "(max-width: 760px)";
  return useSyncExternalStore(listener => { const media = matchMedia(query); media.addEventListener("change", listener); return () => media.removeEventListener("change", listener); }, () => matchMedia(query).matches);
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  return now;
}

/** The frame owns wide and rail (Ctrl+B); the sidebar asks it through its own toggle. */
const toggleRail = () => document.querySelector<HTMLButtonElement>(".r1-side-top button")?.click();

export function Sidebar(p: SidebarProps) {
  const { session, ready } = p;
  const engine = session.engine;
  const request = useMemo(() => <T,>(method: string, params?: unknown) => session.request<T>(method, params), [session]);
  const [gatewayContacts, refreshContacts, contactsLoaded] = useContacts(session, ready);
  const trunks = useTrunks(session, ready);
  const rooms = useGroupRooms(session, ready);
  const people = usePeople(session, ready);
  const { projects } = useProjects(session, ready);
  const person = usePersonName(session, ready);
  const update = useUpdate(session, ready, useBranchVersion(session.gatewayUrl));
  const actions = useMemo(() => conversationActions(request, p.list, () => p.currentKey), [request, p.list, p.currentKey]);
  const narrow = useNarrow(), now = useNow();
  const [query, setQuery] = useState(""), [folder, setFolder] = useState<Folder>("all"), [foldOpen, setFoldOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [menu, setMenu] = useState<SideRow | null>(null), menuAnchor = useRef<HTMLElement | null>(null);
  const [plusOpen, setPlusOpen] = useState(false), plusRef = useRef<HTMLButtonElement>(null);
  const [personOpen, setPersonOpen] = useState(false), meRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<null | { kind: "rename"; row: SideRow } | { kind: "delete"; row: Conversation } | { kind: "remove"; agentId: string; name: string } | { kind: "shortcuts" | "apps" | "pair" }>(null);
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);
  const [installing, setInstalling] = useState(false);

  const contacts: Contact[] = useMemo(() => {
    const base = contactRowsFor(gatewayContacts, contactsLoaded, trunks.list, p.sessions, p.mainKey, false);
    const withPeers = base.map(contact => contact.kind === "outside" && rooms.peerOnline.has(contact.id.slice(4)) ? { ...contact, offline: rooms.peerOnline.get(contact.id.slice(4)) === false } : contact);
    const groups = rooms.rooms.map(room => roomContact(room, base)).filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
    return projectContact([...withPeers, ...groups], p.sessions);
  }, [gatewayContacts, contactsLoaded, trunks.list, p.sessions, p.mainKey, rooms.rooms, rooms.peerOnline]);
  const rows = useMemo(() => [
    ...contactRows(contacts, p.waiting, contact => {
      const room = rooms.rooms.find(candidate => `room:${candidate.roomId}` === contact.id);
      if (room) return room.members.map(member => ({ name: contacts.find(c => c.id === `${member.kind === "a2a" ? "a2a" : "trunk"}:${member.id}`)?.name ?? member.id, kind: member.kind === "trunk" ? "trunk" as const : "person" as const }));
      return (contact.face?.trunks ?? []).map(trunk => ({ name: trunk.name, kind: "trunk" as const }));
    }),
    ...personRows(people.list, people.selfId),
  ], [contacts, p.waiting, rooms.rooms, people]);
  const sections = buildSections(rows, folder, query);
  const anyWaiting = [...p.waiting.values()].some(count => count > 0);
  const binsOpen = archivedOpen || narrow;

  const openRow = (row: SideRow) => { if (row.key) p.onOpen(row.key); else p.onSettings("people"); };
  const handlers: RowHandlers = { onOpen: openRow, onMenu: (row, anchor) => { menuAnchor.current = anchor; setMenu(row); } };
  const markAllRead = (list: SideRow[]) => {
    const unread = list.filter(row => row.unread && row.contact);
    void Promise.all(unread.map(row => markContactRead(row.contact!, request))).then(
      () => { refreshContacts(); notify("All marked read."); },
      (error: unknown) => notify(`Couldn't mark them read: ${reason(error)}.`, { tone: "bad" }),
    );
  };
  const install = () => {
    if (!componentDesktop(session.gatewayUrl)?.componentUpdates) { p.onSettings("updates"); return; }
    setInstalling(true);
    void stageWindowUpdate(engine).catch((error: unknown) => notify(`Couldn't install the update: ${reason(error)}`, { tone: "bad" })).finally(() => setInstalling(false));
  };
  const newTrunk = async () => {
    try {
      const agentId = await createReadyTrunk(engine, nextTrunkName(trunks.list.map(trunk => trunk.name)));
      const key = await actions.create(agentId);
      if (key) p.onOpen(key);
    } catch (error) { notify(`Couldn't make the Trunk: ${reason(error)}`, { tone: "bad" }); }
  };
  const newConversation = (agentId: string) => void actions.create(agentId).then(key => { if (key) p.onOpen(key); });

  const menuItems = menu ? rowMenu(menu, {
    now, actions, projects, ownWindowOff: ownWindowUnavailable(), open: p.onOpen,
    pin: contact => void pinContact(contact, p.sessions, actions, request, refreshContacts),
    markRead: contact => void markContactRead(contact, request).then(refreshContacts, (error: unknown) => notify(`Couldn't mark it read: ${reason(error)}.`, { tone: "bad" })),
    archiveRoom: contact => void session.request("rooms.archive", { roomId: contact.roomId }).then(() => rooms.reload(), (error: unknown) => notify(`Couldn't archive ${contact.name}: ${reason(error)}`, { tone: "bad" })),
    rename: row => setDialog({ kind: "rename", row }),
    moveToProject: (key, projectId) => void moveContactToProject(session, key, projectId).then(refreshContacts, (error: unknown) => notify(`Couldn't move it: ${reason(error)}`, { tone: "bad" })),
    newConversation,
    copyLink: key => void copyText(conversationLink(key)),
    copyMarkdown: (key, title) => void copyMarkdown(engine, key, title),
    copyText: text => void copyText(text),
    ownWindow: key => void openConversationWindow(key).catch((error: unknown) => notify(`Couldn't open window: ${reason(error)}`, { tone: "bad" })),
    ask: key => { p.onOpen(key); void session.open(key).then(() => session.send("What can you do?")); },
    editTrunk: () => p.onPlace("customize"),
    tidy: row => void tidy({ session, list: p.list }, row, false),
    removeTrunk: (agentId, name) => setDialog({ kind: "remove", agentId, name }),
    confirmDelete: row => (askBeforeDelete() ? setDialog({ kind: "delete", row }) : void actions.remove(row).then(refreshContacts)),
  }) : null;
  const ordered = [...trunks.list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const plusRows: MenuEntry[] = [
    { label: "New conversation", icon: menuIcon("chat"), submenu: ordered.length
      ? ordered.map(trunk => ({ label: `with ${trunk.name}${trunk.isDefault ? " (default)" : ""}`, onSelect: () => newConversation(trunk.id) }))
      : [{ label: "with a Trunk", off: "Make a Trunk first." }] },
    { label: "New Trunk", icon: menuIcon("plus"), hint: "random character", onSelect: () => void newTrunk() },
    { label: "New group", icon: menuIcon("users"), onSelect: () => openNewGroupChat() },
    { label: "Have Branch make a Trunk", icon: menuIcon("spark"), off: "Having Branch make a Trunk comes in a later update." },
    { label: "New automation", icon: menuIcon("clock"), onSelect: () => p.onPlace("automations") },
    { label: narrow ? "Close the list" : "Collapse the list to faces", icon: menuIcon("panel"), hint: "Ctrl B", gap: true, onSelect: toggleRail },
  ];
  const short = update?.latest ? versionParts(update.latest).short : "";
  const busy = installing || Boolean(update?.installing);
  const personRows_: MenuEntry[] = [
    { label: "Keyboard shortcuts", icon: menuIcon("list"), hint: "?", onSelect: () => setDialog({ kind: "shortcuts" }) },
    { label: "Get the apps", icon: menuIcon("monitor"), onSelect: () => setDialog({ kind: "apps" }) },
    { label: "Guide", icon: menuIcon("info"), submenu: guideMenuItems(() => undefined, url => { window.open(url, "_blank", "noopener"); }).map(item => {
      const entry = item as { label: string; hint?: string; run: () => void };
      return entry.label === "Walkthrough" ? { label: entry.label, off: "The walkthrough returns with the new setup." } : { label: entry.label, hint: entry.hint, onSelect: entry.run };
    }) },
    { label: "About Branch", icon: menuIcon("info"), onSelect: () => p.onSettings("updates") },
    { label: "Lock Branch", icon: menuIcon("lock"), gap: true, onSelect: () => p.onSettings("permissions") },
  ];

  const section = (label: string, list: SideRow[], head?: React.ReactNode) => list.length ? <section className="r1sb-sec" data-section={label.toLowerCase()} key={label}>
    <SectionHead label={label}>{head}</SectionHead>
    {list.map(row => <SideRowView key={row.id} row={row} current={row.key !== null && row.key === p.currentKey} now={now} handlers={handlers} />)}
  </section> : null;
  const nothing = !sections.pinned.length && !sections.trunks.length && !sections.people.length && !sections.groups.length && !sections.grafted.length;

  return <div className="r1sb" data-searching={query ? "" : undefined} data-fold-open={foldOpen || undefined}>
    <div className="r1sb-top">
      {query ? null : <FolderChip rows={rows} folder={folder} onFolder={setFolder} open={foldOpen} onOpen={setFoldOpen} />}
      <TopCapsules query={query} onQuery={setQuery} searchRef={p.searchRef} onSettings={() => p.onSettings("general")} onGrove={() => p.onPlace("office")}
        plusRef={plusRef} onPlus={() => setPlusOpen(open => !open)} plusDot={anyWaiting} />
    </div>
    <nav className="r1sb-list" aria-label="Conversations">
      {sections.pinned.length ? <section className="r1sb-sec" data-section="pinned"><SectionHead label="Pinned" /><PinnedGrid rows={sections.pinned} currentKey={p.currentKey} handlers={handlers} /></section> : null}
      {section("Trunks", sections.trunks, sections.trunks.some(row => row.unread) ? <button type="button" className="r1sb-mar" onClick={() => markAllRead(sections.trunks)}>Mark all read</button> : null)}
      {section("People", sections.people, <button type="button" className="r1sb-head-go" aria-label="People settings" title="People" onClick={() => p.onSettings("people")}>{icons.chevron}</button>)}
      {section("Groups", sections.groups)}
      {section("Grafted", sections.grafted)}
      {ready && contactsLoaded && nothing ? <p className="r1sb-empty">{query ? "No matches." : folder !== "all" ? "Nothing in this folder." : "No Trunks yet."}</p> : null}
      {!ready ? <p className="r1sb-empty" role="status">Reconnecting…</p> : null}
      <div className="r1sb-bins">
        <button type="button" className="r1sb-bin" aria-expanded={binsOpen} onClick={() => setArchivedOpen(open => !open)} disabled={narrow}>
          <span className="r1sb-bin-chev">{icons.chevron}</span><span>Archived</span>{sections.archived.length ? <i>{sections.archived.length}</i> : null}
        </button>
        {binsOpen ? sections.archived.length ? sections.archived.map(row => <SideRowView key={row.id} row={row} current={row.key === p.currentKey} now={now} handlers={handlers} />) : <p className="r1sb-bin-none">Nothing here</p> : null}
        <Coming need="sessions.restore" reason="Recently deleted comes in a later update. Deleting is final for now.">
          <button type="button" className="r1sb-bin"><span className="r1sb-bin-chev">{icons.chevron}</span><span>Recently deleted</span></button>
        </Coming>
      </div>
      <div className="r1sb-rail-bins">
        <button type="button" className="r1sb-cap" aria-label={`Archived, ${sections.archived.length}`} title="Archived" onClick={() => { setArchivedOpen(true); toggleRail(); }}>{icons.archive}{sections.archived.length ? <i className="r1sb-badge">{sections.archived.length}</i> : null}</button>
        <Coming need="sessions.restore" reason="Recently deleted comes in a later update. Deleting is final for now."><button type="button" className="r1sb-cap" aria-label="Recently deleted">{icons.trash}</button></Coming>
      </div>
    </nav>
    <div className="r1sb-foot">
      <button type="button" className="r1sb-me" ref={meRef} aria-haspopup="menu" aria-label={`${person} · Who is using Branch, look, lock`} title="Who is using Branch, look, lock" onClick={() => setPersonOpen(open => !open)}>
        <span aria-hidden="true">{person.slice(0, 1).toUpperCase()}</span>
      </button>
      <button type="button" className="r1sb-seed" aria-label="Seedbank: agents, skills, tools, plugins and connections" title="Seedbank: agents, skills, tools, plugins and connections" onClick={() => p.onPlace("customize")}>
        <span className="r1sb-seed-icons" aria-hidden="true"><i>{icons.apps}</i><i>{icons.term}</i><i>{icons.leaf}</i></span><span className="r1sb-seed-t">Seedbank</span>
      </button>
      {update?.latest ? <button type="button" className="r1sb-upd" data-busy={busy || undefined} aria-label={busy ? `Installing ${short}` : `Update to ${short}`} title={update.waiting ?? `Update to ${short}`} disabled={busy} onClick={install}>{icons.cloud}</button> : null}
    </div>

    {menu && menuItems ? <Popover anchor={menuAnchor} label={`${menu.name} menu`} width={300} onClose={() => setMenu(null)}><Menu label={menu.name} tiles={menuItems.tiles} rows={menuItems.rows} onClose={() => setMenu(null)} /></Popover> : null}
    {plusOpen ? <Popover anchor={plusRef} label="New, places and more" width={270} align="end" onClose={() => setPlusOpen(false)}><Menu label="New, places and more" rows={plusRows} onClose={() => setPlusOpen(false)} /></Popover> : null}
    {personOpen ? <Popover anchor={meRef} label="Who is using Branch" width={280} placement="above" onClose={() => setPersonOpen(false)}>
      <div className="r1sb-person">
        {update?.latest ? <div className="r1sb-upd-ban"><span>Update to {short}</span><button type="button" disabled={busy} onClick={() => { setPersonOpen(false); install(); }}>{busy ? "Installing…" : "Install"}</button></div> : null}
        <div className="r1sb-ph">Who is using Branch</div>
        <div className="r1sb-people">
          <span className="r1sb-person-chip" aria-current="true"><i>{person.slice(0, 1).toUpperCase()}</i><span>{person}</span></span>
          <button type="button" className="r1sb-person-chip" onClick={() => { setPersonOpen(false); p.onSettings("people"); }}><i>+</i><span>Add</span></button>
        </div>
        <div className="r1sb-look"><span>Look</span><div className="r1sb-seg" role="radiogroup" aria-label="Look">
          {(["light", "dark", "system"] as const).map(choice => <button key={choice} type="button" role="radio" aria-checked={theme === choice} onClick={() => setTheme(setThemeChoice(choice))}>{choice === "system" ? "Auto" : choice === "light" ? "Light" : "Dark"}</button>)}
        </div></div>
        <Menu label="Who is using Branch" rows={personRows_} onClose={() => setPersonOpen(false)} />
      </div>
    </Popover> : null}

    {dialog?.kind === "rename" ? <RenameDialog row={dialog.row} onClose={() => setDialog(null)} onSave={label => { if (dialog.row.row) void actions.rename(dialog.row.row, label).then(refreshContacts); setDialog(null); }} /> : null}
    {dialog?.kind === "delete" ? <ConfirmDelete row={dialog.row} onCancel={() => setDialog(null)} onDelete={() => { const row = dialog.row; setDialog(null); void actions.remove(row).then(refreshContacts); }} /> : null}
    {dialog?.kind === "remove" ? <RemoveTrunkDialog engine={engine} agentId={dialog.agentId} name={dialog.name} onClose={() => setDialog(null)} /> : null}
    {dialog?.kind === "shortcuts" ? <ShortcutsDialog onClose={() => setDialog(null)} defaultName={trunks.list.find(trunk => trunk.isDefault)?.name} /> : null}
    {dialog?.kind === "apps" ? <GetAppsDialog onClose={() => setDialog(null)} onPair={() => setDialog({ kind: "pair" })} /> : null}
    {dialog?.kind === "pair" ? <PairDialog engine={engine} close={() => setDialog(null)} /> : null}
    <NewGroupChatHost engine={ready ? engine : undefined} onOpen={p.onOpen} />
  </div>;
}

function RenameDialog({ row, onClose, onSave }: { row: SideRow; onClose: () => void; onSave: (label: string) => void }) {
  const [value, setValue] = useState(row.name);
  return <Dialog title={`Rename ${row.name}`} onClose={onClose} testid="rename" footer={<>
    <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
    <button type="button" className="btn" onClick={() => onSave(value)}>Rename</button>
  </>}>
    <input className="inp" aria-label="Name" value={value} autoFocus onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") onSave(value); }} />
  </Dialog>;
}
