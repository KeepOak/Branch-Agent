// The menu for several conversations picked with Alt or Shift (§4.1.1 select several, the preview's batchMenuPA18).
import type { Conversation } from "../connect/conversations";
import type { Actions } from "./conversation-actions";
import type { MenuItem } from "./Menu";

export const MOVE_MANY_OFF = "Moving conversations into a project needs an engine method Branch doesn't have yet.";

export function batchMenuItems(rows: Conversation[], actions: Actions, confirmDelete: (rows: Conversation[]) => void, done: () => void): MenuItem[] {
  const n = rows.length;
  const unread = rows.every((r) => r.unread);
  const archived = rows.every((r) => r.archived);
  const run = (fn: () => Promise<void>) => () => void fn().then(done);
  return [
    { kind: "head", label: `${n} selected` },
    unread
      ? { label: `Mark ${n} as read`, run: run(() => actions.patchMany(rows, { unread: false }, `Marked ${n} as read.`)), testid: "batch-read" }
      : { label: `Mark ${n} as unread`, run: run(() => actions.patchMany(rows, { unread: true }, `Marked ${n} as unread.`)), testid: "batch-read" },
    { label: `Move ${n} to project`, run: () => undefined, disabled: MOVE_MANY_OFF },
    archived
      ? { label: `Restore ${n}`, run: run(() => actions.patchMany(rows, { archived: false }, `Restored ${n} conversations.`)), testid: "batch-archive" }
      : { label: `Archive ${n}`, run: run(() => actions.patchMany(rows, { archived: true, snoozedUntil: null, pinned: false }, `Archived ${n} conversations.`, { archived: false })), testid: "batch-archive" },
    { kind: "sep" },
    { label: `Delete ${n}…`, danger: true, run: () => confirmDelete(rows), testid: "batch-delete" },
  ];
}
