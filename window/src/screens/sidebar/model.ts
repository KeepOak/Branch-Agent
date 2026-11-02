// What the R1 sidebar shows (HANDOFF R1-02): the engine's contacts split into Pinned, Trunks, People, Groups and
// Grafted, then the Archived bin; the folder chip and the search narrow them. Pure functions, tested on their own.
import type { Conversation } from "../../connect/conversations";
import type { Contact } from "../../shell/contacts-model";
import { contactRow } from "../../shell/contacts-model";

export type SideKind = "trunk" | "person" | "group" | "grafted";
export type Folder = "all" | "unread" | "trunks" | "people" | "groups";
export type Person = { id: string; name: string; role?: string };

export type SideRow = {
  id: string;
  kind: SideKind;
  name: string;
  /** The conversation the row opens; a person without one opens Settings › People. */
  key: string | null;
  preview: string;
  /** Who said the preview line, shown before it ("Ledger: …"). */
  sender?: string;
  at: number;
  unread: boolean;
  waiting: boolean;
  working: boolean;
  pinned: boolean;
  archived: boolean;
  isDefault: boolean;
  offline?: boolean;
  /** The small chip under a pinned tile and after a person's name. */
  role: string;
  /** A group's members, most recently active first (names, for the cluster). */
  members?: { name: string; kind: "trunk" | "person" }[];
  contact?: Contact;
  row?: Conversation;
};

export const FOLDERS: { id: Folder; label: string }[] = [
  { id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "trunks", label: "Trunks" },
  { id: "people", label: "People" }, { id: "groups", label: "Groups" },
];

const kindOf = (contact: Contact): SideKind => contact.kind === "trunk" ? "trunk" : contact.kind === "outside" ? "grafted" : "group";
const roleOf = (contact: Contact): string =>
  contact.kind === "trunk" ? (contact.isDefault ? "Chief of Staff" : "Trunk") : contact.kind === "outside" ? "Grafted" : "Group";

/** A topic with no name of its own arrives titled with its session key (agent:<id>:…). That key is never shown
 *  (Private #1089): the preview reads the topic's last line alone. */
const SESSION_KEY = /^[a-z][\w-]*(?::[^\s:]+){2,}:?$/i;
export function topicPreview(title: string, text: string): string {
  const name = title.trim();
  return name && !SESSION_KEY.test(name) ? `${name}: ${text}` : text;
}

/** One row per contact, with the waiting state from pending approvals. */
export function contactRows(contacts: readonly Contact[], waiting: ReadonlyMap<string, number>, memberNames: (contact: Contact) => SideRow["members"]): SideRow[] {
  return contacts.map(contact => {
    const preview = contact.preview.kind === "topic" ? topicPreview(contact.preview.title, contact.preview.text) : contact.preview.text;
    const kind = kindOf(contact);
    return {
      id: contact.id, kind, name: contact.name, key: contact.threadKey,
      preview: kind === "group" && preview === "Group" ? "" : preview,
      at: contact.preview.at || contact.lastActivityAt,
      unread: contact.threadUnread || contact.unreadTopics > 0,
      waiting: contact.needsYou || (waiting.get(contact.threadKey) ?? 0) > 0,
      working: contact.working,
      pinned: Boolean(contact.pinnedAt), archived: Boolean(contact.archivedAt), isDefault: contact.isDefault,
      ...(contact.offline ? { offline: true } : {}),
      role: roleOf(contact),
      ...(kind === "group" ? { members: memberNames(contact) } : {}),
      contact, row: contactRow(contact),
    };
  });
}

const roleWord = (role?: string) => role ? role.charAt(0).toUpperCase() + role.slice(1) : "";
/** Everyone else on this Branch (users.list without you), tagged with the role the engine gives them. */
export function personRows(people: readonly Person[], selfId: string | null): SideRow[] {
  return people.filter(person => person.id !== selfId).map(person => ({
    id: `person:${person.id}`, kind: "person", name: person.name, key: null, preview: "", at: 0,
    unread: false, waiting: false, working: false, pinned: false, archived: false, isDefault: false,
    role: roleWord(person.role),
  }));
}

export type Sections = { pinned: SideRow[]; trunks: SideRow[]; people: SideRow[]; groups: SideRow[]; grafted: SideRow[]; archived: SideRow[] };

const newestFirst = (a: SideRow, b: SideRow) => b.at - a.at || a.name.localeCompare(b.name);
const matches = (row: SideRow, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || row.name.toLowerCase().includes(q) || row.preview.toLowerCase().includes(q);
};
const inFolder = (row: SideRow, folder: Folder) =>
  folder === "all" || (folder === "unread" && (row.unread || row.waiting)) || (folder === "trunks" && row.kind === "trunk")
  || (folder === "people" && row.kind === "person") || (folder === "groups" && row.kind === "group");

/** The sections in the preview's order. Pinned rows leave their kind's section; an empty section is dropped by the view. */
export function buildSections(rows: readonly SideRow[], folder: Folder, query: string): Sections {
  const shown = rows.filter(row => matches(row, query));
  const live = shown.filter(row => !row.archived && inFolder(row, folder)).sort(newestFirst);
  const rest = live.filter(row => !row.pinned);
  return {
    pinned: live.filter(row => row.pinned),
    trunks: rest.filter(row => row.kind === "trunk"),
    people: rest.filter(row => row.kind === "person"),
    groups: rest.filter(row => row.kind === "group"),
    grafted: rest.filter(row => row.kind === "grafted"),
    archived: shown.filter(row => row.archived).sort(newestFirst),
  };
}

/** The count on a folder chip: what is unread in it. "All" and People carry none. */
export function folderCount(rows: readonly SideRow[], folder: Folder): number {
  if (folder === "all" || folder === "people") return 0;
  return rows.filter(row => !row.archived && (row.unread || row.waiting) && inFolder(row, folder === "unread" ? "all" : folder)).length;
}

/** The row's time: "now", a clock time today, "Yesterday", a weekday this week, then a short date. */
export function rowTime(ms: number, now: number): string {
  if (!ms) return "";
  if (Math.abs(now - ms) < 60_000) return "now";
  const today = new Date(now), start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const at = new Date(ms);
  if (ms >= start) return at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (ms >= start - 86_400_000) return "Yesterday";
  if (ms >= start - 6 * 86_400_000) return at.toLocaleDateString([], { weekday: "short" });
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
}
