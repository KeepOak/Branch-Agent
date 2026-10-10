// The conversation ⋯ menu in the header (DESIGN-SPEC §4.2.7), in the order a person reads it: six things to do
// with this conversation, the Trunk (its profile, where editing lives), then More for the rest. Rows the engine
// can't run are left out rather than greyed. A room shows its own rows (rooms/room-menu.ts) inside More.
import type { Conversation } from "../connect/conversations";
import { snoozeChoices, snoozeTime, wakeWords } from "./conversation-actions";
import { isSnoozed } from "./list-model";
import type { MenuItem } from "./Menu";
import { menuIcon } from "./menu-icons";
import { topicLayoutNames, type TopicLayout } from "./topic-layout";

/** What the engine says about the open conversation (sessions.describe), as far as the menu needs it. */
export type ConversationDetail = { showThinking: boolean };

export type ConversationMenuRun = {
  beside: () => void;
  split: (dir: "right" | "down") => void;
  move: () => void;
  replay: () => void;
  share: () => void;
  whoItKnows: () => void;
  toBoard: () => void;
  archive: () => void;
  restore: () => void;
  snooze: (until: number | null) => void;
  ownWindow: () => void;
  pin: () => void;
  rename: () => void;
  profile: () => void;
  editTrunk: () => void;
  talk: () => void;
  showCharacter: () => void;
  lookInside: () => void;
  startOver: () => void;
  exportConversation: () => void;
  map: () => void;
  exportWebPage: () => void;
  remove: () => void;
  removeTrunk: () => void;
  sidePanel: () => void;
  tower: () => void;
  list: () => void;
  theme: () => void;
  computer: () => void;
  browser: () => void;
  guide: () => void;
  backToContact: () => void;
  conversations: () => void;
};

export type ConversationMenuContext = {
  row: Conversation | null;
  /** The default Trunk's main conversation: no archive, snooze or delete. */
  isMain: boolean;
  trunkName: string;
  /** The conversation belongs to a Trunk other than the default one. */
  ownTrunk: boolean;
  /** More than one Trunk exists, so this one can be removed. */
  canRemoveTrunk: boolean;
  /** This computer is a Mac: shortcuts read ⌘ and ⌥ instead of Ctrl and Alt. */
  mac: boolean;
  now: number;
  /** Whether the Trunk has replied in this conversation yet (Look inside reads the last reply). */
  hasReply: boolean;
  /** Why Talk live is greyed, or null when voice works. */
  talkOff: string | null;
  /** The agent window is closed (its × hides it; this row brings it back). */
  characterHidden?: boolean;
  /** A conversation already shows beside this one ("Change the conversation beside"). */
  besideOpen?: boolean;
  /** The engine knows two or more computers, so "Move to computer…" shows. */
  canMove?: boolean;
  ownWindowOpen?: boolean;
  ownWindowOff?: string | null;
  hasContactReturn?: boolean;
  hasContactConversations?: boolean;
  threadView?: { contactName: string; layout: TopicLayout; set: (layout: TopicLayout) => void };
  towerVisible?: boolean;
  /** In a room, the room rows (rooms/room-menu.ts) replace the Trunk rows; a room has no Move or Archive. */
  room?: MenuItem[] | null;
  /** "Bookmarks", when this conversation has bookmarked replies. */
  bookmarks?: MenuItem | null;
  run: ConversationMenuRun;
};

const item = (label: string, icon: Parameters<typeof menuIcon>[0] | null, run: () => void, extra: Partial<Extract<MenuItem, { label: string; run: () => void }>> = {}): MenuItem => ({
  label,
  run,
  ...(icon ? { icon: menuIcon(icon) } : {}),
  ...extra,
});
const SEP: MenuItem = { kind: "sep" };
const present = <T,>(entry: T | null): entry is T => entry !== null;

/** A shortcut as this computer reads it: ⌘⇧K on a Mac, Ctrl Shift K elsewhere. */
export function keyHint(combo: string, mac: boolean): string {
  if (!mac) return combo;
  return combo.split(" ").map((key) => ({ Ctrl: "⌘", Alt: "⌥", Shift: "⇧" })[key] ?? key).join("");
}

/** Drops separators that would lead, trail or repeat. */
function tidy(entries: (MenuItem | null)[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const entry of entries.filter(present)) {
    if (entry.kind === "sep" && (out.length === 0 || out[out.length - 1].kind === "sep")) continue;
    out.push(entry);
  }
  while (out.at(-1)?.kind === "sep") out.pop();
  return out;
}

function snoozeRow(c: ConversationMenuContext): MenuItem | null {
  const row = c.row;
  if (!row || c.isMain || row.archived) return null;
  if (row.snoozedUntil && isSnoozed(row, c.now)) {
    return item("Wake", "clock", () => c.run.snooze(null), { hint: wakeWords(row.snoozedUntil, c.now) });
  }
  return {
    kind: "sub",
    label: "Snooze",
    icon: menuIcon("clock"),
    items: [{ kind: "head", label: "Snooze until" }, ...snoozeChoices(c.now).map((s): MenuItem => ({ label: s.label, hint: snoozeTime(s.until, s.label), run: () => c.run.snooze(s.until) }))],
  };
}

/** The six things to do with this conversation, the ones a person reaches for. */
function primaryRows(c: ConversationMenuContext): (MenuItem | null)[] {
  const row = c.row;
  const isRoom = Boolean(c.room);
  return [
    row ? item(row.pinned ? "Unpin" : "Pin", "pin", c.run.pin) : null,
    item("Share this conversation…", "link", c.run.share),
    !isRoom && c.canMove ? item("Move to computer…", "monitor", c.run.move) : null,
    item("Clear messages and start fresh…", "retry", c.run.startOver),
    row && !c.isMain && !isRoom ? item(row.archived ? "Restore" : "Archive", "box", row.archived ? c.run.restore : c.run.archive) : null,
  ];
}

function renameRow(c: ConversationMenuContext): MenuItem | null {
  if (c.room) return item("Rename this group…", "edit", c.run.rename);
  return c.row?.isMain ? null : item("Rename this thread…", "edit", c.run.rename);
}

function viewRows(c: ConversationMenuContext): MenuItem[] {
  const layouts = c.threadView ? [{ kind: "sub" as const, label: "Threads show as", icon: menuIcon("panel"), hover: false, testid: "conversation-view", items: [
    { kind: "head" as const, label: `${c.threadView.contactName}’s threads show as` },
    ...(Object.entries(topicLayoutNames) as [TopicLayout, string][]).map(([layout, label]): MenuItem => ({ label, checked: c.threadView!.layout === layout, radio: true, run: () => c.threadView!.set(layout) })),
  ] }] : [];
  return [
    ...layouts,
    item("Side panel", "panel", c.run.sidePanel, { hint: keyHint("Ctrl Shift K", c.mac) }),
    c.hasContactConversations ? item("Conversations", "chat", c.run.conversations) : null,
    item(c.towerVisible ? "Hide the Control tower" : "Show the Control tower", "panel", c.run.tower, { hint: keyHint("Ctrl Shift T", c.mac) }),
    item("Hide or show the list", "list", c.run.list, { hint: keyHint("Ctrl B", c.mac) }),
    item(c.besideOpen ? "Change the conversation beside" : "Open another conversation beside", "cols", c.run.beside),
    item("Split right", "cols", () => c.run.split("right")),
    item("Split down", "cols", () => c.run.split("down")),
    item(c.ownWindowOpen ? "Show its window" : "Open in its own window", "panel", c.run.ownWindow, c.ownWindowOff ? { disabled: c.ownWindowOff } : {}),
    item("Open its computer", "monitor", c.run.computer),
    item("Open the browser", "eye", c.run.browser),
    item("Switch light or dark", "spark", c.run.theme),
  ].filter(present);
}

function exportRows(c: ConversationMenuContext): MenuItem[] {
  return [item("As Markdown", "doc", c.run.exportConversation), item("As a web page", "doc", c.run.exportWebPage)];
}

/** The room rows (rooms/room-menu.ts), without the rename and delete ones this menu already has. */
function roomRows(c: ConversationMenuContext): MenuItem[] {
  return (c.room ?? []).filter((entry) => entry.kind === "sep" || (entry.kind !== "head" && entry.kind !== "custom" && !/^Rename|^Delete/.test(entry.label)));
}

function moreRows(c: ConversationMenuContext): (MenuItem | null)[] {
  const row = c.row;
  const isRoom = Boolean(c.room);
  return [
    ...roomRows(c),
    c.bookmarks ?? null,
    c.talkOff ? null : item("Talk live", "wave", c.run.talk),
    snoozeRow(c),
    renameRow(c),
    c.hasContactReturn ? item("Back to contact thread", "chat", c.run.backToContact) : null,
    !isRoom ? item(`Who ${c.trunkName} knows`, "spark", c.run.whoItKnows) : null,
    item("Make a card on the Canopy board", "puzzle", c.run.toBoard),
    c.characterHidden && !isRoom ? item(`Show ${c.trunkName}’s window`, "panel", c.run.showCharacter) : null,
    SEP,
    c.hasReply ? item("Look inside the last reply", "eye", c.run.lookInside) : null,
    item("Map of this conversation", "tree", c.run.map),
    item("Replay this conversation", "play", c.run.replay),
    SEP,
    { kind: "sub", label: "Export", icon: menuIcon("doc"), items: exportRows(c) },
    { kind: "sub", label: "View", icon: menuIcon("eye"), hover: false, items: viewRows(c) },
    SEP,
    item("Why each thing is here", "info", c.run.guide),
    SEP,
    row && !c.isMain && !isRoom ? item("Delete this conversation…", "trash", c.run.remove, { danger: true }) : null,
    !isRoom && c.ownTrunk && c.canRemoveTrunk ? item(`Remove ${c.trunkName}…`, "trash", c.run.removeTrunk, { danger: true }) : null,
  ];
}

export function conversationMenuItems(c: ConversationMenuContext): MenuItem[] {
  const trunkRow = c.room ? null : item(`${c.trunkName}…`, "info", c.run.profile);
  const more: MenuItem = { kind: "sub", label: "More", items: tidy(moreRows(c)) };
  return tidy([...primaryRows(c), SEP, trunkRow, SEP, more]);
}
