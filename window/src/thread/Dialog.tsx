import { useOverlayFocus } from "../overlays/useOverlayFocus";
// A dialog (DESIGN-SPEC §5.5): scrim, glass panel, title with ×, body and a footer with one filled action.
// Escape and × close it; focus moves in on open and returns to the opener on close.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, ICONS } from "./icons";

/** clear: the R1 window's item 48 glass (README 48): the panel is clear glass (.g-clear) and its title sits on a frosted pill. */
export function Dialog({ title, onClose, children, footer, testid, clear }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; testid?: string; clear?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useOverlayFocus(panel, onClose, { modal: true, initial: "textarea, input, select, button:not(.dlg-x)" });
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={clear ? "dlg g-clear" : "dlg"} role="dialog" tabIndex={-1} aria-modal="true" aria-label={title} ref={panel} data-testid={testid}>
        <div className="dlg-h">
          <h2 className={clear ? "g-label" : undefined}>{title}</h2>
          <button type="button" className="icon-btn dlg-x" aria-label="Close" title="Close" onClick={onClose}>
            <Icon d={ICONS.x} size={16} />
          </button>
        </div>
        <div className="dlg-b">{children}</div>
        <div className="dlg-f">{footer}</div>
      </div>
    </div>
  );
}

/** A glass menu or popover (§5.4), anchored under its button; Escape and a click outside close it. */
export function Popover({ onClose, children, label, align = "right", anchor }: { onClose: () => void; children: ReactNode; label: string; align?: "left" | "right"; anchor?: HTMLElement | null }) {
  const box = useRef<HTMLDivElement>(null);
  useOverlayFocus(box, onClose, { trigger: anchor });
  const [measuredHeight, setMeasuredHeight] = useState(0);
  useLayoutEffect(() => {
    const menu = box.current;
    if (!menu) return;
    const measure = () => setMeasuredHeight(menu.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(menu);
    return () => observer?.disconnect();
  }, [children]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);
  const rect = anchor?.getBoundingClientRect();
  const width = Math.min(340, Math.max(220, window.innerWidth - 16));
  const left = rect ? Math.max(8, Math.min(window.innerWidth - width - 8, align === "right" ? rect.right - width : rect.left)) : 0;
  const height = Math.min(measuredHeight || 460, window.innerHeight - 16);
  const top = rect ? (window.innerHeight - rect.bottom < height && rect.top > window.innerHeight - rect.bottom
    ? Math.max(8, rect.top - height - 6)
    : Math.min(window.innerHeight - height - 8, rect.bottom + 6)) : 0;
  const popup = (
    <div className={`pop ${align}`} role="menu" tabIndex={-1} aria-label={label} ref={box}>
      {children}
    </div>
  );
  return rect ? createPortal(<div className="thread menu-portal" style={{ position: "fixed", left, top, width, zIndex: 1000 }}>
    {popup}
  </div>, document.body) : popup;
}
