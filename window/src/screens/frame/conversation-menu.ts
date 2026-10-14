// The conversation ••• menu in the header (owner-approved 2026-10-12, CHANGELOG-PASS17 "conversation ••• menu rebuilt"):
// Pin to top, Rename, Snooze ›, Archive, Send to the board, then Export › and View ›, then Start over… and Delete… in red.
// Share… follows Send to the board and opens the Classic Share dialog (owner placement for parity row 13, 2026-10-14).
// It re-hosts the Classic menu's actions (shell/conversation-menu.ts, shell/ConversationMenu.tsx) on R1's glass Menu: each
// entry names the engine call it makes, so an engine without it shows Coming; entries that only open or move are local.
// Rows the R1 window can't run yet (Split, Side panel, its computer and browser) say why instead of pretending.
// In a group chat, Group rules › sits after View: the Classic room rules (rooms/room-rules.tsx), "Who answers" (#974 row 21).
import type { Conversation } from "../../connect/conversations";
import type { MenuEntry } from "../../glass/Menu";
import type { MenuItem } from "../../shell/Menu";
import { snoozeChoices, snoozeTime, wakeWords } from "../../shell/conversation-actions";
import { menuIcon } from "../../shell/menu-icons";
import { WORK_MODES, type WorkMode } from "../chat/chat-logic";
import { DEFAULT_AWAKE, DEFAULT_LISTED, FIRST_MESSAGE, TRUNK_LISTED } from "../sidebar/row-menu";

/** The engine calls behind each entry (the Classic menu's rows, shell/ConversationMenu.tsx). */
export const CONVERSATION_NEED = {
  patch: "sessions.patch",
  board: "canopy.cards.captureSession",
  share: "session.members.list",
  history: "chat.history",
  map: "sessions.branches.list",
  describe: "sessions.describe",
  prefs: "users.prefs.set",
  computer: "computer.status",
  browser: "browser.request",
  reset: "sessions.reset",
  delete: "sessions.delete",
} as const;

export const SPLIT_OFF = "Split view comes in a later update.";
export const SIDE_PANEL_OFF = "The side panel comes in a later update.";
export const NO_REPLY = "There's no reply to look inside yet.";
export const COMPUTER_OFF = "Computer controls are not connected yet.";
export const BROWSER_OFF = "Browser controls are not connected yet.";
export const WORK_PREFS_OFF = "This engine can’t save how agents’ work shows here.";
export const WORK_AS = "Show agents’ work as";

export type ConversationMenuRun = {
  pin: () => void;
  rename: () => void;
  editTrunk: () => void;
  snooze: (until: number | null) => void;
  archive: () => void;
  restore: () => void;
  toBoard: () => void;
  share: () => void;
  exportFile: () => void;
  exportWebPage: () => void;
  copyConversation: () => void;
  map: () => void;
  replay: () => void;
  lookInside: () => void;
  workMode: (mode: WorkMode | null) => void;
  list: () => void;
  ownWindow: () => void;
  startOver: () => void;
  remove: () => void;
};

export type ConversationMenuContext = {
  /** The open conversation's list row; null before its first message. */
  row: Conversation | null;
  /** The default Trunk's own conversation: it stays awake and in the list. */
  isDefault: boolean;
  now: number;
  /** The Trunk has replied here (Look inside reads the last reply). */
  hasReply: boolean;
  /** How agents' work shows: the Settings default and this conversation's own choice (null follows Settings). */
  work: { global: WorkMode; override: WorkMode | null };
  /** Why this window can't open a conversation in its own window, or null when it can. The row is hidden then. */
  ownWindowOff: string | null;
  /** A group chat: its rule on the Group rules row and the Classic rule rows (rooms/useShellRoom's menu). */
  room?: { ruleWords: string | null; rules: MenuEntry[] } | null;
  run: ConversationMenuRun;
};

/** The engine call behind each Who answers choice: a lead Trunk is rooms.rule.set, the chat-app rules sessions.patch. */
export const ROOM_RULE_NEED = { lead: "rooms.rule.set", activation: "sessions.patch" } as const;
const LEAD = "A lead Trunk decides";

/** The Classic room rules menu (rooms/room-rules.tsx) as glass menu rows: each choice a switch row on the current rule, a greyed one keeps its reason. */
export function roomRuleEntries(items: readonly MenuItem[]): MenuEntry[] {
  return items.flatMap((item): MenuEntry[] => {
    if (item.kind !== undefined && item.kind !== "item") return [];
    if (item.disabled) return [{ label: item.label, toggle: Boolean(item.checked), local: true, off: item.disabled }];
    return [{ label: item.label, toggle: Boolean(item.checked), need: item.label === LEAD ? ROOM_RULE_NEED.lead : ROOM_RULE_NEED.activation, onSelect: item.run }];
  });
}

const icon = (name: Parameters<typeof menuIcon>[0]) => menuIcon(name);
const present = (entries: (MenuEntry | null)[]): MenuEntry[] => entries.filter((entry): entry is MenuEntry => entry !== null);

function snooze(c: ConversationMenuContext): MenuEntry {
  const row = c.row;
  if (c.isDefault) return { label: "Snooze", icon: icon("clock"), off: DEFAULT_AWAKE };
  if (!row) return { label: "Snooze", icon: icon("clock"), off: FIRST_MESSAGE };
  if (row.snoozedUntil && row.snoozedUntil > c.now) {
    return { label: "Wake", icon: icon("clock"), need: CONVERSATION_NEED.patch, hint: wakeWords(row.snoozedUntil, c.now), onSelect: () => c.run.snooze(null) };
  }
  return { label: "Snooze", icon: icon("clock"), submenu: snoozeChoices(c.now).map(choice => ({
    label: choice.label, need: CONVERSATION_NEED.patch, hint: snoozeTime(choice.until, choice.label), onSelect: () => c.run.snooze(choice.until),
  })) };
}

function archive(c: ConversationMenuContext): MenuEntry {
  const row = c.row;
  const base = { label: row?.archived ? "Restore" : "Archive", icon: icon("box") };
  if (c.isDefault) return { ...base, off: DEFAULT_LISTED };
  if (!row) return { ...base, off: FIRST_MESSAGE };
  if (row.isMain && !row.archived) return { ...base, off: TRUNK_LISTED };
  return { ...base, need: CONVERSATION_NEED.patch, onSelect: row.archived ? c.run.restore : c.run.archive };
}

function view(c: ConversationMenuContext): MenuEntry {
  const settingsLabel = WORK_MODES.find(mode => mode.id === c.work.global)?.label ?? "Normal";
  const modes: { id: WorkMode | null; label: string }[] = [{ id: null, label: `Like Settings (${settingsLabel})` }, ...WORK_MODES];
  const workRows: MenuEntry[] = modes.map(mode => ({
    label: mode.label, need: CONVERSATION_NEED.prefs, why: WORK_PREFS_OFF, toggle: c.work.override === mode.id, onSelect: () => c.run.workMode(mode.id),
  }));
  return { label: "View", icon: icon("eye"), submenu: present([
    { label: "Map of this conversation", icon: icon("tree"), need: CONVERSATION_NEED.map, onSelect: c.run.map },
    { label: "Replay this conversation", icon: icon("play"), local: true, onSelect: c.run.replay },
    c.hasReply ? { label: "Look inside the last reply", icon: icon("eye"), need: CONVERSATION_NEED.describe, onSelect: c.run.lookInside }
      : { label: "Look inside the last reply", icon: icon("eye"), local: true, off: NO_REPLY },
    { label: WORK_AS, icon: icon("sliders"), gap: true, submenu: workRows },
    { label: "Split right", icon: icon("cols"), gap: true, local: true, off: SPLIT_OFF },
    { label: "Split down", icon: icon("cols"), local: true, off: SPLIT_OFF },
    { label: "Side panel", icon: icon("panel"), gap: true, local: true, off: SIDE_PANEL_OFF },
    { label: "Hide or show the list", icon: icon("list"), hint: "Ctrl B", local: true, onSelect: c.run.list },
    { label: "Open its computer", icon: icon("monitor"), need: CONVERSATION_NEED.computer, off: COMPUTER_OFF },
    { label: "Open the browser", icon: icon("eye"), need: CONVERSATION_NEED.browser, off: BROWSER_OFF },
    c.ownWindowOff ? null : { label: "Open in its own window", icon: icon("panel"), local: true, onSelect: c.run.ownWindow },
  ]) };
}

/** The approved nine rows, in the approved order, with Share… after Send to the board; a group chat adds Group rules after View. */
export function conversationMenu(c: ConversationMenuContext): MenuEntry[] {
  const row = c.row;
  const deleteRow: MenuEntry = c.isDefault ? { label: "Delete…", icon: icon("trash"), danger: true, off: DEFAULT_LISTED }
    : row ? { label: "Delete…", icon: icon("trash"), danger: true, need: CONVERSATION_NEED.delete, onSelect: c.run.remove }
      : { label: "Delete…", icon: icon("trash"), danger: true, off: FIRST_MESSAGE };
  return present([
    row ? { label: row.pinned ? "Unpin" : "Pin to top", icon: icon("pin"), need: CONVERSATION_NEED.patch, onSelect: c.run.pin } : { label: "Pin to top", icon: icon("pin"), off: FIRST_MESSAGE },
    !row ? { label: "Rename", icon: icon("edit"), off: FIRST_MESSAGE }
      : row.isMain ? { label: "Rename", icon: icon("edit"), hint: "in Edit Trunk", local: true, onSelect: c.run.editTrunk }
        : { label: "Rename", icon: icon("edit"), need: CONVERSATION_NEED.patch, onSelect: c.run.rename },
    snooze(c),
    archive(c),
    { label: "Send to the board", icon: icon("puzzle"), need: CONVERSATION_NEED.board, onSelect: c.run.toBoard },
    row ? { label: "Share…", icon: icon("users"), need: CONVERSATION_NEED.share, onSelect: c.run.share } : { label: "Share…", icon: icon("users"), off: FIRST_MESSAGE },
    { label: "Export", icon: icon("doc"), gap: true, submenu: [
      { label: "Conversation file", icon: icon("doc"), need: CONVERSATION_NEED.history, onSelect: c.run.exportFile },
      { label: "Web page", icon: icon("doc"), need: CONVERSATION_NEED.history, onSelect: c.run.exportWebPage },
      { label: "Copy conversation", icon: icon("copy"), need: CONVERSATION_NEED.history, onSelect: c.run.copyConversation },
    ] },
    view(c),
    c.room ? { label: "Group rules", icon: icon("sliders"), ...(c.room.ruleWords ? { hint: c.room.ruleWords } : {}), submenu: c.room.rules } : null,
    { label: "Start over…", icon: icon("retry"), gap: true, need: CONVERSATION_NEED.reset, onSelect: c.run.startOver },
    deleteRow,
  ]);
}
