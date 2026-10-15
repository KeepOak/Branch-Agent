// Find anything (DESIGN-SPEC §4.1.7): the grouped rows and how typing filters them. Pure, so it is tested.
export type PaletteRow = { id: string; group: string; label: string; hint: string; run: () => void; whenTyping?: boolean };

/** The groups in order; while typing, Messages and Trunks follow Settings. */
export const GROUPS = ["Actions", "Conversations", "Places", "Settings", "Messages", "Trunks"];

/** The empty list copy (preview palRender). Hidden while a message search is still pending. */
export const PALETTE_NONE = "Nothing matches. Try a Trunk’s name or a setting.";

/** Rows that match the text on their label or hint (substring, any case); groups keep their order. */
export function filterPalette(rows: PaletteRow[], query: string): PaletteRow[] {
  const q = query.trim().toLowerCase();
  const matched = q ? rows.filter((r) => r.label.toLowerCase().includes(q) || r.hint.toLowerCase().includes(q)) : rows;
  return [...matched].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
}

/** One state at a time: Searching… owns the empty list until the message search finishes. */
export function paletteEmptyLine(shown: number, searching: boolean): string | null {
  return searching || shown > 0 ? null : PALETTE_NONE;
}

/** Up and Down move the selection and never go past the first or last row (§4.1.7 rule 2). */
export function moveSelection(index: number, step: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  return Math.min(count - 1, Math.max(0, index + step));
}
