import { Children, Fragment, isValidElement, useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./icons";

// Dialogs (DESIGN-SPEC §5.5): scrim with 2 px blur, glass surface, 17 px title with ×, a body grid and a
// right-aligned footer with at most one filled button (none when the dialog only shows things). Escape and × close; focus stays inside and returns.
type Props = { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; testid?: string };

/** The header X already closes the dialog, so a footer Close is a duplicate action. */
function footerActions(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [child];
    if (child.type === Fragment) return footerActions(child.props.children);
    return child.props.children === "Close" ? [] : [child];
  });
}

export function Dialog({ title, onClose, children, footer, wide, testid }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const actions = footerActions(footer);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("[autofocus], .dlg-b input, .dlg-f button:last-child, .dlg-h button");
    first?.focus();
    return () => back?.focus?.();
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") {
      return;
    }
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input, select, textarea, [tabindex='0']") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && i <= 0) {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (!e.shiftKey && i === items.length - 1) {
      e.preventDefault();
      items[0]?.focus();
    }
  };
  return (
    <div className="scrim in17" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={wide ? "dlg wide" : "dlg"} role="dialog" aria-modal="true" aria-label={title} data-testid={testid} onKeyDown={trap}>
        <div className="dlg-h">
          <h2>{title}</h2>
          <button type="button" className="ib" aria-label="Close" title="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <div className="dlg-b">{children}</div>
        {actions.length ? <div className="dlg-f">{actions}</div> : null}
      </div>
    </div>
  );
}
