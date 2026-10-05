// The row menu's items for one conversation (DESIGN-SPEC §4.1.6, with its letter keys).
import type { Conversation } from "../connect/conversations";
import { snoozeChoices, wakeWords, type Actions } from "./conversation-actions";
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
  rename: (row: Conversation) => void;
  confirmDelete: (row: Conversation) => void;
  newWith: (agentId: string | undefined) => void;
  level: Level;
  /** "What can <Trunk> do?": opens its conversation and asks. */
  ask: (row: Conversation) => void;
  editTrunk: (agentId: string | undefined) => void;
  tidy: (row: Conversation, keepLast: boolean) => void;
  copyMarkdown: (row: Conversation) => void;
  copyText: (text: string) => void;
  copyLink: (row: Conversation) => void;
  /** Icon and colour (Advanced): a submenu with the picker, built where JSX is allowed. */
  lookItem?: MenuItem | null;
  contact?: Contact;
  markContactRead?: (contact: Contact) => void;
  pinContact?: (contact: Contact) => void;
  profile?: (agentId: string | undefined) => void;
  whoItKnows?: (contact: Contact) => void;
};

const WINDOW_OFF = "A conversation in its own window needs the desktop app, which doesn't offer it yet.";
const FORK_OFF = "Copying a conversation needs an engine call that copies up to the last reply; it doesn't have one yet.";
const MOVE_OFF = "Moving a conversation into a project needs an engine method Branch doesn't have yet.";
const PAUSE_OFF = "Pausing a Trunk needs an engine method it doesn't have yet.";
// TODO(engine-lane): Non-default Trunk main sessions cannot be deleted until the engine supports their deletion and a Recently Deleted list.
export const TRUNK_DELETE_OFF = "Deleting a Trunk's thread needs the engine to allow deleting a non-default Trunk's main session and a Recently Deleted list.";
// TODO(engine-lane): Contact mute needs a persisted setting and notification routing; sessions.patch has no mute field.
const MUTE_OFF = "Muting a contact needs a saved mute setting and notification routing, which the engine doesn't offer yet.";

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
    items: snoozeChoices(c.now).map((s) => ({ label: s.label, hint: wakeWords(s.until, c.now), run: () => void c.actions.snooze(row, s.until), testid: `snooze-${s.label}` })),
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
    row.isMain || row.parentKey ? null : { label: row.pinned ? "Unpin" : "Pin to top", letter: "p", run: () => void c.actions.pin(row), testid: "menu-pin", ...ic("pin") },
    { label: "Rename", letter: "r", run: () => c.rename(row), testid: "menu-rename", ...ic("edit") },
    { label: "Open in its own window", run: () => undefined, disabled: WINDOW_OFF, ...ic("panel") },
    { label: "Copy into a new conversation", letter: "f", run: () => undefined, disabled: FORK_OFF, ...ic("copy") },
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
    { label: `New conversation with ${c.trunkName}`, run: () => c.newWith(row.agentId), ...ic("plus") },
    row.isMain ? { label: `What can ${c.trunkName} do?`, run: () => c.ask(row), testid: "menu-ask", ...ic("info") } : null,
    row.isMain ? { label: "Pause", run: () => undefined, disabled: PAUSE_OFF, ...ic("pause") } : null,
    row.isMain ? { label: "Edit Trunk…", run: () => c.editTrunk(row.agentId), testid: "menu-edit-trunk", ...ic("sliders") } : null,
    row.isMain ? null : { kind: "sep" },
    row.isMain ? null : { label: "Delete…", letter: "d", danger: true, run: () => c.confirmDelete(row), testid: "menu-delete", ...ic("trash") },
  ];
  return items.filter((i): i is MenuItem => i !== null);
}

function contactMenuItems(row: Conversation, c: Ctx, contact: Contact): MenuItem[] {
  const trunk = contact.kind === "trunk";
  const otherTrunk = trunk && !contact.isDefault;
  const canEdit = Boolean(contact.thread);
  const items: (MenuItem | null)[] = [
    { label: "Open", run: () => c.open(contact.threadKey), testid: "menu-open", ...ic("chat") },
    row.unread
      ? { label: "Mark as read", letter: "u", run: () => c.markContactRead?.(contact), testid: "menu-unread", ...ic("chat") }
      : { label: "Mark as unread", letter: "u", run: () => contact.thread && void c.actions.setUnread(contact.thread, true), testid: "menu-unread", ...ic("chat"), ...(!canEdit ? { disabled: "Send a first message before marking this contact unread." } : {}) },
    !contact.isDefault && canEdit ? { label: row.pinned ? "Unpin" : "Pin to top", letter: "p", run: () => c.pinContact?.(contact), testid: "menu-pin", ...ic("pin") } : null,
    { label: "Mute", run: () => undefined, disabled: MUTE_OFF, testid: "menu-mute", ...ic("pause") },
    trunk
      ? { label: "Rename Trunk on profile", letter: "r", run: () => c.profile?.(row.agentId), testid: "menu-rename", ...ic("edit") }
      : { label: "Rename", letter: "r", run: () => c.rename(row), testid: "menu-rename", ...ic("edit") },
    !contact.isDefault && (!trunk || Boolean(contact.archivedAt)) && canEdit
      ? { label: row.archived ? "Restore" : "Archive", letter: "a", run: () => void (row.archived ? c.actions.restore(row) : c.actions.archive(row)), testid: "menu-archive", ...ic("box") }
      : null,
    trunk ? { label: `New conversation with ${contact.name}`, run: () => c.newWith(row.agentId), ...ic("plus") } : null,
    trunk ? { label: "Who it knows", run: () => c.whoItKnows?.(contact), testid: "menu-who", ...ic("users") } : null,
    trunk ? { label: "Open profile", run: () => c.profile?.(row.agentId), testid: "menu-profile", ...ic("info") } : null,
    contact.isDefault ? null : { kind: "sep" },
    otherTrunk
      ? { label: "Delete…", letter: "d", danger: true, run: () => undefined, disabled: TRUNK_DELETE_OFF, testid: "menu-delete", ...ic("trash") }
      : contact.isDefault ? null : { label: "Delete…", letter: "d", danger: true, run: () => c.confirmDelete(row), testid: "menu-delete", ...ic("trash") },
  ];
  return items.filter((item): item is MenuItem => item !== null);
}
