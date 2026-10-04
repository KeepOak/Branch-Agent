// The conversation ⋯ menu in the header (DESIGN-SPEC §4.2.7 and its Parity adds), in the preview's order.
// Each row runs one engine method through `run`; rows the engine has no method for are drawn greyed with the
// reason. Rows that only show for a state the engine can't have (pinned messages) are left out; a room shows
// its own rows (rooms/room-menu.ts) in place of the Trunk rows.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { Level } from "../places-nav/settings-nav";
import type { Conversation } from "../connect/conversations";
import { snoozeChoices, wakeWords } from "./conversation-actions";
import { isSnoozed } from "./list-model";
import type { MenuItem } from "./Menu";
import { menuIcon } from "./menu-icons";

export type StepUpdates = "off" | "on" | "full";

/** What the engine says about the open conversation (sessions.describe), as far as the menu needs it. */
export type ConversationDetail = { verboseLevel: StepUpdates; showThinking: boolean; workspace: string | null };

export type ConversationMenuRun = {
  beside: () => void;
  split: (dir: "right" | "down") => void;
  move: () => void;
  replay: () => void;
  ownWindow: () => void;
  share: () => void;
  whoItKnows: () => void;
  reload: () => void;
  toBoard: () => void;
  archive: () => void;
  restore: () => void;
  snooze: (until: number | null) => void;
  copyLink: () => void;
  copyMarkdown: () => void;
  copyId: () => void;
  showThinking: (on: boolean) => void;
  stepUpdates: (level: StepUpdates) => void;
  revealFolder: () => void;
  copyPath: () => void;
  pin: () => void;
  rename: () => void;
  profile: () => void;
  editTrunk: () => void;
  talk: () => void;
  showCharacter: () => void;
  lookInside: () => void;
  startOver: () => void;
  exportSteps: () => void;
  exportConversation: () => void;
  about: () => void;
  map: () => void;
  exportWebPage: () => void;
  remove: () => void;
  removeTrunk: () => void;
};

export type ConversationMenuContext = {
  row: Conversation | null;
  /** The default Trunk's main conversation: no pin, archive, snooze or delete. */
  isMain: boolean;
  trunkName: string;
  /** The conversation belongs to a Trunk other than the default one. */
  ownTrunk: boolean;
  /** More than one Trunk exists, so this one can be removed. */
  canRemoveTrunk: boolean;
  level: Level;
  online: boolean;
  now: number;
  /** Whether the Trunk has replied in this conversation yet (Look inside reads the last reply). */
  hasReply: boolean;
  /** Why Talk out loud is greyed, or null when voice works. */
  talkOff: string | null;
  /** The agent window is closed (its × hides it; this row brings it back). */
  characterHidden?: boolean;
  detail: ConversationDetail | null;
  /** "Show in Finder" on a Mac, "Show in File Explorer" elsewhere. */
  fileManager: string;
  /** A conversation already shows beside this one ("Change the conversation beside"). */
  besideOpen?: boolean;
  /** The engine knows two or more computers, so "Move this conversation…" shows. */
  canMove?: boolean;
  /** Icon and colour (Advanced), built where JSX is allowed. */
  lookItem?: MenuItem | null;
  /** In a room, the room rows (rooms/room-menu.ts) in place of the Trunk rows; a room has no Move, Archive or Share this Trunk. */
  room?: MenuItem[] | null;
  run: ConversationMenuRun;
};

const NO_METHOD = "needs an engine method Branch doesn't have yet.";
export const OFF_REASONS = {
  pause: `Pausing a Trunk ${NO_METHOD}`,
  teach: `Showing it how ${NO_METHOD}`,
  makeDefault: `Changing the default Trunk ${NO_METHOD}`,
  rawFile: `Opening the conversation's file ${NO_METHOD}`,
  shareFile: `A locked share file ${NO_METHOD}`,
  shareTrunk: `Sharing a Trunk ${NO_METHOD}`,
  offline: "Offline: reload when it connects.",
  noReply: "There's no reply to look inside yet.",
} as const;

const item = (label: string, icon: Parameters<typeof menuIcon>[0] | null, run: () => void, extra: Partial<Extract<MenuItem, { label: string; run: () => void }>> = {}): MenuItem => ({
  label,
  run,
  ...(icon ? { icon: menuIcon(icon) } : {}),
  ...extra,
});
const off = (label: string, icon: Parameters<typeof menuIcon>[0], reason: string): MenuItem => item(label, icon, () => undefined, { disabled: reason });
const SEP: MenuItem = { kind: "sep" };
const at = (c: ConversationMenuContext, level: Level) => (["regular", "advanced", "technical"] as Level[]).indexOf(c.level) >= (["regular", "advanced", "technical"] as Level[]).indexOf(level);

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
    items: [{ kind: "head", label: "Snooze until" }, ...snoozeChoices(c.now).map((s): MenuItem => ({ label: s.label, hint: wakeWords(s.until, c.now), run: () => c.run.snooze(s.until) }))],
  };
}

function copyRow(c: ConversationMenuContext): MenuItem {
  const items: MenuItem[] = [{ kind: "head", label: "Copy" }, item("Conversation link", "link", c.run.copyLink)];
  if (at(c, "advanced")) items.push(item("Conversation as Markdown", "doc", c.run.copyMarkdown));
  if (at(c, "technical")) items.push(item("Conversation ID", "copy", c.run.copyId));
  return { kind: "sub", label: "Copy", icon: menuIcon("copy"), items };
}

function viewRows(c: ConversationMenuContext): MenuItem[] {
  if (!at(c, "advanced") || !c.detail) return [];
  const d = c.detail;
  const steps: [StepUpdates, string, string][] = [["off", "Off", "Just the answer"], ["on", "On", "A line for each tool step"], ["full", "Full", "Each step and what it returned"]];
  return [
    { kind: "sub", label: "View", icon: menuIcon("eye"), items: [{ kind: "head", label: "View" }, item("Show the thinking", null, () => c.run.showThinking(!d.showThinking), { checked: d.showThinking })] },
    { kind: "sub", label: "Step updates", icon: menuIcon("list"), items: [{ kind: "head", label: "Step updates" }, ...steps.map(([v, l, s]) => item(l, null, () => c.run.stepUpdates(v), { sub: s, checked: d.verboseLevel === v }))] },
  ];
}

function folderRow(c: ConversationMenuContext): MenuItem | null {
  if (!c.detail) return null;
  const items: MenuItem[] = [{ kind: "head", label: "Folder" }, item(c.fileManager, "folder", c.run.revealFolder)];
  if (c.detail.workspace) items.push(item("Copy path", "copy", c.run.copyPath));
  return { kind: "sub", label: "Folder", icon: menuIcon("folder"), items };
}

/** The rows that act on the conversation as a list row: open beside, share, who it knows, reload, board, archive. */
function topRows(c: ConversationMenuContext): (MenuItem | null)[] {
  const row = c.row;
  return [
    item(c.besideOpen ? "Change the conversation beside" : "Open another conversation beside", "cols", c.run.beside),
    item("Split right", "cols", () => c.run.split("right")),
    item("Split down", "cols", () => c.run.split("down")),
    item("Open in its own window", "panel", c.run.ownWindow),
    c.canMove && !c.room ? item("Move this conversation…", "monitor", c.run.move) : null,
    item("Share…", "users", c.run.share),
    c.ownTrunk && !c.room ? off("Share this Trunk…", "doc", OFF_REASONS.shareTrunk) : null,
    item("Who it knows", "spark", c.run.whoItKnows),
    item("Reload conversation", "retry", c.run.reload, c.online ? {} : { disabled: OFF_REASONS.offline }),
    SEP,
    item("Send to the board", "puzzle", c.run.toBoard),
    SEP,
    row && !c.isMain && !c.room ? item(row.archived ? "Restore" : "Archive", "trash", row.archived ? c.run.restore : c.run.archive) : null,
    snoozeRow(c),
    at(c, "advanced") ? c.lookItem ?? null : null,
    copyRow(c),
    ...viewRows(c),
    folderRow(c),
    SEP,
  ];
}

/** The rows about the Trunk and the conversation itself. */
function trunkRows(c: ConversationMenuContext): (MenuItem | null)[] {
  const row = c.row;
  return [
    row && !c.isMain ? item(row.pinned ? "Unpin" : "Pin to top", "pin", c.run.pin) : null,
    c.ownTrunk ? off("Pause this Trunk", "pause", OFF_REASONS.pause) : null,
    item("Rename", "edit", c.run.rename),
    item(`${c.trunkName}’s profile`, "users", c.run.profile),
    item("Edit Trunk…", "sliders", c.run.editTrunk),
    c.ownTrunk ? off("Show it how, once", "teach", OFF_REASONS.teach) : null,
    c.ownTrunk ? off("Make default", "star", OFF_REASONS.makeDefault) : null,
    item("Talk out loud", "wave", c.run.talk, c.talkOff ? { disabled: c.talkOff } : {}),
    c.characterHidden ? item(`Show ${c.trunkName}’s window`, "panel", c.run.showCharacter) : null,
    item("Look inside the last reply", "eye", c.run.lookInside, c.hasReply ? {} : { disabled: OFF_REASONS.noReply }),
    item("Start over…", "retry", c.run.startOver),
    at(c, "technical") ? off("Open the raw file", "doc", OFF_REASONS.rawFile) : null,
    at(c, "technical") ? item("Export its steps", "doc", c.run.exportSteps) : null,
    item("Export conversation", "doc", c.run.exportConversation),
    at(c, "technical") ? item("About this conversation", "info", c.run.about) : null,
    SEP,
    item("Map of this conversation", "tree", c.run.map),
    item("Replay this conversation", "play", c.run.replay),
    item("Export as a web page", "doc", c.run.exportWebPage),
    off("Export a share file, locked…", "lock", OFF_REASONS.shareFile),
    row && !c.isMain ? item("Delete…", "trash", c.run.remove, { danger: true }) : null,
    c.ownTrunk && c.canRemoveTrunk ? item("Remove Trunk…", "trash", c.run.removeTrunk, { danger: true }) : null,
  ];
}

export function conversationMenuItems(c: ConversationMenuContext): MenuItem[] {
  return [...topRows(c), ...(c.room ?? trunkRows(c))].filter((i): i is MenuItem => i !== null);
}
