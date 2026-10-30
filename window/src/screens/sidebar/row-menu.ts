// The row menu for a Trunk row and a pinned face (preview POPS.rowmenu, the same menu for `.pinTileT5`).
// One column, in the preview's order. Tiles stay empty: the preview's menu is not a tile grid.
// An entry either runs its action or is greyed. Unfinished Coming rows ("<label> comes in a later
// update.") show only at Technical; Regular and Advanced hide them. A pinned face adds Replace with a different Trunk….
import type { Conversation } from "../../connect/conversations";
import { snoozeChoices, snoozeTime, wakeWords, type Actions } from "../../shell/conversation-actions";
import type { Contact } from "../../shell/contacts-model";
import { menuIcon } from "../../shell/menu-icons";
import { isComingWhy } from "../../shell/shown-why";
import type { MenuEntry } from "../../glass/Menu";
import type { SideRow } from "./model";

export type RowMenuContext = {
  now: number;
  actions: Actions;
  projects: { id: string; name: string }[];
  /** Greyed, with this reason, when this window can't open a conversation in its own window. */
  ownWindowOff: string | null;
  open: (key: string) => void;
  pin: (contact: Contact) => void;
  markRead: (contact: Contact) => void;
  archiveRoom: (contact: Contact) => void;
  unarchiveRoom: (contact: Contact) => void;
  rename: (row: SideRow) => void;
  /** A Trunk row's Rename: a name box over the list, never a trip to People (walkthrough B-093, B-094). */
  renameTrunk: (agentId: string, row: SideRow) => void;
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
  /** Advanced and Technical: Tidy up also offers Keep only the last 400 lines. */
  advanced?: boolean;
  /** Technical shows unfinished Coming rows; Regular and Advanced hide them (Private #1093 item 4, #1874). */
  technical?: boolean;
  keepLast?: (row: Conversation) => void;
  removeTrunk: (agentId: string, name: string) => void;
  confirmDelete: (row: Conversation) => void;
  /** A pinned face: pick a Trunk to take this pin's place (the picker, then the swap, live in Sidebar.tsx). */
  replacePin: (row: SideRow) => void;
};

export const FIRST_MESSAGE = "Send a first message first.";
export const DEFAULT_AWAKE = "Always awake";
export const DEFAULT_LISTED = "Always listed";
export const TRUNK_LISTED = "Always listed";
export const PAUSE_OFF = "Pausing a Trunk needs an engine method it doesn't have yet.";
export const NO_PROJECTS = "No projects yet.";
export const DEFAULT_FIRST = "Always first";
export const REPLACE_PIN = "Replace with a different Trunk…";
/** The preview's reason on the main conversation's pin (hover pin, and the menu item here). */
export const MAIN_STAYS = "The main conversation stays first.";

/** The engine calls behind each entry (shell/conversation-actions.ts). */
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
  renameTrunk: "agents.update",
  removeTrunk: "agents.delete",
  ask: "chat.send",
  tidy: "sessions.compact",
  history: "chat.history",
  /** Replace a pin: pin the picked Trunk (sessions.patch), then unpin this one and its topics (sessions.patchMany, contacts.topics). */
  replace: ["sessions.patch", "sessions.patchMany", "contacts.topics"],
} as const;

const icon = (name: Parameters<typeof menuIcon>[0]) => menuIcon(name);
const present = (entries: (MenuEntry | null)[]): MenuEntry[] => entries.filter((entry): entry is MenuEntry => entry !== null);
const later = (label: string) => `${label} comes in a later update.`;
const agentOf = (row: SideRow) => row.row?.agentId ?? (row.contact?.kind === "trunk" ? row.contact.id.slice("trunk:".length) : undefined);

/** Regular and Advanced keep only what works today: drop Coming placeholders (and the same lines in a submenu). */
function live(entries: MenuEntry[], technical: boolean): MenuEntry[] {
  return entries.flatMap((entry) => {
    if (!technical && isComingWhy(entry.off)) return [];
    if (!entry.submenu) return [entry];
    return [{ ...entry, submenu: live(entry.submenu, technical) }];
  });
}

/** The first row of a group carries the preview's divider. */
function grouped(entries: (MenuEntry | null)[]): MenuEntry[] {
  const rows = present(entries);
  if (rows[0]) rows[0] = { ...rows[0], gap: true };
  return rows;
}

function snoozeRow(row: SideRow, thread: Conversation | null, c: RowMenuContext): MenuEntry | null {
  if (row.isDefault || row.archived) return null;
  if (!thread) return { label: "Snooze", icon: icon("clock"), off: FIRST_MESSAGE };
  if (thread.snoozedUntil && thread.snoozedUntil > c.now) {
    return { label: "Wake now", icon: icon("clock"), need: NEED.patch, hint: wakeWords(thread.snoozedUntil, c.now), onSelect: () => void c.actions.snooze(thread, null) };
  }
  return { label: "Snooze", icon: icon("clock"), submenu: snoozeChoices(c.now).map(choice => ({
    label: choice.label, need: NEED.patch, hint: snoozeTime(choice.until, choice.label), onSelect: () => void c.actions.snooze(thread, choice.until),
  })) };
}

function archiveRow(row: SideRow, thread: Conversation | null, c: RowMenuContext): MenuEntry | null {
  if (row.isDefault) return null;
  const contact = row.contact!;
  if (contact.roomId) {
    return { label: row.archived ? "Unarchive" : "Archive", letter: "a", icon: icon("box"), need: NEED.roomArchive, onSelect: () => (row.archived ? c.unarchiveRoom(contact) : c.archiveRoom(contact)) };
  }
  const label = row.archived ? "Restore" : "Archive";
  // A Trunk stays on the list. A grafted row is an outside agent (kind "grafted"), not a Trunk, so it archives with the other conversations.
  if (row.kind === "trunk") return { label, letter: "a", icon: icon("box"), off: later(label), need: NEED.patch };
  if (!thread || !row.row) return { label, letter: "a", icon: icon("box"), off: FIRST_MESSAGE };
  const target = row.row;
  return { label, letter: "a", icon: icon("box"), need: NEED.patch, onSelect: () => void (row.archived ? c.actions.restore(target) : c.actions.archive(target)) };
}

/** The rows for one contact. People rows have no menu. Tiles stay empty. */
export function rowMenu(row: SideRow, c: RowMenuContext): { tiles: MenuEntry[]; rows: MenuEntry[] } {
  const contact = row.contact;
  if (!contact || !row.key) return { tiles: [], rows: [] };
  const key = row.key, thread = contact.thread, agentId = agentOf(row), trunk = row.kind === "trunk";
  const pinLabel = row.pinned ? "Unpin" : "Pin to top";
  const pin: MenuEntry = { label: pinLabel, letter: "p", icon: icon("pin"), ...(row.isDefault ? { off: MAIN_STAYS } : thread || contact.roomId || row.pinned ? { need: row.pinned ? NEED.unpin : NEED.patch, onSelect: () => c.pin(contact) } : { off: FIRST_MESSAGE }) };
  const unread: MenuEntry = row.unread
    ? { label: "Mark as read", letter: "u", icon: icon("chat"), need: NEED.markRead, onSelect: () => c.markRead(contact) }
    : thread ? { label: "Mark as unread", letter: "u", icon: icon("chat"), need: NEED.patch, onSelect: () => void c.actions.setUnread(thread, true) } : { label: "Mark as unread", letter: "u", icon: icon("chat"), off: FIRST_MESSAGE };
  const projects: MenuEntry = c.projects.length
    ? { label: "Move to project", icon: icon("folder"), submenu: c.projects.map(project => ({ label: project.name, need: NEED.patch, onSelect: () => c.moveToProject(key, project.id) })) }
    : { label: "Move to project", icon: icon("folder"), off: NO_PROJECTS };
  const archive = archiveRow(row, thread, c);
  const done: MenuEntry | null = row.kind === "group" ? null : thread
    ? { label: thread.done ? "Mark not done" : "Mark done", icon: icon("check"), need: NEED.patch, onSelect: () => void c.actions.setDone(thread, !thread.done) }
    : { label: "Mark done", icon: icon("check"), off: FIRST_MESSAGE };
  const primary = grouped([
    snoozeRow(row, thread, c),
    archive ? done : null,
    archive,
    projects,
    c.technical ? { label: "Assign to…", icon: icon("users"), off: later("Assign to…") } : null,
    c.technical ? { label: "Icon and colour", letter: "i", icon: icon("spark"), off: later("Icon and colour") } : null,
    thread ? { label: "Tidy up…", icon: icon("spark"), submenu: present([
      { label: "Tidy up this conversation", need: NEED.tidy, onSelect: () => c.tidy(thread) },
      c.advanced ? { label: "Keep only the last 400 lines…", need: NEED.tidy, onSelect: () => c.keepLast?.(thread) } : null,
    ]) } : { label: "Tidy up…", icon: icon("spark"), off: FIRST_MESSAGE },
  ]);
  const trunkRows: MenuEntry[] = trunk && agentId ? [
    { label: `New conversation with ${row.name}`, icon: icon("plus"), need: NEED.create, onSelect: () => c.newConversation(agentId) },
    thread ? { label: `What can ${row.name} do?`, icon: icon("info"), need: NEED.ask, onSelect: () => c.ask(key) } : { label: `What can ${row.name} do?`, icon: icon("info"), off: FIRST_MESSAGE },
    { label: "Pause", icon: icon("pause"), need: NEED.pause, off: later("Pause") },
    { label: "Edit Trunk…", icon: icon("sliders"), local: true, onSelect: () => c.editTrunk(agentId) },
  ] : [];
  const tail = grouped([
    row.pinned ? row.isDefault
      ? { label: REPLACE_PIN, icon: icon("pin"), off: DEFAULT_FIRST }
      : { label: REPLACE_PIN, icon: icon("pin"), need: NEED.replace, onSelect: () => c.replacePin(row) } : null,
    row.isDefault ? null : thread
      ? { label: "Delete…", letter: "d", icon: icon("trash"), danger: true, need: NEED.delete, onSelect: () => c.confirmDelete(thread) }
      : { label: "Delete…", letter: "d", icon: icon("trash"), danger: true, off: FIRST_MESSAGE },
    trunk && agentId && !row.isDefault ? { label: "Remove…", icon: icon("trash"), danger: true, need: NEED.removeTrunk, onSelect: () => c.removeTrunk(agentId, row.name) } : null,
  ]);
  const rows = present([
    { label: "Open", icon: icon("chat"), local: true, onSelect: () => c.open(key) },
    unread,
    c.technical ? { label: "Hide from Involving me", icon: icon("eye"), off: later("Hide from Involving me") } : null,
    pin,
    row.kind === "group" ? null : thread
      ? { label: "Move to group…", icon: icon("users"), need: NEED.groupMove, onSelect: () => c.moveToGroup(key, row.name) }
      : { label: "Move to group…", icon: icon("users"), off: FIRST_MESSAGE },
    trunk && agentId ? { label: "Rename", letter: "r", icon: icon("edit"), need: NEED.renameTrunk, onSelect: () => c.renameTrunk(agentId, row) } : { label: "Rename", letter: "r", icon: icon("edit"), need: NEED.patch, onSelect: () => c.rename(row) },
    c.ownWindowOff
      ? { label: "Open in its own window", icon: icon("panel"), off: c.ownWindowOff }
      : { label: "Open in its own window", icon: icon("panel"), local: true, onSelect: () => c.ownWindow(key) },
    c.technical ? { label: "Open folder in", icon: icon("folder"), off: later("Open folder in") } : null,
    thread
      ? { label: "Copy into a new conversation", letter: "f", icon: icon("copy"), need: NEED.copy, hint: thread.working ? "From the last finished reply" : undefined, onSelect: () => void c.actions.copyConversation(thread, c.open) }
      : { label: "Copy into a new conversation", letter: "f", icon: icon("copy"), off: FIRST_MESSAGE },
    { label: "Copy", letter: "c", icon: icon("link"), submenu: [
      { label: "Link to this conversation", icon: icon("link"), local: true, onSelect: () => c.copyLink(key) },
      { label: "Link with a preview card", icon: icon("link"), off: later("Link with a preview card") },
      { label: "Conversation as Markdown", icon: icon("doc"), need: NEED.history, onSelect: () => c.copyMarkdown(key, row.name) },
      { label: "Conversation ID", icon: icon("copy"), local: true, onSelect: () => c.copyText(key) },
    ] },
    ...primary,
    ...trunkRows,
    archive ? null : done,
    ...tail,
  ]);
  return { tiles: [], rows: live(rows, Boolean(c.technical)) };
}
