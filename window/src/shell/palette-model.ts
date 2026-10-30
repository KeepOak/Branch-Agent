// Find anything (DESIGN-SPEC §4.1.7): the grouped rows and how typing filters them. Pure, so it is tested.
export type PaletteRow = {
  id: string;
  group: string;
  label: string;
  hint: string;
  run: () => void;
  whenTyping?: boolean;
  /** Other words that find this row (a page's row names, or what it is for), matched like the label. */
  keywords?: string;
  /** One line under the label, such as a Trunk's description. */
  detail?: string;
  /** Words to draw in bold inside the label (a message search). */
  mark?: string;
  /** Line under a message hit, such as "You to Oak · 6d ago". */
  meta?: string;
};

/** The groups in order; while typing, Messages and Trunks follow Settings. */
export const GROUPS = ["Actions", "Conversations", "Places", "Settings", "Messages", "Trunks"];

/** The empty list copy (preview palRender). Hidden while a message search is still pending. */
export const PALETTE_NONE = "Nothing matches. Try a Trunk’s name or a setting.";

/** How well a row's label matches the query: exact title first, then a title that starts with it, then anything else. */
function rank(row: PaletteRow, q: string): number {
  const label = row.label.toLowerCase();
  if (label === q) return 0;
  return label.startsWith(q) ? 1 : 2;
}

/** Rows whose label, hint or keywords match the text (substring, any case). Exact titles rank first; groups keep their order within a rank. */
export function filterPalette(rows: PaletteRow[], query: string): PaletteRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows].sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
  const matched = rows.filter((r) => r.label.toLowerCase().includes(q) || r.hint.toLowerCase().includes(q) || (r.keywords ?? "").toLowerCase().includes(q));
  return matched.sort((a, b) => rank(a, q) - rank(b, q) || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
}

/** One state at a time: Searching… owns the empty list until the message search finishes. */
export function paletteEmptyLine(shown: number, searching: boolean): string | null {
  return searching || shown > 0 ? null : PALETTE_NONE;
}

/** Splits a snippet so each searched word can be drawn in bold. Overlapping words merge into one run. */
export function paletteBoldParts(text: string, query: string): { text: string; hit: boolean }[] {
  const words = [...new Set(query.trim().toLowerCase().split(/\s+/).filter((word) => word.length > 0))];
  if (words.length === 0) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const word of words) {
    let from = 0;
    for (let at = lower.indexOf(word, from); at !== -1; at = lower.indexOf(word, from)) {
      ranges.push([at, at + word.length]);
      from = at + word.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (!last || range[0] > last[1]) merged.push(range);
    else last[1] = Math.max(last[1], range[1]);
  }
  const parts: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

/** A short age for a message hit: "6d ago", "2h ago", "just now". Empty when the time is missing. */
export function shortAgo(at: number, now: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  const delta = now - at;
  if (delta < 0) return "";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  return `${Math.max(1, Math.round(days / 30))}mo ago`;
}

/** The line under a message hit. X is who the conversation is with. */
export function messageMetaLine(name: string, at: number, now: number): string {
  const who = name.trim() || "them";
  const when = shortAgo(at, now);
  return when ? `You to ${who} · ${when}` : `You to ${who}`;
}

/** Up and Down move the selection and never go past the first or last row (§4.1.7 rule 2). */
export function moveSelection(index: number, step: number, count: number): number {
  if (count === 0) {
    return 0;
  }
  return Math.min(count - 1, Math.max(0, index + step));
}
