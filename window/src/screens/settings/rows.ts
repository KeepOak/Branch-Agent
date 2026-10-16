// The Settings row table: every row the R1 Settings pages draw, as data. A row names where its value lives (an engine
// config path, a users.prefs entry, the person's look) or what it waits for (Coming), and one renderer and one hook
// (useRow) draw and save it. Labels, help and the Advanced level come from the engine's config.schema uiHints; a row
// carries its own label only where the owner's plain words differ.
import type { DesktopControlName } from "../../connect/desktop-controls";
import type { Level, PageId } from "./nav";
import { ACCOUNTS_ROWS } from "./pages/accounts";
import { APPEARANCE_ROWS } from "./pages/appearance";
import { CUSTOMIZE_ROWS } from "./pages/customize";
import { GENERAL_ROWS } from "./pages/general";

export type RowSource =
  /** An engine config path: config.get, saved with config.patch through the window's one config store. */
  | { kind: "config"; path: string }
  /** A users.prefs entry of the person (follows them to every device). */
  | { kind: "pref"; key: string }
  /** A key of the person's look (users.prefs "ui.window.look"), or a device key such as text size, via the look store. */
  | { kind: "look"; key: string }
  /** A choice this window keeps in its own storage (localStorage), such as the delete dialog's "Ask before deleting". */
  | { kind: "device"; key: string }
  /** A switch of the Branch app on this computer (the desktop bridge's controls), such as starting with the computer. */
  | { kind: "desktop"; name: DesktopControlName }
  /** Nothing to call yet: drawn as Coming with the call it waits for. */
  | { kind: "coming"; need: string; reason: string }
  /** Drawn by its page's own control (slots.ts PageSlot.controls), which makes these engine calls and declares each
   *  one; a frame without that control draws the row as Coming with this reason. */
  | { kind: "slot"; calls: string[]; reason: string };

/** "button": a Coming row whose control is one button (its words in Row.button), as the preview draws it. */
export type Control = "toggle" | "segmented" | "select" | "number" | "text" | "secret" | "button" | "custom";
export type RowOption = { v: string | number | boolean; label: string };
/** Converts between what is stored and what the control shows (for example "on"/"off" and a toggle). */
export type Codec = { read: (stored: unknown) => unknown; write: (shown: unknown) => unknown };

export type Row = {
  /** Stable: "<page>.<card>.<slug>". */
  id: string;
  page: PageId;
  /** The card (section) title on its page, as in nav.ts PAGES. */
  card: string;
  /** Falls back to the schema label of a config path. */
  label?: string;
  help?: string;
  /** 0 Regular, 1 Advanced, 2 Technical. A schema hint marked advanced puts a row at Advanced at least. */
  level: Level;
  /** The owner placed this row at its level: the schema's advanced mark doesn't move it (a row over a whole object,
   *  such as Show agents' work over agents.defaults, would otherwise take the object's mark). */
  ownerLevel?: true;
  control: Control;
  /** Segmented only for 2 to 4 options; longer lists are a select. */
  options?: RowOption[];
  unit?: string;
  /** The words on a "button" row's button. */
  button?: string;
  source: RowSource;
  codec?: Codec;
  /** The value shown when nothing is stored and the schema has no default. */
  fallback?: unknown;
  /** A slot row whose control is a list that names its own items (computers, connections): drawn without the row's own
   *  label and help, which still name it for search and the level. */
  bare?: true;
};

/** One config.schema uiHints entry. */
export type UiHint = { label?: string; help?: string; tags?: string[]; group?: string; order?: number; advanced?: boolean; sensitive?: boolean; placeholder?: string };
export type UiHints = Record<string, UiHint>;

/** The hint for a path: its own entry, or one whose "*" segments match (channels.*.enabled). */
export function hintFor(hints: UiHints, path: string): UiHint | undefined {
  if (Object.hasOwn(hints, path)) return hints[path];
  const keys = path.split(".");
  for (const [pattern, hint] of Object.entries(hints)) {
    const parts = pattern.split(".");
    if (parts.length === keys.length && parts.every((part, i) => part === "*" || part === keys[i])) return hint;
  }
  return undefined;
}

const hintOf = (row: Row, hints: UiHints) => (row.source.kind === "config" ? hintFor(hints, row.source.path) : undefined);

/** The words a row shows: the owner's label, else the schema's, else the last part of its key. */
export function rowLabel(row: Row, hints: UiHints): string {
  if (row.label) return row.label;
  const hint = hintOf(row, hints);
  if (hint?.label) return hint.label;
  const src = row.source;
  const key = src.kind === "config" ? src.path : src.kind === "coming" || src.kind === "slot" ? row.id : src.kind === "desktop" ? src.name : src.key;
  return key.split(".").pop() ?? key;
}
export const rowHelp = (row: Row, hints: UiHints): string | undefined => row.help ?? hintOf(row, hints)?.help;

/** The level a row shows at: its own, raised to Advanced when the schema marks the key advanced. */
export function rowLevel(row: Row, hints: UiHints): Level {
  return !row.ownerLevel && hintOf(row, hints)?.advanced && row.level < 1 ? 1 : row.level;
}

/** "How much to show" that first shows what waits for a later update: Regular shows only what works today. */
export const COMING_FROM: Level = 1;

/** A row that waits for a later update: Coming by its source, or (when the page's controls are given) a slot row its
 *  page has no control for, which RowView draws as Coming. */
export function comingRow(row: Row, controls?: Readonly<Record<string, unknown>>): boolean {
  return row.source.kind === "coming" || (controls !== undefined && row.source.kind === "slot" && !controls[row.id]);
}

/** The level a row first shows at: its own, and at least Advanced while it is Coming (Regular hides Coming rows). Its
 *  Advanced or Technical tag still comes from rowLevel. */
export function shownLevel(row: Row, hints: UiHints, controls?: Readonly<Record<string, unknown>>): Level {
  const level = rowLevel(row, hints);
  return comingRow(row, controls) && level < COMING_FROM ? COMING_FROM : level;
}

/** Every row of the R1 Settings pages. Pages add their list here. */
export const ROWS: Row[] = [...GENERAL_ROWS, ...ACCOUNTS_ROWS, ...APPEARANCE_ROWS, ...CUSTOMIZE_ROWS];

/** The rows of one card at this level, in table order. A row above the level is hidden, and so is a Coming row at
 *  Regular. */
export function cardRows(page: PageId, card: string, level: Level, hints: UiHints, rows: Row[] = ROWS, controls?: Readonly<Record<string, unknown>>): Row[] {
  return rows.filter((row) => row.page === page && row.card === card && shownLevel(row, hints, controls) <= level);
}

/** The lowest level at which a page shows a row, or null when the table has none for it. */
export function pageFirstLevel(page: PageId, hints: UiHints, rows: Row[] = ROWS, controls?: Readonly<Record<string, unknown>>): Level | null {
  const levels = rows.filter((row) => row.page === page).map((row) => shownLevel(row, hints, controls));
  return levels.length ? (Math.min(...levels) as Level) : null;
}
