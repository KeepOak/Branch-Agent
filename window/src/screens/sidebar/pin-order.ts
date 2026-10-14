// The Pinned order (Classic shell/use-pin-order.ts keeps it in users.prefs "ui.window.contactPinOrder"): the default
// Trunk first (the owner's rule: the main chat is always first and never reordered), then the saved order, then any pin the saved order doesn't name yet.
import type { SideRow } from "./model";

export function orderPins(rows: readonly SideRow[], order: readonly string[]): SideRow[] {
  const rank = (row: SideRow) => (row.isDefault ? -1 : order.includes(row.id) ? order.indexOf(row.id) : order.length);
  return rows.map((row, i) => ({ row, i })).sort((a, b) => rank(a.row) - rank(b.row) || a.i - b.i).map(entry => entry.row);
}
