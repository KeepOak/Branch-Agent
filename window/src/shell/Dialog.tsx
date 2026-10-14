import { useOverlayFocus } from "../overlays/useOverlayFocus";
import { useRef, type ReactNode } from "react";
import { Icon } from "./icons";
import "../glass/glass.css";

// Dialogs (DESIGN-SPEC §5.5): scrim with 2 px blur, glass surface, 17 px title with ×, a body grid and a
// right-aligned footer with at most one filled button (none when the dialog only shows things). Escape and × close; focus stays inside and returns.
// clear: the item 48 glass model (README 48): the dialog is clear glass and its title and controls sit on frosted pills (glass.css).
type Props = { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testid?: string; clear?: boolean };

export function Dialog({ title, onClose, children, footer, wide, testid, clear }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlayFocus(ref, onClose, { modal: true, initial: ".dlg-b input, .dlg-f button:last-child, .dlg-h button" });
  return (
    <div className="scrim in17" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={["dlg", wide && "wide", clear && "g-clear"].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-label={title} data-testid={testid} tabIndex={-1}>
        <div className="dlg-h">
          <h2 className={clear ? "g-label" : undefined}>{title}</h2>
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
