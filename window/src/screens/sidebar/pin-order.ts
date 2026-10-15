// The Pinned order (Classic shell/use-pin-order.ts keeps it in users.prefs "ui.window.contactPinOrder"): the default
// Trunk first (the owner's rule: the main chat is always first and never reordered), then the saved order, then any pin the saved order doesn't name yet.
import type { SideRow } from "./model";

/** What the saved order names a pin by: its conversation key, as Classic saves it (WindowShell's visible pins), so both
 *  windows share one order. A pin without a conversation falls back to its contact id. */
export const pinKey = (row: SideRow): string => row.key ?? row.id;

export function orderPins(rows: readonly SideRow[], order: readonly string[]): SideRow[] {
  const rank = (row: SideRow) => (row.isDefault ? -1 : order.includes(pinKey(row)) ? order.indexOf(pinKey(row)) : order.length);
  return rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i).map(entry => entry.row);
}

/** The drag axis for the Pinned grid: a single column (the collapsed rail) reads before and after from the pointer's
 *  height, as Classic does in rail mode; a grid of 2 to 4 columns reads them across. */
export function pinAxis(grid: HTMLElement | null): "x" | "y" {
  if (!grid) return "x";
  const columns = getComputedStyle(grid).gridTemplateColumns.trim();
  return columns && columns !== "none" && columns.split(/\s+/).length === 1 ? "y" : "x";
}
