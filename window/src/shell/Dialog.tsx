import { useOverlayFocus } from "../overlays/useOverlayFocus";
import { useRef, type ReactNode } from "react";
import { Icon } from "./icons";

// Dialogs (DESIGN-SPEC §5.5): scrim with 2 px blur, glass surface, 17 px title with ×, a body grid and a
// right-aligned footer with at most one filled button (none when the dialog only shows things). Escape and × close; focus stays inside and returns.
type Props = { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testid?: string };

export function Dialog({ title, onClose, children, footer, wide, testid }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlayFocus(ref, onClose, { modal: true, initial: ".dlg-b input, .dlg-f button:last-child, .dlg-h button" });
  return (
    <div className="scrim in17" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={wide ? "dlg wide" : "dlg"} role="dialog" aria-modal="true" aria-label={title} data-testid={testid} tabIndex={-1}>
        <div className="dlg-h">
          <h2>{title}</h2>
          <button type="button" className="ib" aria-label="Close" title="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-b">{children}</div>
        {footer ? <div className="dlg-f">{footer}</div> : null}
      </div>
    </div>
  );
}
