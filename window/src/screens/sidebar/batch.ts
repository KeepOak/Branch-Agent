// The menu for several rows picked with Alt or Shift (the preview's batchMenuPA18), re-hosted from Classic
// shell/batch-menu.ts. Only the shape changes: Classic menu items become glass Menu entries, each naming the engine
// call it makes (R1-10), so an engine without it shows Coming.
import type { Conversation } from "../../connect/conversations";
import type { MenuEntry } from "../../glass/Menu";
import { batchMenuItems } from "../../shell/batch-menu";
import type { Actions } from "../../shell/conversation-actions";
import type { MenuItem } from "../../shell/Menu";

/** The call behind each Classic batch row, by its test id. */
const NEEDS: Readonly<Record<string, string>> = { "batch-read": "sessions.patchMany", "batch-archive": "sessions.patchMany", "batch-delete": "sessions.delete" };

/** Classic menu items as glass Menu entries: a line becomes the next row's gap, a heading becomes the menu's label. */
export function glassEntries(items: readonly MenuItem[]): { label: string | null; rows: MenuEntry[] } {
  let label: string | null = null, gap = false;
  const rows: MenuEntry[] = [];
  for (const item of items) {
    if (item.kind === "sep") { gap = true; continue; }
    if (item.kind === "head") { label ??= item.label; continue; }
    if (item.kind === "sub") {
      rows.push({ label: item.label, letter: item.letter, hint: item.hint, icon: item.icon, submenu: glassEntries(item.items).rows, ...(gap ? { gap } : {}) });
    } else if (item.kind === undefined || item.kind === "item") {
      const need = item.testid ? NEEDS[item.testid] : undefined;
      rows.push({
        label: item.label, letter: item.letter, hint: item.hint, icon: item.icon, danger: item.danger,
        ...(item.disabled ? { off: item.disabled } : { onSelect: item.run }),
        ...(need ? { need } : item.disabled ? {} : { local: true }),
        ...(gap ? { gap } : {}),
      });
    }
    gap = false;
  }
  return { label, rows };
}

export function batchEntries(rows: Conversation[], actions: Actions, confirmDelete: (rows: Conversation[]) => void, done: () => void) {
  return glassEntries(batchMenuItems(rows, actions, confirmDelete, done));
}
