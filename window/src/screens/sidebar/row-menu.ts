// The row ••• menu (HANDOFF R1-02, owner item 20): four quick tiles (Pin, Unread, Snooze ›, Archive) and the rows
// Rename, Move to ›, New conversation ›, Copy ›, Open in new window, the Trunk's own submenu, then Delete in red. Each
// entry calls the engine through the Classic actions (shell/conversation-actions.ts, contacts-model.ts); one that this
// window can't run yet says why instead of pretending. Each entry names the engine method it calls (R1-10), so an engine
// without it shows Coming; entries that only copy, open or navigate are local.
import type { Conversation } from "../../connect/conversations";
import { snoozeChoices, snoozeTime, wakeWords, type Actions } from "../../shell/conversation-actions";
import type { Contact } from "../../shell/contacts-model";
import { menuIcon } from "../../shell/menu-icons";
import type { MenuEntry } from "../../glass/Menu";
import type { SideRow } from "./model";

export type RowMenuContext = {
  now: number;
  actions: Actions;
  projects: { id: string; name: string }[];
  /** Hidden, not greyed, when this window can't open conversations in their own window. */
  ownWindowOff: string | null;
  open: (key: string) => void;
  pin: (contact: Contact) => void;
  markRead: (contact: Contact) => void;
  archiveRoom: (contact: Contact) => void;
  unarchiveRoom: (contact: Contact) => void;
  rename: (row: SideRow) => void;
  moveToProject: (key: string, projectId: string) => void;
  moveToGroup: (key: string, name: string) => void;
  newConversation: (agentId: string) => void;
  copyLink: (key: string) => void;
  copyMarkdown: (key: string, title: string) => void;
  copyText: (text: string) => void;
  ownWindow: (key: string) => void;
  ask: (key: string) => void;
  editTrunk: (agentId: string) => void;
  tidy: (row: Conversation) => void;
  /** Advanced and Technical: Tidy up also offers Keep only the last 400 lines (Classic row menu). */
  advanced?: boolean;
  keepLast?: (row: Conversation) => void;
  removeTrunk: (agentId: string, name: string) => void;
  confirmDelete: (row: Conversation) => void;
};

export const FIRST_MESSAGE = "Send a first message first.";
export const DEFAULT_AWAKE = "Your default stays awake";
export const DEFAULT_LISTED = "Your default stays in the list";
export const TRUNK_LISTED = "Trunks stay in the list";
export const PAUSE_OFF = "Pausing a Trunk needs an engine method it doesn't have yet.";
export const NO_PROJECTS = "No projects yet.";

/** The engine calls behind each entry (HANDOFF R1-02 "Engine calls"; shell/conversation-actions.ts). */
export const NEED = {
  patch: "sessions.patch",
  unpin: ["sessions.patchMany", "contacts.topics"],
  markRead: "contacts.markRead",
  create: "sessions.create",
  copy: ["sessions.create", "sessions.patch"],
  delete: "sessions.delete",
  roomArchive: "rooms.archive",
  /** The group catalog to pick from, then the conversation's category (a new name joins the catalog). */
  groupMove: ["sessions.groups.list", "sessions.patch"],
  pause: "agents.update",
  removeTrunk: "agents.delete",
  ask: "chat.send",
  tidy: "sessions.compact",
  history: "chat.history",
} as const;

const icon = (name: Parameters<typeof menuIcon>[0]) => menuIcon(name);
const present = (entries: (MenuEntry | null)[]): MenuEntry[] => entries.filter((entry): entry is MenuEntry => entry !== null);
const agentOf = (row: SideRow) => row.row?.agentId ?? (row.contact?.kind === "trunk" ? row.contact.id.slice("trunk:".length) : undefined);

function snoozeTile(row: SideRow, thread: Conversation | null, c: RowMenuContext): MenuEntry {
  if (row.isDefault) return { label: "Snooze", icon: icon("clock"), off: DEFAULT_AWAKE };
  if (!thread) return { label: "Snooze", icon: icon("clock"), off: FIRST_MESSAGE };
  if (thread.snoozedUntil && thread.snoozedUntil > c.now) {
    return { label: "Wake", icon: icon("clock"), need: NEED.patch, hint: wakeWords(thread.snoozedUntil, c.now), onSelect: () => void c.actions.snooze(thread, null) };
  }
  return { label: "Snooze", icon: icon("clock"), submenu: snoozeChoices(c.now).map(choice => ({
    label: choice.label, need: NEED.patch, hint: snoozeTime(choice.until, choice.label), onSelect: () => void c.actions.snooze(thread, choice.until),
  })) };
}

function archiveTile(row: SideRow, thread: Conversation | null, c: RowMenuContext): MenuEntry {
  const contact = row.contact!;
  const base = { label: row.archived ? "Unarchive" : "Archive", letter: "a", icon: icon("box") };
  if (row.isDefault) return { ...base, off: DEFAULT_LISTED };
  if (contact.roomId) return { ...base, need: NEED.roomArchive, onSelect: () => (row.archived ? c.unarchiveRoom(contact) : c.archiveRoom(contact)) };
  if (row.kind === "trunk" && !row.archived) return { ...base, off: TRUNK_LISTED };
  if (!thread || !row.row) return { ...base, off: FIRST_MESSAGE };
  const target = row.row;
  return { ...base, need: NEED.patch, onSelect: () => void (row.archived ? c.actions.restore(target) : c.actions.archive(target)) };
}

/** The tiles and rows for one contact row. People rows have no menu. */
export function rowMenu(row: SideRow, c: RowMenuContext): { tiles: MenuEntry[]; rows: MenuEntry[] } {
  const contact = row.contact;
  if (!contact || !row.key) return { tiles: [], rows: [] };
  const key = row.key, thread = contact.thread, agentId = agentOf(row), trunk = row.kind === "trunk";
  const tiles: MenuEntry[] = [
    thread || contact.roomId || row.pinned
      ? { label: row.pinned ? "Unpin" : "Pin", letter: "p", icon: icon("pin"), need: row.pinned ? NEED.unpin : NEED.patch, onSelect: () => c.pin(contact) }
      : { label: "Pin", letter: "p", icon: icon("pin"), off: FIRST_MESSAGE },
    row.unread
      ? { label: "Read", letter: "u", icon: icon("chat"), need: NEED.markRead, onSelect: () => c.markRead(contact) }
      : thread ? { label: "Unread", letter: "u", icon: icon("chat"), need: NEED.patch, onSelect: () => void c.actions.setUnread(thread, true) } : { label: "Unread", letter: "u", icon: icon("chat"), off: FIRST_MESSAGE },
    snoozeTile(row, thread, c),
    archiveTile(row, thread, c),
  ];
  const projects: MenuEntry = c.projects.length
    ? { label: "Project…", icon: icon("folder"), submenu: c.projects.map(project => ({ label: project.name, need: NEED.patch, onSelect: () => c.moveToProject(key, project.id) })) }
    : { label: "Project…", icon: icon("folder"), off: NO_PROJECTS };
  const rows: (MenuEntry | null)[] = [
    trunk && agentId ? { label: "Rename", letter: "r", icon: icon("edit"), local: true, onSelect: () => c.editTrunk(agentId) } : { label: "Rename", letter: "r", icon: icon("edit"), need: NEED.patch, onSelect: () => c.rename(row) },
    { label: "Move to", icon: icon("folder"), submenu: [
      thread ? { label: "Group…", icon: icon("users"), need: NEED.groupMove, onSelect: () => c.moveToGroup(key, row.name) } : { label: "Group…", icon: icon("users"), off: FIRST_MESSAGE },
      projects,
    ] },
    trunk || row.kind === "grafted" ? { label: "New conversation", letter: "f", icon: icon("chat"), submenu: [
      trunk && agentId ? { label: "Fresh", icon: icon("plus"), need: NEED.create, onSelect: () => c.newConversation(agentId) } : { label: "Fresh", icon: icon("plus"), off: "A Grafted agent keeps one conversation." },
      thread ? { label: "Continue from this one", icon: icon("copy"), need: NEED.copy, hint: thread.working ? "From the last finished reply" : undefined, onSelect: () => void c.actions.copyConversation(thread, c.open) } : { label: "Continue from this one", icon: icon("copy"), off: FIRST_MESSAGE },
    ] } : null,
    { label: "Copy", letter: "c", icon: icon("link"), submenu: [
      { label: "Link to this conversation", icon: icon("link"), local: true, onSelect: () => c.copyLink(key) },
      { label: "Conversation as Markdown", icon: icon("doc"), need: NEED.history, onSelect: () => c.copyMarkdown(key, row.name) },
      { label: "Conversation ID", icon: icon("copy"), local: true, onSelect: () => c.copyText(key) },
    ] },
    c.ownWindowOff ? null : { label: "Open in new window", icon: icon("panel"), local: true, onSelect: () => c.ownWindow(key) },
    trunk && agentId ? { label: row.name, icon: icon("users"), gap: true, submenu: present([
      { label: "What can it do?", icon: icon("info"), need: NEED.ask, onSelect: () => c.ask(key) },
      { label: "Pause", icon: icon("pause"), need: NEED.pause, off: PAUSE_OFF },
      { label: "Edit Trunk…", icon: icon("sliders"), local: true, onSelect: () => c.editTrunk(agentId) },
      thread ? { label: "Tidy up", icon: icon("spark"), submenu: present([
        { label: "Tidy up this conversation", need: NEED.tidy, onSelect: () => c.tidy(thread) },
        c.advanced && c.keepLast ? { label: "Keep only the last 400 lines…", need: NEED.tidy, onSelect: () => c.keepLast?.(thread) } : null,
      ]) } : { label: "Tidy up", icon: icon("spark"), off: FIRST_MESSAGE },
      row.isDefault ? null : { label: `Remove ${row.name}…`, icon: icon("trash"), danger: true, gap: true, need: NEED.removeTrunk, onSelect: () => c.removeTrunk(agentId, row.name) },
    ]) } : null,
    !row.isDefault && thread ? { label: "Delete conversation…", letter: "d", icon: icon("trash"), danger: true, gap: true, need: NEED.delete, onSelect: () => c.confirmDelete(thread) } : null,
  ];
  return { tiles, rows: present(rows) };
}
