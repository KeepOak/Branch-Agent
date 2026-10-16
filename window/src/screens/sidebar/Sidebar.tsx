// The R1 sidebar (HANDOFF R1-02, card #807): top capsules and the folder chip, the Pinned grid, Trunks / People /
// Groups / Grafted rows, the Archived and Recently deleted bins, and the bottom row (avatar, Seedbank, update). It reads
// the engine through the Classic hooks (shell/engine-data.ts, group-drop.tsx, Projects.tsx) and acts through
// shell/conversation-actions.ts, so every control is a real call or says Coming.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Conversation, ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { useBranchVersion, versionParts } from "../../connect/branch-version";
import { Coming } from "../../glass/coming";
import { Menu, type MenuEntry } from "../../glass/Menu";
import { Popover } from "../../glass/Popover";
import type { PlaceId } from "../../places-nav/routes";
import { readLevel } from "../../places-nav/SettingsFrame";
import { PairDialog } from "../../places/customize/pairing";
import { TrunkStudio } from "../../places/trunk/TrunkStudio";
import { RemoveTrunkDialog } from "../../places/trunk/RemoveTrunk";
import { NewGroupChatHost, openNewGroupChat } from "../../rooms/NewGroupChat";
import { ConfirmDelete, askBeforeDelete } from "../../shell/ConfirmDelete";
import { contactRowsFor, markContactRead, pinContact, projectContact, type Contact } from "../../shell/contacts-model";
import { displayTrunkTitle } from "../../connect/trunk-name";
import { conversationActions } from "../../shell/conversation-actions";
import { Dialog } from "../../shell/Dialog";
import { useContacts, useTrunks } from "../../shell/engine-data";
import { GetAppsDialog } from "../../shell/GetApps";
import { guideMenuItems } from "../../shell/guide-menu";
import { clearFilters, filtersDiffer, type ListPrefs } from "../../shell/list-model";
import { moveContactToProject, roomContact, useGroupRooms } from "../../shell/group-drop";
import { menuIcon } from "../../shell/menu-icons";
import { notify } from "../../shell/notify";
import { conversationLink, openConversationWindow, ownWindowUnavailable } from "../../shell/own-window";
import { usePersonName } from "../../shell/PersonMenu";
import { useProjects } from "../../shell/Projects";
import { copyMarkdown, copyText } from "../../shell/row-actions";
import { SearchResultsView, useSearch } from "../../shell/Search";
import { ShortcutsDialog } from "../../shell/ShortcutsDialog";
import { useSelection } from "../../shell/sidebar-state";
import { KeepLastDialog, tidy } from "../../shell/StatusLayer";
import { usePinOrder } from "../../shell/use-pin-order";
import { batchEntries } from "./batch";
import { useUpdate } from "../../shell/use-status";
import { readThemeChoice, setThemeChoice, type ThemeChoice } from "../../theme/theme";
import { FIND_EVENT } from "../../thread/FindBar";
import { filterFacts, filterSideRows, R1FilterSort, readR1Prefs, saveR1Prefs, sortSections } from "./filter";
import { buildSections, contactRows, personRows, type Folder, type Person, type SideRow } from "./model";
import { FolderChip, icons, PinnedGrid, SectionHead, SideRowView, TopCapsules, type RowHandlers } from "./parts";
import { orderPins, pinKey } from "./pin-order";
import { FIRST_MESSAGE, NEED, rowMenu } from "./row-menu";
import { Face } from "../../face/Face";
import { QUICK_ASK_EVENT, QUICK_ASK_NEED } from "../quickask/QuickAskHost";
import "./sidebar.css";

export type SidebarProps = {
  /** + › New Trunk: the sheet for a name and a face, then the chat questions (R1Window). */
  onNewTrunk: () => void;
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
  /** Guide › Take the full tour (ONBOARDING-PROPOSAL): the window runs the walkthrough. Without it the row stays greyed. */
  onTour?: () => void;
  /** Why the conversation list couldn't load (useConversations().error); shown at the top of the list. */
  error?: string | null;
  /** The contacts the window already reads (useContacts); without them the sidebar reads its own. */
  contacts?: ReturnType<typeof useContacts>;
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
  const ownContacts = useContacts(session, ready && !p.contacts);
  const [gatewayContacts, refreshContacts, contactsLoaded] = p.contacts ?? ownContacts;
  const trunks = useTrunks(session, ready);
  // Archived groups too: they sit in the Archived bin, where Unarchive brings them back.
  const rooms = useGroupRooms(session, ready, true);
  const people = usePeople(session, ready);
  const { projects } = useProjects(session, ready);
  const pinOrder = usePinOrder(session, ready);
  const person = usePersonName(session, ready);
  const update = useUpdate(session, ready, useBranchVersion(session.gatewayUrl));
  const actions = useMemo(() => conversationActions(request, p.list, () => p.currentKey), [request, p.list, p.currentKey]);
  const narrow = useNarrow(), now = useNow();
  const trunkName = useCallback((id: string | undefined) => trunks.list.find(trunk => trunk.id === id)?.name ?? id ?? "", [trunks.list]);
  // The search capsule re-hosts the Classic search (shell/Search.tsx): sessions.search for words inside messages,
  // memory.search for files and memory, and the conversation list for chats and past sessions.
  const search = useSearch(request, p.sessions, trunkName);
  const query = search.query, setQuery = search.setQuery;
  const [folder, setFolder] = useState<Folder>("all"), [foldOpen, setFoldOpen] = useState(false);
  const [archivedOpen, setArchivedOpen] = useState(false);
  // Deleting is final, so nothing is kept to list here yet; the bin still opens to say so.
  const [deletedOpen, setDeletedOpen] = useState(false);
  // Filter and sort (Classic shell/FilterSort.tsx): the choices narrow and order the rows; the search looks past them.
  const [prefs, setPrefs] = useState<ListPrefs>(readR1Prefs);
  const changePrefs = (next: ListPrefs) => { setPrefs(next); saveR1Prefs(next); };
  const [menu, setMenu] = useState<SideRow | null>(null), menuAnchor = useRef<HTMLElement | null>(null);
  const [plusOpen, setPlusOpen] = useState(false), plusRef = useRef<HTMLButtonElement>(null);
  const [personOpen, setPersonOpen] = useState(false), meRef = useRef<HTMLButtonElement>(null);
  const [dialog, setDialog] = useState<null | { kind: "rename"; row: SideRow } | { kind: "group"; key: string; name: string } | { kind: "studio" } | { kind: "delete"; row: Conversation } | { kind: "deleteMany"; rows: Conversation[] } | { kind: "keep"; row: Conversation } | { kind: "remove"; agentId: string; name: string } | { kind: "replace"; row: SideRow } | { kind: "shortcuts" | "apps" | "pair" }>(null);
  const [batchOpen, setBatchOpen] = useState(false), batchAnchor = useRef<HTMLElement | null>(null);
  const [theme, setTheme] = useState<ThemeChoice>(readThemeChoice);

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
  const listPeople = useMemo(() => ({ selfId: people.selfId, names: new Map(people.list.map(person => [person.id, person.name])) }), [people]);
  const sections = sortSections(buildSections(query.trim() ? rows : filterSideRows(rows, prefs, now, listPeople), folder, query), prefs.sortBy, listPeople);
  const filtered = filtersDiffer(prefs);
  const anyWaiting = [...p.waiting.values()].some(count => count > 0);
  const binsOpen = archivedOpen || narrow || prefs.status === "archived";

  const openRow = (row: SideRow) => { if (row.key) p.onOpen(row.key); else p.onSettings("people"); };
  // Select several (Classic shell/sidebar-state.ts): Alt+Click picks a row, Shift+Click extends, a plain click or Escape
  // clears. The rows go in the order they show; the Trunks' own conversations can't be picked, as in Classic.
  const shownRows = [...sections.pinned, ...sections.trunks, ...sections.people, ...sections.groups, ...sections.grafted, ...(binsOpen ? sections.archived : [])];
  const shownThreads = () => shownRows.map(row => row.row).filter((row): row is Conversation => Boolean(row));
  const selection = useSelection(shownThreads);
  const pickedRows = () => shownThreads().filter(row => selection.picked.has(row.key));
  const handlers: RowHandlers = {
    onOpen: (row, event) => {
      if (event && (event.altKey || event.shiftKey) && row.row) { selection.select(row.row, event); return; }
      selection.clear(); openRow(row);
    },
    onMenu: (row, anchor) => {
      if (selection.picked.size > 1 && row.key && selection.picked.has(row.key)) { batchAnchor.current = anchor; setBatchOpen(true); return; }
      menuAnchor.current = anchor; setMenu(row);
    },
  };
  const batch = batchOpen ? batchEntries(pickedRows(), actions, rows => (askBeforeDelete() ? setDialog({ kind: "deleteMany", rows }) : void actions.removeMany(rows).then(selection.clear)), selection.clear) : null;
  const markAllRead = (list: SideRow[]) => {
    const unread = list.filter(row => row.unread && row.contact);
    void Promise.all(unread.map(row => markContactRead(row.contact!, request))).then(
      () => { refreshContacts(); notify("All marked read."); },
      (error: unknown) => notify(`Couldn't mark them read: ${reason(error)}.`, { tone: "bad" }),
    );
  };
  const newTrunk = () => p.onNewTrunk();
  const newConversation = (agentId: string) => void actions.create(agentId).then(key => { if (key) p.onOpen(key); });
  // Replace with a different Trunk (a pinned face's menu): pin the picked Trunk, give it this pin's place in the saved
  // order, then unpin this one, through the same calls Pin and Unpin make.
  const swapPin = async (old: SideRow, next: Contact) => {
    if (!old.contact) return;
    const nextKey = next.threadKey;
    await pinContact(next, p.sessions, actions, request, () => undefined);
    if (pinOrder.canSave) {
      const visible = orderPins(sections.pinned, pinOrder.order).filter(row => !row.isDefault).map(pinKey);
      await pinOrder.move({ source: nextKey, target: pinKey(old), zone: "before" }, [...visible.filter(key => key !== nextKey), nextKey]);
    }
    await pinContact(old.contact, p.sessions, actions, request, refreshContacts);
  };

  const menuItems = menu ? rowMenu(menu, {
    now, actions, projects, ownWindowOff: ownWindowUnavailable(), open: p.onOpen,
    pin: contact => void pinContact(contact, p.sessions, actions, request, refreshContacts),
    markRead: contact => void markContactRead(contact, request).then(refreshContacts, (error: unknown) => notify(`Couldn't mark it read: ${reason(error)}.`, { tone: "bad" })),
    archiveRoom: contact => void session.request("rooms.archive", { roomId: contact.roomId }).then(() => rooms.reload(), (error: unknown) => notify(`Couldn't archive ${contact.name}: ${reason(error)}`, { tone: "bad" })),
    unarchiveRoom: contact => void session.request("rooms.archive", { roomId: contact.roomId, archived: false }).then(() => rooms.reload(), (error: unknown) => notify(`Couldn't unarchive ${contact.name}: ${reason(error)}`, { tone: "bad" })),
    rename: row => setDialog({ kind: "rename", row }),
    moveToGroup: (key, name) => setDialog({ kind: "group", key, name }),
    moveToProject: (key, projectId) => void moveContactToProject(session, key, projectId).then(refreshContacts, (error: unknown) => notify(`Couldn't move it: ${reason(error)}`, { tone: "bad" })),
    newConversation,
    copyLink: key => void copyText(conversationLink(key)),
    copyMarkdown: (key, title) => void copyMarkdown(engine, key, title),
    copyText: text => void copyText(text),
    ownWindow: key => void openConversationWindow(key).catch((error: unknown) => notify(`Couldn't open window: ${reason(error)}`, { tone: "bad" })),
    ask: key => { p.onOpen(key); void session.open(key).then(() => session.send("What can you do?")); },
    editTrunk: (agentId: string) => { p.onPlace("people"); window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail: { agentId, view: "edit" } })); },
    tidy: row => void tidy({ session, list: p.list }, row, false),
    advanced: readLevel() !== "regular",
    keepLast: row => setDialog({ kind: "keep", row }),
    removeTrunk: (agentId, name) => setDialog({ kind: "remove", agentId, name }),
    confirmDelete: row => (askBeforeDelete() ? setDialog({ kind: "delete", row }) : void actions.remove(row).then(refreshContacts)),
    replacePin: row => setDialog({ kind: "replace", row }),
  }) : null;
  const ordered = [...trunks.list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  const plusRows: MenuEntry[] = [
    { label: "New conversation", icon: menuIcon("chat"), submenu: ordered.length
      ? ordered.map(trunk => ({ label: `with ${trunk.name}${trunk.isDefault ? " (default)" : ""}`, need: NEED.create, onSelect: () => newConversation(trunk.id) }))
      : [{ label: "with a Trunk", off: "Make a Trunk first." }] },
    { label: "New Trunk", icon: menuIcon("plus"), hint: "name and face", need: ["agents.create", NEED.create], onSelect: () => void newTrunk() },
    { label: "New group", icon: menuIcon("users"), need: "rooms.create", onSelect: () => openNewGroupChat() },
    // Branch's own assistant proposes the Trunk (branch.chat, "new-agent") and makes it only once you say yes.
    { label: "Have Branch make a Trunk", icon: menuIcon("spark"), need: "branch.chat", onSelect: () => setDialog({ kind: "studio" }) },
    { label: "New automation", icon: menuIcon("clock"), local: true, onSelect: () => p.onPlace("automations") },
    // Quick ask (the preview's + menu row): the R1 window's QuickAskHost opens the box.
    { label: "Quick ask", icon: menuIcon("spark"), hint: "Ctrl Shift Space", need: [...QUICK_ASK_NEED], onSelect: () => window.dispatchEvent(new CustomEvent(QUICK_ASK_EVENT)) },
    { label: narrow ? "Close the list" : "Collapse the list to faces", icon: menuIcon("panel"), hint: "Ctrl B", gap: true, local: true, onSelect: toggleRail },
  ];
  const short = update?.latest ? versionParts(update.latest).short : "";
  const busy = Boolean(update?.installing);
  const personRows_: MenuEntry[] = [
    { label: "Keyboard shortcuts", icon: menuIcon("list"), hint: "?", local: true, onSelect: () => setDialog({ kind: "shortcuts" }) },
    { label: "Get the apps", icon: menuIcon("monitor"), local: true, onSelect: () => setDialog({ kind: "apps" }) },
    { label: "Guide", icon: menuIcon("info"), submenu: guideMenuItems(() => undefined, url => { window.open(url, "_blank", "noopener"); }).map(item => {
      const entry = item as { label: string; hint?: string; run: () => void };
      // The walkthrough is the window's own tour (HANDOFF R1-07, no engine call): local, Guide › Take the full tour.
      if (entry.label === "Walkthrough") return p.onTour ? { label: "Take the full tour", local: true, onSelect: p.onTour } : { label: entry.label, local: true, off: "The walkthrough returns with the new setup." };
      return { label: entry.label, hint: entry.hint, local: true, onSelect: entry.run };
    }) },
    { label: "About Branch", icon: menuIcon("info"), local: true, onSelect: () => p.onSettings("updates") },
    { label: "Lock Branch", icon: menuIcon("lock"), gap: true, local: true, onSelect: () => p.onSettings("permissions") },
  ];

  const section = (label: string, list: SideRow[], head?: React.ReactNode) => list.length ? <section className="r1sb-sec" data-section={label.toLowerCase()} key={label}>
    <SectionHead label={label}>{head}</SectionHead>
    {list.map(row => <SideRowView key={row.id} row={row} current={row.key !== null && row.key === p.currentKey} now={now} handlers={handlers} picked={row.key !== null && selection.picked.has(row.key)} />)}
  </section> : null;
  const searching = Boolean(query.trim());
  // While searching, the sidebar's own matches lead Chats and Trunks; the Classic matches add only what they don't cover.
  const leadRows = [...sections.pinned, ...sections.trunks, ...sections.people, ...sections.groups, ...sections.grafted, ...sections.archived];
  const leadKeys = new Set(leadRows.map(row => row.key).filter(Boolean));
  const rowName = (key: string) => {
    const session = p.sessions.find(row => row.key === key);
    return (session?.isMain && session.agentId ? displayTrunkTitle(session.title, session.agentId) : session?.title) || rows.find(row => row.key === key)?.name || "Conversation";
  };
  const leaveSearch = () => setQuery("");
  // Opening any result leaves the search, as the Classic results do; the row ••• menu stays as it is.
  const leadHandlers: RowHandlers = { ...handlers, onOpen: row => { leaveSearch(); openRow(row); } };
  // Opening a message hit lands in its conversation and asks find in this conversation for the words.
  const results = searching ? <SearchResultsView query={query} chip={search.chip} now={now} trunkName={trunkName} rowName={rowName} onChip={search.setChip}
    results={{ ...search.results, chats: search.results.chats.filter(row => !leadKeys.has(row.key)), past: search.results.past.filter(row => !leadKeys.has(row.key)) }}
    lead={{ count: leadRows.length, rows: leadRows.map(row => <SideRowView key={row.id} row={row} current={row.key !== null && row.key === p.currentKey} now={now} handlers={leadHandlers} />) }}
    onOpen={key => { leaveSearch(); p.onOpen(key); }}
    onOpenMessage={(key, words) => { leaveSearch(); p.onOpen(key); setTimeout(() => window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: { query: words } })), 0); }}
    onLibrary={() => { leaveSearch(); p.onPlace("library"); }} /> : null;
  const nothing = !sections.pinned.length && !sections.trunks.length && !sections.people.length && !sections.groups.length && !sections.grafted.length;

  return <div className="r1sb" data-searching={query ? "" : undefined} data-fold-open={foldOpen || undefined}>
    <div className="r1sb-top">
      {query ? null : <FolderChip rows={rows} folder={folder} onFolder={setFolder} open={foldOpen} onOpen={setFoldOpen} />}
      <TopCapsules query={query} onQuery={setQuery} searchRef={p.searchRef} onSettings={() => p.onSettings("general")} onGrove={() => p.onPlace("office")}
        plusRef={plusRef} onPlus={() => setPlusOpen(open => !open)} plusDot={anyWaiting} engine={engine} />
      {query ? null : <R1FilterSort prefs={prefs} facts={filterFacts(rows, trunks.list, listPeople, readLevel(), prefs, now)} onChange={changePrefs} onSettings={p.onSettings} />}
    </div>
    <nav className="r1sb-list" aria-label="Conversations">
      {p.error ? <p className="r1sb-error" role="alert">{p.error}</p> : null}
      {results}
      {searching ? null : <>
      {sections.pinned.length ? <section className="r1sb-sec" data-section="pinned"><SectionHead label="Pinned" /><PinnedGrid rows={orderPins(sections.pinned, pinOrder.order)} currentKey={p.currentKey} handlers={handlers}
        onReorder={drop => void pinOrder.move(drop, orderPins(sections.pinned, pinOrder.order).filter(row => !row.isDefault).map(pinKey))} /></section> : null}
      {section("Trunks", sections.trunks, sections.trunks.some(row => row.unread) ? <Coming need={NEED.markRead}><button type="button" className="r1sb-mar" onClick={() => markAllRead(sections.trunks)}>Mark all read</button></Coming> : null)}
      {section("People", sections.people, <button type="button" className="r1sb-head-go" data-local="" aria-label="People settings" title="People" onClick={() => p.onSettings("people")}>{icons.chevron}</button>)}
      {section("Groups", sections.groups)}
      {section("Grafted", sections.grafted)}
      {ready && contactsLoaded && nothing && !(prefs.status === "archived" && sections.archived.length) ? <p className="r1sb-empty">{query ? "No matches." : filtered ? <>Nothing matches these filters. <button type="button" className="r1sb-clear" data-local="" onClick={() => changePrefs(clearFilters(prefs))}>Clear filters</button></> : folder !== "all" ? "Nothing in this folder." : "No Trunks yet."}</p> : null}
      {!ready ? <p className="r1sb-empty">Your conversations show here once Branch connects.</p> : null}
      <div className="r1sb-bins">
        <button type="button" className="r1sb-bin" data-local="" aria-expanded={binsOpen} onClick={() => setArchivedOpen(open => !open)} disabled={narrow}>
          <span className="r1sb-bin-chev">{icons.chevron}</span><span>Archived</span>{sections.archived.length ? <i>{sections.archived.length}</i> : null}
        </button>
        {binsOpen ? sections.archived.length ? sections.archived.map(row => <SideRowView key={row.id} row={row} current={row.key === p.currentKey} now={now} handlers={handlers} picked={row.key !== null && selection.picked.has(row.key)} />) : <p className="r1sb-bin-none">Nothing here</p> : null}
        <button type="button" className="r1sb-bin" data-local="" aria-expanded={deletedOpen} onClick={() => setDeletedOpen(open => !open)}>
          <span className="r1sb-bin-chev">{icons.chevron}</span><span>Recently deleted</span>
        </button>
        {deletedOpen ? <p className="r1sb-bin-none">Nothing here</p> : null}
      </div>
      </>}
      <div className="r1sb-rail-bins">
        <button type="button" className="r1sb-cap" data-local="" aria-label={`Archived, ${sections.archived.length}`} title="Archived" onClick={() => { setArchivedOpen(true); toggleRail(); }}>{icons.archive}{sections.archived.length ? <i className="r1sb-badge">{sections.archived.length}</i> : null}</button>
        <button type="button" className="r1sb-cap" data-local="" aria-label="Recently deleted" title="Recently deleted" onClick={() => { setDeletedOpen(true); toggleRail(); }}>{icons.trash}</button>
      </div>
    </nav>
    <div className="r1sb-foot">
      <button type="button" className="r1sb-me" data-local="" ref={meRef} aria-haspopup="menu" aria-label={`${person} · Who is using Branch, look, lock`} title="Who is using Branch, look, lock" onClick={() => setPersonOpen(open => !open)}>
        <span aria-hidden="true">{person.slice(0, 1).toUpperCase()}</span>
      </button>
      <button type="button" className="r1sb-seed" data-local="" aria-label="Seedbank: agents, skills, tools, plugins and connections" title="Seedbank: agents, skills, tools, plugins and connections" onClick={() => p.onPlace("seedbank")}>
        <span className="r1sb-seed-icons" aria-hidden="true"><i>{icons.apps}</i><i>{icons.term}</i><i>{icons.leaf}</i></span><span className="r1sb-seed-t">Seedbank</span>
      </button>
      {update?.latest ? <button type="button" className="r1sb-upd" data-local="" data-busy={busy || undefined} data-ready={update.ready && !busy || undefined}
        aria-label={busy ? `Downloading ${short}` : update.ready ? `Update ready, ${short}` : `Update to ${short}`} title={update.waiting ?? `Update to ${short}`} disabled={busy} onClick={() => p.onSettings("updates")}>{icons.cloud}</button> : null}
    </div>

    {menu && menuItems ? <Popover anchor={menuAnchor} label={`${menu.name} menu`} width={300} onClose={() => setMenu(null)}><div className="r1sb-pop"><Menu label={menu.name} tiles={menuItems.tiles} rows={menuItems.rows} onClose={() => setMenu(null)} /></div></Popover> : null}
    {batch ? <Popover anchor={batchAnchor} label={batch.label ?? "Conversations"} width={260} onClose={() => setBatchOpen(false)}><div className="r1sb-pop"><Menu label={batch.label ?? "Conversations"} rows={batch.rows} onClose={() => setBatchOpen(false)} /></div></Popover> : null}
    {plusOpen ? <Popover anchor={plusRef} label="New, places and more" width={270} align="end" onClose={() => setPlusOpen(false)}><div className="r1sb-pop"><Menu label="New, places and more" rows={plusRows} onClose={() => setPlusOpen(false)} /></div></Popover> : null}
    {personOpen ? <Popover anchor={meRef} label="Who is using Branch" width={280} placement="above" onClose={() => setPersonOpen(false)}>
      <div className="r1sb-person r1sb-pop">
        <div className="r1sb-ph">Who is using Branch</div>
        <div className="r1sb-people">
          <span className="r1sb-person-chip" aria-current="true"><i>{person.slice(0, 1).toUpperCase()}</i><span>{person}</span></span>
          <button type="button" className="r1sb-person-chip" data-local="" onClick={() => { setPersonOpen(false); p.onSettings("people"); }}><i>+</i><span>Add</span></button>
        </div>
        <div className="r1sb-look"><span>Look</span><div className="r1sb-seg" role="radiogroup" aria-label="Look">
          {(["light", "dark", "system"] as const).map(choice => <button key={choice} type="button" role="radio" data-local="" aria-checked={theme === choice} onClick={() => setTheme(setThemeChoice(choice))}>{choice === "system" ? "Auto" : choice === "light" ? "Light" : "Dark"}</button>)}
        </div></div>
        <Menu label="Who is using Branch" rows={personRows_} onClose={() => setPersonOpen(false)} />
      </div>
    </Popover> : null}

    {/* The dialogs draw over the whole window: inside the sidebar, its frosted backdrop would hold the fixed scrim to the
        sidebar's own box, and a dialog would open squeezed into the list. */}
    {dialog ? createPortal(<>
    {dialog?.kind === "rename" ? <RenameDialog row={dialog.row} onClose={() => setDialog(null)} onSave={label => { if (dialog.row.row) void actions.rename(dialog.row.row, label).then(refreshContacts); setDialog(null); }} /> : null}
    {dialog?.kind === "group" ? <GroupDialog request={request} name={dialog.name} onClose={() => setDialog(null)} onMove={group => {
      const key = dialog.key;
      setDialog(null);
      void request("sessions.patch", { key, category: group }).then(() => { refreshContacts(); notify(`Moved to ${group}.`); }, (error: unknown) => notify(`Couldn't move it: ${reason(error)}`, { tone: "bad" }));
    }} /> : null}
    {dialog?.kind === "studio" ? <TrunkStudio engine={engine} onClose={() => setDialog(null)} onMade={refreshContacts} openTrunk={agentId => p.onOpen(contacts.find(contact => contact.id === `trunk:${agentId}`)?.threadKey ?? `agent:${agentId}:main`)} /> : null}
    {dialog?.kind === "delete" ? <ConfirmDelete clear row={dialog.row} onCancel={() => setDialog(null)} onDelete={() => { const row = dialog.row; setDialog(null); void actions.remove(row).then(refreshContacts); }} /> : null}
    {dialog?.kind === "deleteMany" && dialog.rows.length ? <ConfirmDelete clear row={dialog.rows[0]} count={dialog.rows.length} onCancel={() => setDialog(null)} onDelete={() => { const rows = dialog.rows; setDialog(null); void actions.removeMany(rows).then(() => { selection.clear(); refreshContacts(); }); }} /> : null}
    {dialog?.kind === "keep" ? <KeepLastDialog onCancel={() => setDialog(null)} onKeep={() => { const row = dialog.row; setDialog(null); void tidy({ session, list: p.list }, row, true); }} /> : null}
    {dialog?.kind === "replace" ? <ReplacePinDialog row={dialog.row} contacts={contacts} onClose={() => setDialog(null)} onPick={next => {
      const row = dialog.row;
      setDialog(null);
      void swapPin(row, next).catch((error: unknown) => notify(`Couldn't replace ${row.name}: ${reason(error)}.`, { tone: "bad" }));
    }} /> : null}
    {dialog?.kind === "remove" ? <RemoveTrunkDialog clear engine={engine} agentId={dialog.agentId} name={dialog.name} onClose={() => setDialog(null)} /> : null}
    {dialog?.kind === "shortcuts" ? <ShortcutsDialog onClose={() => setDialog(null)} defaultName={trunks.list.find(trunk => trunk.isDefault)?.name} /> : null}
    {dialog?.kind === "apps" ? <GetAppsDialog onClose={() => setDialog(null)} onPair={() => setDialog({ kind: "pair" })} /> : null}
    {dialog?.kind === "pair" ? <PairDialog engine={engine} close={() => setDialog(null)} /> : null}
    </>, document.body) : null}
    <NewGroupChatHost engine={ready ? engine : undefined} onOpen={p.onOpen} />
  </div>;
}

/** Move to › Group…: pick one of the session groups (sessions.groups.list) or name a new one; the move is sessions.patch
 * with that category, and a new name joins the group list on its own. */
function GroupDialog({ request, name, onClose, onMove }: { request: <T>(method: string, params?: unknown) => Promise<T>; name: string; onClose: () => void; onMove: (group: string) => void }) {
  const [groups, setGroups] = useState<string[]>([]);
  const [value, setValue] = useState("");
  useEffect(() => {
    let live = true;
    void request<{ groups?: { name: string }[] }>("sessions.groups.list", {}).then(
      result => { if (live) setGroups((result.groups ?? []).map(group => group.name)); },
      () => undefined,
    );
    return () => { live = false; };
  }, [request]);
  const group = value.trim();
  const move = () => { if (group) onMove(group); };
  return <Dialog title={`Move ${name} to a group`} onClose={onClose} testid="move-group" clear footer={<>
    <button type="button" className="btn ghost" data-local="" onClick={onClose}>Cancel</button>
    <Coming need={NEED.groupMove}><button type="button" className="btn" data-solid="" disabled={!group} onClick={move}>Move</button></Coming>
  </>}>
    {groups.length ? <div className="r1sb-groups" role="group" aria-label="Groups">
      {groups.map(choice => <button key={choice} type="button" className="btn ghost" data-local="" aria-pressed={choice === group} onClick={() => setValue(choice)}><span>{choice}</span></button>)}
    </div> : null}
    <input className="inp" data-local="" aria-label="Group name" placeholder={groups.length ? "Or a new group" : "Group name"} value={value} autoFocus onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") move(); }} />
  </Dialog>;
}

/** Replace with a different Trunk: the Trunks not pinned yet, each with its face. One with no conversation yet can't be
 *  pinned, so it says why, as the Pin tile does. */
function ReplacePinDialog({ row, contacts, onClose, onPick }: { row: SideRow; contacts: readonly Contact[]; onClose: () => void; onPick: (next: Contact) => void }) {
  const choices = contacts.filter(contact => contact.kind === "trunk" && !contact.pinnedAt && !contact.archivedAt && contact.id !== row.id);
  return <Dialog title={`Replace ${row.name}`} onClose={onClose} testid="replace-pin" clear footer={<button type="button" className="btn ghost" data-local="" onClick={onClose}>Cancel</button>}>
    {choices.length ? <div className="r1sb-swap" role="group" aria-label="Trunks">
      {choices.map(choice => {
        const face = <span className="r1sb-swap-face" aria-hidden="true"><Face size={32} label={choice.name} /></span>;
        if (!choice.thread) return <button key={choice.id} type="button" className="r1sb-swap-pick" data-local="" disabled title={FIRST_MESSAGE}>
          {face}<span className="r1sb-swap-name">{choice.name}<small>{FIRST_MESSAGE}</small></span>
        </button>;
        return <Coming key={choice.id} need={NEED.replace} where={`Replace › ${choice.name}`}>
          <button type="button" className="r1sb-swap-pick" onClick={() => onPick(choice)}>{face}<span className="r1sb-swap-name">{choice.name}</span></button>
        </Coming>;
      })}
    </div> : <p className="r1sb-swap-none">Every Trunk is pinned already.</p>}
  </Dialog>;
}

function RenameDialog({ row, onClose, onSave }: { row: SideRow; onClose: () => void; onSave: (label: string) => void }) {
  const [value, setValue] = useState(row.name);
  return <Dialog title={`Rename ${row.name}`} onClose={onClose} testid="rename" clear footer={<>
    <button type="button" className="btn ghost" data-local="" onClick={onClose}>Cancel</button>
    <Coming need={NEED.patch}><button type="button" className="btn" data-solid="" onClick={() => onSave(value)}>Rename</button></Coming>
  </>}>
    <input className="inp" data-local="" aria-label="Name" value={value} autoFocus onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === "Enter") onSave(value); }} />
  </Dialog>;
}
