// The conversation ⋯ menu in the header (DESIGN-SPEC §4.2.7 and its Parity adds), in the preview's order.
// Each row runs one engine method through `run`; rows the engine has no method for are drawn greyed with the
// reason. Rows that only show for a state the engine can't have (pinned messages) are left out; a room shows
// its own rows (rooms/room-menu.ts) in place of the Trunk rows.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
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
  reload: () => void;
  toBoard: () => void;
  archive: () => void;
  restore: () => void;
  snooze: (until: number | null) => void;
  copyLink: () => void;
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
  search: () => void;
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
  online: boolean;
  now: number;
  /** Whether the Trunk has replied in this conversation yet (Look inside reads the last reply). */
  hasReply: boolean;
  /** Why Talk out loud is greyed, or null when voice works. */
  talkOff: string | null;
  /** The agent window is closed (its × hides it; this row brings it back). */
  characterHidden?: boolean;
  /** A conversation already shows beside this one ("Change the conversation beside"). */
  besideOpen?: boolean;
  /** The engine knows two or more computers, so "Move this conversation…" shows. */
  canMove?: boolean;
  ownWindowOpen?: boolean;
  ownWindowOff?: string | null;
  hasContactReturn?: boolean;
  hasContactConversations?: boolean;
  threadView?: { contactName: string; layout: TopicLayout; set: (layout: TopicLayout) => void };
  towerVisible?: boolean;
  /** In a room, the room rows (rooms/room-menu.ts) in place of the Trunk rows; a room has no Move, Archive or Share this Trunk. */
  room?: MenuItem[] | null;
  run: ConversationMenuRun;
};

const NO_METHOD = "needs an engine method Branch doesn't have yet.";
export const OFF_REASONS = {
  pause: `Pausing a Trunk ${NO_METHOD}`,
  teach: `Showing it how ${NO_METHOD}`,
  makeDefault: `Changing the default Trunk ${NO_METHOD}`,
  shareFile: `A locked share file ${NO_METHOD}`,
  shareTrunk: `Sharing a Trunk ${NO_METHOD}`,
  offline: "Offline: reload when it connects.",
  noReply: "There's no reply to look inside yet.",
  move: "Connect another computer before moving this conversation.",
} as const;

const item = (label: string, icon: Parameters<typeof menuIcon>[0] | null, run: () => void, extra: Partial<Extract<MenuItem, { label: string; run: () => void }>> = {}): MenuItem => ({
  label,
  run,
  ...(icon ? { icon: menuIcon(icon) } : {}),
  ...extra,
});
const off = (label: string, icon: Parameters<typeof menuIcon>[0], reason: string): MenuItem => item(label, icon, () => undefined, { disabled: reason });
const SEP: MenuItem = { kind: "sep" };

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

export function conversationMenuItems(c: ConversationMenuContext): MenuItem[] {
  const row = c.row;
  const isRoom = Boolean(c.room);
  const rename = isRoom ? "Rename this group…" : row?.isMain ? `Rename ${c.trunkName}…` : "Rename this thread…";
  const exportItems: MenuItem[] = [
    item("As Markdown", "doc", c.run.exportConversation),
    item("As a web page", "doc", c.run.exportWebPage),
    off("As a share file, locked…", "lock", OFF_REASONS.shareFile),
  ];
  const rows: (MenuItem | null)[] = [
    { kind: "head", label: "This conversation" },
    item("Search in this conversation", "eye", c.run.search, { hint: "Ctrl F" }),
    c.hasContactReturn ? item("Back to contact thread", "chat", c.run.backToContact) : null,
    row ? item(row.pinned ? "Unpin" : "Pin", "pin", c.run.pin) : null,
    snoozeRow(c),
    item("Talk live", "wave", c.run.talk, c.talkOff ? { disabled: c.talkOff } : {}),
    item("Send to the board", "puzzle", c.run.toBoard),
    isRoom ? null : c.canMove ? item("Move to another computer…", "monitor", c.run.move) : off("Move to another computer…", "monitor", OFF_REASONS.move),
    item("Share this conversation…", "users", c.run.share),
    item("Copy link", "link", c.run.copyLink),
    item("Reload", "retry", c.run.reload, c.online ? {} : { disabled: OFF_REASONS.offline }),
    item("Start over…", "retry", c.run.startOver),
    row && !c.isMain && !isRoom ? item(row.archived ? "Restore" : "Archive", "box", row.archived ? c.run.restore : c.run.archive) : null,
    isRoom ? item(rename, "edit", c.run.rename) : null,
    !isRoom ? { kind: "sep" } : null,
    !isRoom ? { kind: "head", label: c.trunkName } : null,
    !isRoom ? item(`${c.trunkName}’s profile`, "users", c.run.profile) : null,
    !isRoom ? item(`Edit ${c.trunkName}…`, "sliders", c.run.editTrunk) : null,
    !isRoom ? item(rename, "edit", row?.isMain ? c.run.editTrunk : c.run.rename) : null,
    !isRoom ? item(`Who ${c.trunkName} knows`, "spark", c.run.whoItKnows) : null,
    !isRoom ? off(`Share ${c.trunkName}…`, "doc", OFF_REASONS.shareTrunk) : null,
    !isRoom ? off(`Show ${c.trunkName} how, once`, "teach", OFF_REASONS.teach) : null,
    !isRoom ? off(`Make ${c.trunkName} the default`, "star", OFF_REASONS.makeDefault) : null,
    !isRoom ? off(`Pause ${c.trunkName}`, "pause", OFF_REASONS.pause) : null,
    c.characterHidden && !isRoom ? item(`Show ${c.trunkName}’s window`, "panel", c.run.showCharacter) : null,
    ...(c.room?.filter((entry) => entry.kind === "sep" || (entry.kind !== "head" && entry.kind !== "custom" && !/^Rename|^Delete/.test(entry.label))) ?? []),
    SEP,
    { kind: "head", label: "Look closer" },
    item("Look inside the last reply", "eye", c.run.lookInside, c.hasReply ? {} : { disabled: OFF_REASONS.noReply }),
    item("Map of this conversation", "tree", c.run.map),
    item("Replay this conversation", "play", c.run.replay),
    SEP,
    { kind: "sub", label: "Export", icon: menuIcon("doc"), items: exportItems },
    SEP,
    { kind: "head", label: "View" },
    // Preview View opens on click (viewmPB18). Hover here covers Side panel and Open the browser.
    c.threadView ? { kind: "sub", label: "View", icon: menuIcon("eye"), hover: false, testid: "conversation-view", items: [
      { kind: "head", label: `${c.threadView.contactName}’s threads show as` },
      ...(Object.entries(topicLayoutNames) as [TopicLayout, string][]).map(([layout, label]): MenuItem => ({ label, checked: c.threadView!.layout === layout, radio: true, run: () => c.threadView!.set(layout) })),
    ] } : null,
    item("Side panel", "panel", c.run.sidePanel, { hint: "Ctrl Shift K" }),
    c.hasContactConversations ? item("Conversations", "chat", c.run.conversations) : null,
    item(c.towerVisible ? "Hide the Control tower" : "Show the Control tower", "panel", c.run.tower, { hint: "Ctrl Shift T" }),
    item("Hide or show the list", "list", c.run.list, { hint: "Ctrl B" }),
    item(c.besideOpen ? "Change the conversation beside" : "Open another conversation beside", "cols", c.run.beside),
    item("Split right", "cols", () => c.run.split("right")),
    item("Split down", "cols", () => c.run.split("down")),
    item(c.ownWindowOpen ? "Show its window" : "Open in its own window", "panel", c.run.ownWindow, c.ownWindowOff ? { disabled: c.ownWindowOff } : {}),
    item("Open its computer", "monitor", c.run.computer),
    item("Open the browser", "eye", c.run.browser),
    item("Switch light or dark", "spark", c.run.theme),
    SEP,
    { kind: "head", label: "Help" },
    item("Why each thing is here", "info", c.run.guide),
    SEP,
    row && !c.isMain ? item("Delete this conversation…", "trash", c.run.remove, { danger: true }) : null,
    !isRoom && c.ownTrunk && c.canRemoveTrunk ? item(`Remove ${c.trunkName}…`, "trash", c.run.removeTrunk, { danger: true }) : null,
  ];
  return rows.filter((entry): entry is MenuItem => entry !== null);
}
