// A dialog (DESIGN-SPEC §5.5): scrim, glass panel, title with ×, body and a footer with one filled action.
// Escape and × close it; focus moves in on open and returns to the opener on close.
import { useEffect, useRef, type ReactNode } from "react";
import { Icon, ICONS } from "./icons";

export function Dialog({ title, onClose, children, footer, testid }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; testid?: string }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("textarea, input, select, button:not(.dlg-x)");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      opener?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dlg" role="dialog" aria-modal="true" aria-label={title} ref={panel} data-testid={testid}>
        <div className="dlg-h">
          <h2>{title}</h2>
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
export function Popover({ onClose, children, label, align = "right" }: { onClose: () => void; children: ReactNode; label: string; align?: "left" | "right" }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    box.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div className={`pop ${align}`} role="menu" aria-label={label} ref={box}>
      {children}
    </div>
  );
}
