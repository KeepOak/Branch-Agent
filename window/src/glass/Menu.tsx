// Menu (HANDOFF §2 #8, preview `POPS.rowmenu` · `.rowMenuP17 .tilesP17 .tileP17` · `.mi`): up to four quick tiles in a
// grid, then rows. A row with a submenu replaces the content with a back row (the + menu's in-place pattern). Where the
// owner's spec has a divider, a row carries `gap` and gets a 6 px spacer, never a rule. A control that can't run says
// why: a tile shows its reason as a second line, a row as its hint. Arrow keys move, a row's letter runs it, Left or
// Backspace goes back. Every builder of items has a test that opens it (Pitfall 4).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type MenuEntry = {
  label: string;
  icon?: ReactNode;
  /** The shortcut letter, shown on the right and run by its key while the menu is open. */
  letter?: string;
  hint?: string;
  onSelect?: () => void;
  submenu?: MenuEntry[];
  danger?: boolean;
  /** Why it can't run: drawn disabled with this line, never hidden. */
  off?: string;
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

export function Menu({ label, tiles = [], rows, onClose }: MenuProps) {
  const [trail, setTrail] = useState<MenuEntry[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const page = trail.at(-1);
  const shownRows = page?.submenu ?? rows;
  const shownTiles = page ? [] : tiles.slice(0, 4);
  useEffect(() => { root.current?.querySelector<HTMLElement>(ITEMS)?.focus(); }, [trail.length]);
  const choose = (entry: MenuEntry) => {
    if (entry.off) return;
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
  const tip = (entry: MenuEntry) => entry.off ?? (entry.letter ? `${entry.label} (${entry.letter})` : undefined);
  return <div className="g-menu" role="menu" aria-label={page ? page.label : label} ref={root} onKeyDown={onKeyDown}>
    {page ? <button type="button" className="g-menu-row g-menu-back" data-menu-item onClick={() => setTrail(current => current.slice(0, -1))}>
      <span className="g-menu-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M14.5 6l-6 6 6 6" /></svg></span><span className="g-menu-label">{page.label}</span>
    </button> : null}
    {shownTiles.length ? <div className="g-menu-tiles" role="group" aria-label="Quick actions">
      {shownTiles.map(entry => <button key={entry.label} type="button" role="menuitem" className="g-menu-tile" data-menu-item data-off={entry.off ? "" : undefined}
        aria-disabled={entry.off ? "true" : undefined} aria-haspopup={entry.submenu ? "menu" : undefined} aria-keyshortcuts={entry.letter} title={tip(entry)} onClick={() => choose(entry)}>
        <span className="g-menu-ico" aria-hidden="true">{entry.icon}</span>
        <span className="g-menu-tile-label">{entry.label}{entry.submenu ? " ›" : ""}</span>
        {entry.off ? <small>{entry.off}</small> : null}
      </button>)}
    </div> : null}
    {shownRows.map(entry => <button key={entry.label} type="button" role={entry.toggle === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={entry.toggle} className="g-menu-row" data-menu-item data-gap={entry.gap ? "" : undefined} data-danger={entry.danger ? "" : undefined} data-sub={entry.submenu ? "" : undefined}
      aria-disabled={entry.off ? "true" : undefined} aria-haspopup={entry.submenu ? "menu" : undefined} aria-keyshortcuts={entry.letter} title={entry.off} onClick={() => choose(entry)}
      onKeyDown={event => { if (event.key === "ArrowRight" && entry.submenu) { event.preventDefault(); choose(entry); } }}>
      <span className="g-menu-ico" aria-hidden="true">{entry.icon}</span>
      <span className="g-menu-label">{entry.label}{entry.off ? <small>{entry.off}</small> : null}</span>
      <span className="g-menu-end">{entry.hint && !entry.off ? <small>{entry.hint}</small> : null}{entry.letter ? <kbd>{entry.letter}</kbd> : null}{entry.toggle !== undefined ? <i className="g-menu-switch" data-on={entry.toggle || undefined} aria-hidden="true" /> : null}{entry.submenu ? <Chevron /> : null}</span>
    </button>)}
  </div>;
}
