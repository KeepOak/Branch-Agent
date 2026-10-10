// The row menu's items for one conversation (DESIGN-SPEC §4.1.6, with its letter keys).
import type { Conversation } from "../connect/conversations";
import { snoozeChoices, snoozeTime, wakeWords, type Actions } from "./conversation-actions";
import { isSnoozed } from "./list-model";
import type { MenuItem } from "./Menu";
import { menuIcon } from "./menu-icons";
import type { Level } from "../places-nav/settings-nav";
import type { Contact } from "./contacts-model";

type Ctx = {
  actions: Actions;
  now: number;
  trunkName: string;
  open: (key: string) => void;
  ownWindow: (key: string) => void;
  ownWindowOpen?: (key: string) => boolean;
  ownWindowOff?: string | null;
  rename: (row: Conversation) => void;
  confirmDelete: (row: Conversation) => void;
  level: Level;
  /** "What can <Trunk> do?": opens its conversation and asks. */
  ask: (row: Conversation) => void;
  editTrunk: (agentId: string | undefined) => void;
  tidy: (row: Conversation, keepLast: boolean) => void;
  copyMarkdown: (row: Conversation) => void;
  copyText: (text: string) => void;
  copyLink: (row: Conversation) => void;
  copyConversation: (row: Conversation) => void;
  /** Icon and colour (Advanced): a submenu with the picker, built where JSX is allowed. */
  lookItem?: MenuItem | null;
  contact?: Contact;
  markContactRead?: (contact: Contact) => void;
  pinContact?: (contact: Contact) => void;
  profile?: (agentId: string | undefined) => void;
  removeTrunk?: (agentId: string, name: string) => void;
  whoItKnows?: (contact: Contact) => void;
  muted?: boolean;
  toggleMute?: (contact: Contact) => void;
  moveToGroup?: (contact: Contact) => void;
  archiveRoom?: (contact: Contact) => void;
};

const MOVE_OFF = "Moving a conversation into a project needs an engine method Branch doesn't have yet.";
const PAUSE_OFF = "Pausing a Trunk needs an engine method it doesn't have yet.";
export const CARD_LINK_OFF = "A link with a preview card needs the engine's share preview, which it doesn't have yet.";

/** Copy › (key c): the conversation's link, a link with a preview card, its Markdown, and at Technical its ID. */
function copyItem(row: Conversation, c: Ctx): MenuItem {
  const items: MenuItem[] = [
    { kind: "head", label: "Copy" },
    { label: "Link to this conversation", run: () => c.copyLink(row), testid: "copy-link", ...ic("link") },
    { label: "Link with a preview card", run: () => undefined, disabled: CARD_LINK_OFF, ...ic("link") },
    { label: "Conversation as Markdown", run: () => c.copyMarkdown(row), testid: "copy-markdown", ...ic("doc") },
  ];
  if (c.level === "technical") {
    items.push({ label: "Conversation ID", run: () => c.copyText(row.key), testid: "copy-id" });
  }
  return { kind: "sub", label: "Copy", letter: "c", items, testid: "menu-copy", icon: menuIcon("link") };
}

function tidyItem(row: Conversation, c: Ctx): MenuItem {
  const items: MenuItem[] = [{ label: "Tidy up this conversation", run: () => c.tidy(row, false), testid: "row-tidy" }];
  if (c.level !== "regular") {
    items.push({ label: "Keep only the last 400 lines…", run: () => c.tidy(row, true), testid: "row-keep400" });
  }
  return { kind: "sub", label: "Tidy up…", items, testid: "menu-tidy", icon: menuIcon("spark") };
}

function snoozeItem(row: Conversation, c: Ctx): MenuItem | null {
  if (row.isMain || row.archived) {
    return null; // not offered on archived ones or the default Trunk's main conversation
  }
  if (row.snoozedUntil && isSnoozed(row, c.now)) {
    return { label: "Wake now", hint: wakeWords(row.snoozedUntil, c.now), run: () => void c.actions.snooze(row, null), testid: "menu-wake", icon: menuIcon("clock") };
  }
  return {
    kind: "sub",
    label: "Snooze",
    testid: "menu-snooze",
    icon: menuIcon("clock"),
    items: snoozeChoices(c.now).map((s) => ({ label: s.label, hint: snoozeTime(s.until, s.label), run: () => void c.actions.snooze(row, s.until), testid: `snooze-${s.label}` })),
  };
}

const ic = (name: Parameters<typeof menuIcon>[0]) => ({ icon: menuIcon(name) });

/** The row menu in the preview's order (POPS.rowmenu with pass 18's rows): open and marks, copies, a line, the
 *  primary group (snooze, archive, project, icon and colour, tidy), the Trunk's rows, a line, Delete. */
export function rowMenuItems(row: Conversation, c: Ctx): MenuItem[] {
  if (c.contact) return contactMenuItems(row, c, c.contact);
  const items: (MenuItem | null)[] = [
    { label: "Open", run: () => c.open(row.key), testid: "menu-open", ...ic("chat") },
    row.unread
      ? { label: "Mark as read", letter: "u", run: () => void c.actions.setUnread(row, false), testid: "menu-unread", ...ic("chat") }
      : { label: "Mark as unread", letter: "u", run: () => void c.actions.setUnread(row, true), testid: "menu-unread", ...ic("chat") },
    row.isMain || row.parentKey ? null : { label: row.pinned ? "Unpin" : "Pin", letter: "p", run: () => void c.actions.pin(row), testid: "menu-pin", ...ic("pin") },
    { label: "Rename", letter: "r", run: () => c.rename(row), testid: "menu-rename", ...ic("edit") },
    { label: c.ownWindowOpen?.(row.key) ? "Show its window" : "Open in its own window", run: () => c.ownWindow(row.key), testid: "menu-own-window", ...(c.ownWindowOff ? { disabled: c.ownWindowOff } : {}), ...ic("panel") },
    { label: "Copy into a new conversation", letter: "f", hint: row.working ? "From the last finished reply" : undefined, run: () => c.copyConversation(row), testid: "menu-fork", ...ic("copy") },
    copyItem(row, c),
    { kind: "sep" },
    snoozeItem(row, c),
    { label: row.done ? "Mark not done" : "Mark done", run: () => void c.actions.setDone(row, !row.done), testid: "menu-done", ...ic("check") },
    row.isMain
      ? null
      : row.archived
        ? { label: "Restore", letter: "a", run: () => void c.actions.restore(row), testid: "menu-archive", ...ic("box") }
        : { label: "Archive", letter: "a", run: () => void c.actions.archive(row), testid: "menu-archive", ...ic("box") },
    row.parentKey ? null : { label: "Move to project", run: () => undefined, disabled: MOVE_OFF, ...ic("folder") },
    c.level === "regular" ? null : c.lookItem ?? null,
    tidyItem(row, c),
    row.isMain ? { label: `What can ${c.trunkName} do?`, run: () => c.ask(row), testid: "menu-ask", ...ic("info") } : null,
    row.isMain ? { label: "Pause", run: () => undefined, disabled: PAUSE_OFF, ...ic("pause") } : null,
    row.isMain ? { label: "Edit Trunk…", run: () => c.editTrunk(row.agentId), testid: "menu-edit-trunk", ...ic("sliders") } : null,
    row.isMain ? null : { kind: "sep" },
    row.isMain ? null : { label: "Delete…", letter: "d", danger: true, run: () => c.confirmDelete(row), testid: "menu-delete", ...ic("trash") },
  ];
  return items.filter((i): i is MenuItem => i !== null);
}

function contactMenuItems(row: Conversation, c: Ctx, contact: Contact): MenuItem[] {
  if (contact.roomId) return [
    { label: "Open", run: () => c.open(contact.threadKey), testid: "menu-open", ...ic("chat") },
    { label: "Archive", letter: "a", run: () => c.archiveRoom?.(contact), testid: "menu-archive", ...ic("box") },
  ];
  const trunk = contact.kind === "trunk";
  const otherTrunk = trunk && !contact.isDefault;
  const canEdit = Boolean(contact.thread);
  const items: (MenuItem | null)[] = [
    { label: "Open", run: () => c.open(contact.threadKey), testid: "menu-open", ...ic("chat") },
    { label: c.ownWindowOpen?.(contact.threadKey) ? "Show its window" : "Open in its own window", run: () => c.ownWindow(contact.threadKey), testid: "menu-own-window", ...(c.ownWindowOff ? { disabled: c.ownWindowOff } : {}), ...ic("panel") },
    canEdit
      ? { label: "Copy into a new conversation", letter: "f", hint: contact.thread!.working ? "From the last finished reply" : undefined, run: () => c.copyConversation(contact.thread!), testid: "menu-fork", ...ic("copy") }
      : { label: "Copy into a new conversation", letter: "f", run: () => undefined, disabled: "Send a first message before copying this conversation.", testid: "menu-fork", ...ic("copy") },
    row.unread
      ? { label: "Mark as read", letter: "u", run: () => c.markContactRead?.(contact), testid: "menu-unread", ...ic("chat") }
      : { label: "Mark as unread", letter: "u", run: () => contact.thread && void c.actions.setUnread(contact.thread, true), testid: "menu-unread", ...ic("chat"), ...(!canEdit ? { disabled: "Send a first message before marking this contact unread." } : {}) },
    { label: row.pinned ? "Unpin" : "Pin", letter: "p", run: () => c.pinContact?.(contact), testid: "menu-pin", ...ic("pin") },
    contact.kind !== "group" && contact.kind !== "chatGroup" ? { label: "Move to group…", run: () => c.moveToGroup?.(contact), testid: "menu-move-to-group", ...ic("users") } : null,
    !contact.isDefault && canEdit ? snoozeItem(contact.thread!, c) : null,
    canEdit ? { label: row.done ? "Mark not done" : "Mark done", run: () => void c.actions.setDone(contact.thread!, !row.done), testid: "menu-done", ...ic("check") } : null,
    !contact.isDefault && (!trunk || Boolean(contact.archivedAt)) && canEdit
      ? { label: row.archived ? "Restore" : "Archive", letter: "a", run: () => void (row.archived ? c.actions.restore(row) : c.actions.archive(row)), testid: "menu-archive", ...ic("box") }
      : null,
    { kind: "sep" },
    trunk
      ? { label: `Rename ${contact.name}…`, letter: "r", run: () => c.profile?.(row.agentId), testid: "menu-rename", ...ic("edit") }
      : { label: `Rename ${contact.name}…`, letter: "r", run: () => c.rename(row), testid: "menu-rename", ...ic("edit") },
    { label: c.muted ? "Unmute" : "Mute", run: () => c.toggleMute?.(contact), testid: "menu-mute", ...ic("pause") },
    trunk ? { label: "Who it knows", run: () => c.whoItKnows?.(contact), testid: "menu-who", ...ic("users") } : null,
    trunk ? { label: `What can ${contact.name} do?`, run: () => c.ask(row), testid: "menu-ask", ...ic("info") } : null,
    trunk ? { label: `Edit ${contact.name}…`, run: () => c.profile?.(row.agentId), testid: "menu-profile", ...ic("info") } : null,
    contact.isDefault ? null : { kind: "sep" },
    otherTrunk
      ? { label: `Remove ${contact.name}…`, letter: "d", danger: true, run: () => row.agentId && c.removeTrunk?.(row.agentId, contact.name), testid: "menu-remove-trunk", ...ic("trash") }
      : contact.isDefault ? null : { label: "Delete this conversation…", letter: "d", danger: true, run: () => c.confirmDelete(row), testid: "menu-delete", ...ic("trash") },
  ];
  return items.filter((item): item is MenuItem => item !== null);
}

/** A thread's right-click menu in the thread column: the four things a person does to one thread, with the same
 *  words, keys and icons as the row menu. Everything else lives in the conversation's ⋯ menu. */
export function threadMenuItems(row: Conversation, c: { actions: Actions; rename: (row: Conversation) => void }): MenuItem[] {
  return [
    { label: "Rename", letter: "r", run: () => c.rename(row), testid: "menu-rename", ...ic("edit") },
    { label: row.pinned ? "Unpin" : "Pin", letter: "p", run: () => void c.actions.pin(row), testid: "menu-pin", ...ic("pin") },
    row.unread
      ? { label: "Mark as read", letter: "u", run: () => void c.actions.setUnread(row, false), testid: "menu-unread", ...ic("chat") }
      : { label: "Mark as unread", letter: "u", run: () => void c.actions.setUnread(row, true), testid: "menu-unread", ...ic("chat") },
    row.archived
      ? { label: "Restore", letter: "a", run: () => void c.actions.restore(row), testid: "menu-archive", ...ic("box") }
      : { label: "Archive", letter: "a", run: () => void c.actions.archive(row), testid: "menu-archive", ...ic("box") },
  ];
}
