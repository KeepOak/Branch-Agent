import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { shownWhy } from "./shown-why";
import "./menu.css";

// Glass menus (DESIGN-SPEC §5.4): opened at a point, Up/Down move, a letter runs its row, Right opens a
// submenu, Left or Escape closes; focus returns to what opened it.
export type MenuItem =
  | { kind?: "item"; label: string; run: () => void; letter?: string; hint?: string; danger?: boolean; disabled?: string; testid?: string; icon?: ReactNode; sub?: string; checked?: boolean; radio?: boolean }
  | { kind: "sub"; label: string; items: MenuItem[]; letter?: string; hint?: string; testid?: string; icon?: ReactNode; hover?: boolean }
  | { kind: "sep" }
  | { kind: "head"; label: string }
  | { kind: "info"; label: string; sub?: string; checked?: boolean; icon?: ReactNode }
  /** Controls drawn inside the menu (the Icon and colour grids); they keep the menu open. */
  | { kind: "custom"; node: ReactNode };

export type MenuAnchor = { x: number; y: number };

/** `upward`: `at` is the top of what opened it (a status-bar item); the menu opens above that point. */
type Props = { at: MenuAnchor; items: MenuItem[]; onClose: () => void; label: string; testid?: string; upward?: boolean };

const focusables = (el: HTMLElement | null) => Array.from(el?.querySelectorAll<HTMLButtonElement>(":scope > button.mi:not([disabled])") ?? []);

function useFitInWindow(ref: React.RefObject<HTMLDivElement | null>, at: MenuAnchor, upward = false) {
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const r = el.getBoundingClientRect();
    const y = upward ? at.y - r.height - 6 : at.y;
    setPos({ x: Math.max(8, Math.min(at.x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) });
  }, [ref, at, upward]);
  return pos;
}

function moveFocus(el: HTMLElement | null, step: number) {
  const list = focusables(el);
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  list[(i + step + list.length) % list.length]?.focus();
}

export function Menu({ at, items, onClose, label, testid, upward }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ index: number; at: MenuAnchor } | null>(null);
  const pos = useFitInWindow(ref, at, upward);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const trigger = back && back !== document.body ? back : null;
    focusables(ref.current)[0]?.focus();
    const away = (e: PointerEvent) => {
      // The button that opened the menu toggles it on its own click (§5.4 behaviour 1).
      if (!(e.target as Element).closest?.(".pop") && !trigger?.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", away, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      // Focus returns to the opener unless what the menu ran already moved it (for example a rename field).
      const now = document.activeElement;
      if (!now || now === document.body || ref.current?.contains(now)) {
        back?.focus?.();
      }
    };
  }, [onClose]);

  const openSub = (index: number, button: HTMLElement) => {
    const r = button.getBoundingClientRect();
    setSub({ index, at: { x: r.right + 4, y: r.top - 6 } });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(ref.current, e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const list = focusables(ref.current);
      (e.key === "Home" ? list[0] : list.at(-1))?.focus();
    } else if (e.key === "Escape" || e.key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const index = items.findIndex((it) => (it.kind === undefined || it.kind === "item" || it.kind === "sub") && it.letter === e.key.toLowerCase());
      const button = ref.current?.querySelector<HTMLButtonElement>(`:scope > button[data-index="${index}"]`);
      if (index >= 0 && button && !button.disabled) {
        e.preventDefault();
        button.click();
      }
    }
  };
  return (
    <>
      <div ref={ref} className="pop menu in17" role="menu" aria-label={label} data-testid={testid} style={{ left: pos.x, top: pos.y }} onKeyDown={onKey}>
        {items.map((it, i) => renderItem(it, i, onClose, openSub, sub?.index === i))}
      </div>
      {sub ? <SubMenu parent={items[sub.index]} at={sub.at} onClose={() => setSub(null)} onDone={onClose} /> : null}
    </>
  );
}

function SubMenu({ parent, at, onClose, onDone }: { parent: MenuItem; at: MenuAnchor; onClose: () => void; onDone: () => void }) {
  if (parent.kind !== "sub") {
    return null;
  }
  const wrap = parent.items.map((it): MenuItem => (it.kind === undefined || it.kind === "item" ? { ...it, run: () => (it.run(), onDone()) } : it));
  return <Menu at={at} items={wrap} onClose={onClose} label={parent.label} />;
}

function renderItem(it: MenuItem, i: number, onClose: () => void, openSub: (i: number, el: HTMLElement) => void, subOpen: boolean): ReactNode {
  if (it.kind === "sep") {
    return <hr key={i} className="msep" />;
  }
  if (it.kind === "info") {
    return (
      <div key={i} className="mi info" role="presentation">
        {it.icon ? <span className="mi-face">{it.icon}</span> : <span className="mi-tick">{it.checked ? "✓" : ""}</span>}
        <span className="mi-text">
          <span>{it.label}</span>
          {it.sub ? <small className="mi-s">{it.sub}</small> : null}
        </span>
      </div>
    );
  }
  if (it.kind === "custom") {
    return <div key={i} className="mcustom">{it.node}</div>;
  }
  if (it.kind === "head") {
    return (
      <div key={i} className="ph">
        {it.label}
      </div>
    );
  }
  if (it.kind === "sub") {
    return (
      <button key={i} type="button" role="menuitem" aria-haspopup="menu" aria-expanded={subOpen} className="mi" data-index={i} data-testid={it.testid}
        onMouseEnter={it.hover === false ? undefined : (e) => openSub(i, e.currentTarget)}
        onClick={(e) => openSub(i, e.currentTarget)}
        onKeyDown={(e) => e.key === "ArrowRight" && (e.preventDefault(), openSub(i, e.currentTarget))}>
        {it.icon ? <i className="mi-ico" aria-hidden="true">{it.icon}</i> : null}
        <span>{it.label}</span>
        <span className="mi-hint">{it.hint ? `${it.hint} ` : ""}›</span>
      </button>
    );
  }
  return (
    <button key={i} type="button" role={it.checked !== undefined ? it.radio ? "menuitemradio" : "menuitemcheckbox" : "menuitem"} aria-checked={it.checked} className={it.danger ? "mi bad" : "mi"} data-index={i} data-testid={it.testid} disabled={Boolean(it.disabled)} title={shownWhy(it.disabled)}
      onClick={() => {
        onClose();
        it.run();
      }}>
      {it.icon ? <i className="mi-ico" aria-hidden="true">{it.icon}</i> : null}
      {it.checked !== undefined ? <span className="mi-tick" aria-hidden="true">{it.checked ? "✓" : ""}</span> : null}
      {it.sub ? (
        <span className="mi-text">
          <span>{it.label}</span>
          <small className="mi-s">{it.sub}</small>
        </span>
      ) : (
        <span>{it.label}</span>
      )}
      {it.hint ? <span className="mi-hint">{it.hint}</span> : it.letter ? <span className="mi-hint"><kbd className="mi-key">{it.letter}</kbd></span> : null}
    </button>
  );
}
