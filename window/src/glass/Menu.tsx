// Menu (HANDOFF §2 #8, preview `POPS.rowmenu` · `.rowMenuP17 .tilesP17 .tileP17` · `.mi`): up to four quick tiles in a
// grid, then rows. A row with a submenu replaces the content with a back row (the + menu's in-place pattern). Where the
// owner's spec has a divider, a row carries `gap` and gets a 6 px spacer, never a rule. A control that can't run says
// why: a tile shows its reason as a second line, a row as its hint. Arrow keys move, a row's letter runs it, Left or
// Backspace goes back. Every builder of items has a test that opens it (Pitfall 4).
// The Coming contract (R1-10): an entry that calls the engine names the method in `need`; when this engine lacks it the
// entry turns to Coming (greyed, its reason as the line, nothing runs, listed by the dev check). An entry the window
// hasn't wired yet keeps its `off` line and still names the method. An entry that only moves around the window is `local`.
import { cloneElement, useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { availability, useCapabilityEngine, useCapabilityVersion } from "../connect/capabilities";
import { Coming } from "./coming";
import { COMING_REASON } from "./coming-registry";

export type MenuEntry = {
  label: string;
  icon?: ReactNode;
  /** The shortcut letter, shown on the right and run by its key while the menu is open. */
  letter?: string;
  hint?: string;
  onSelect?: () => void;
  submenu?: MenuEntry[];
  danger?: boolean;
  /** Why it can't run: drawn disabled with this line, never hidden. With `need`, the window hasn't wired that call yet. */
  off?: string;
  /** The engine method (or methods) onSelect calls. Missing from this engine: the entry is Coming. */
  need?: string | readonly string[];
  /** The line shown when `need` is missing (defaults to the Coming reason). */
  why?: string;
  /** The entry needs no engine call: it opens, copies or moves around the window. */
  local?: boolean;
  /** A 6 px spacer before this row (the spec's divider). */
  gap?: boolean;
  /** An on/off row: drawn as a checkbox item, runs onSelect and keeps the menu open. */
  toggle?: boolean;
};

export type MenuProps = { label: string; tiles?: MenuEntry[]; rows: MenuEntry[]; onClose: () => void };

const ITEMS = "[data-menu-item]:not([aria-disabled='true'])";
function move(root: HTMLElement | null, step: number) {
  const list = [...(root?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
  if (!list.length) return;
  const index = list.indexOf(document.activeElement as HTMLElement);
  list[(index + step + list.length) % list.length]?.focus();
}

const Chevron = () => <svg className="g-menu-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6" /></svg>;

const needsOf = (entry: MenuEntry): string[] => (entry.need === undefined ? [] : typeof entry.need === "string" ? [entry.need] : [...entry.need]);

export function Menu({ label, tiles = [], rows, onClose }: MenuProps) {
  const capability = useCapabilityEngine();
  useCapabilityVersion();
  const [trail, setTrail] = useState<MenuEntry[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const page = trail.at(-1);
  const shownRows = page?.submenu ?? rows;
  const shownTiles = page ? [] : tiles.slice(0, 4);
  useEffect(() => { root.current?.querySelector<HTMLElement>(ITEMS)?.focus(); }, [trail.length]);
  /** Why the entry can't run now: its own line, or the Coming reason when this engine lacks a call it needs. */
  const offOf = (entry: MenuEntry): string | undefined =>
    entry.off ?? (needsOf(entry).some(method => availability(capability, method) === "no") ? entry.why ?? COMING_REASON : undefined);
  /** Wraps an item in its contract: Coming when it names a call, data-local when it needs none. */
  const declare = (entry: MenuEntry, item: ReactElement, key: string) => {
    const need = needsOf(entry);
    if (need.length) return <Coming key={key} need={need} reason={offOf(entry)} unwired={Boolean(entry.off)} where={entry.label}>{item}</Coming>;
    return cloneElement(item, { key, "data-local": entry.local || entry.submenu ? "" : undefined } as Record<string, unknown>);
  };
  const choose = (entry: MenuEntry) => {
    if (offOf(entry)) return;
    if (entry.submenu) { setTrail(current => [...current, entry]); return; }
    if (entry.toggle !== undefined) { entry.onSelect?.(); return; }
    onClose();
    entry.onSelect?.();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); move(root.current, 1); }
    else if (event.key === "ArrowUp") { event.preventDefault(); move(root.current, -1); }
    else if ((event.key === "ArrowLeft" || event.key === "Backspace") && page) { event.preventDefault(); setTrail(current => current.slice(0, -1)); }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const hit = [...shownTiles, ...shownRows].find(entry => entry.letter === event.key.toLowerCase());
      if (hit) { event.preventDefault(); choose(hit); }
    }
  };
  const tip = (entry: MenuEntry) => offOf(entry) ?? (entry.letter ? `${entry.label} (${entry.letter})` : undefined);
  return <div className="g-menu" role="menu" aria-label={page ? page.label : label} ref={root} onKeyDown={onKeyDown}>
    {page ? <button type="button" className="g-menu-row g-menu-back" data-menu-item data-local="" onClick={() => setTrail(current => current.slice(0, -1))}>
      <span className="g-menu-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6" /></svg></span><span className="g-menu-label">{page.label}</span>
    </button> : null}
    {shownTiles.length ? <div className="g-menu-tiles" role="group" aria-label="Quick actions">
      {shownTiles.map(entry => { const off = offOf(entry); return declare(entry, <button type="button" role="menuitem" className="g-menu-tile" data-menu-item data-off={off ? "" : undefined}
        aria-disabled={off ? "true" : undefined} aria-haspopup={entry.submenu ? "menu" : undefined} aria-keyshortcuts={entry.letter} title={tip(entry)} onClick={() => choose(entry)}>
        <span className="g-menu-ico" aria-hidden="true">{entry.icon}</span>
        <span className="g-menu-tile-label">{entry.label}{entry.submenu ? " ›" : ""}</span>
        {off ? <small>{off}</small> : null}
      </button>, entry.label); })}
    </div> : null}
    {shownRows.map(entry => { const off = offOf(entry); return declare(entry, <button type="button" role={entry.toggle === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={entry.toggle} className="g-menu-row" data-menu-item data-gap={entry.gap ? "" : undefined} data-danger={entry.danger ? "" : undefined} data-sub={entry.submenu ? "" : undefined}
      aria-disabled={off ? "true" : undefined} aria-haspopup={entry.submenu ? "menu" : undefined} aria-keyshortcuts={entry.letter} title={off} onClick={() => choose(entry)}
      onKeyDown={event => { if (event.key === "ArrowRight" && entry.submenu) { event.preventDefault(); choose(entry); } }}>
      <span className="g-menu-ico" aria-hidden="true">{entry.icon}</span>
      <span className="g-menu-label">{entry.label}{off ? <small>{off}</small> : null}</span>
      <span className="g-menu-end">{entry.hint && !off ? <small>{entry.hint}</small> : null}{entry.letter ? <kbd>{entry.letter}</kbd> : null}{entry.toggle !== undefined ? <i className="g-menu-switch" data-on={entry.toggle || undefined} aria-hidden="true" /> : null}{entry.submenu ? <Chevron /> : null}</span>
    </button>, entry.label); })}
  </div>;
}
