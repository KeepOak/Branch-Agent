import { useOverlayFocus } from "../overlays/useOverlayFocus";
// A glass menu anchored above its composer button (DESIGN-SPEC §5.4): Escape and a click outside close it,
// the button toggles it, and it animates in only on a fresh open (§6.6 rule 3).
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

type Props = {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  className?: string;
  align?: "left" | "right";
  children: ReactNode;
};

export function Popover({ anchor, onClose, label, className, align = "left", children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlayFocus(ref, onClose, { trigger: anchor.current, initial: "input:not([type=hidden])" });
  const [pos, setPos] = useState<{ left?: number; right?: number; top?: number }>({});

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // A menu whose content arrives after it opens (the tools list) grows; place it again so it stays inside the window.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => place(el));
    observer?.observe(el);
    place(el);
    return () => observer?.disconnect();
  }, [anchor, align]);

  function place(el: HTMLDivElement) {
    const a = anchor.current;
    const host = el.offsetParent as HTMLElement | null;
    if (!a || !host) return;
    const hostBox = host.getBoundingClientRect();
    const box = a.getBoundingClientRect();
    if (window.innerWidth <= 480) {
      // app-latest openPop: narrow menus fill the viewport between 8px edges. Prefer below the
      // anchor, then above when it fits; otherwise clamp to the visible viewport. Our absolute
      // menu is inside the composer, so translate the preview's viewport position into its host.
      const height = el.offsetHeight;
      const below = box.bottom + 6;
      const above = box.top - height - 6;
      const top = below + height > window.innerHeight - 8 && above > 8
        ? above
        : Math.max(8, Math.min(below, window.innerHeight - height - 8));
      setPos({ left: 8 - hostBox.left, top: top - hostBox.top });
    } else if (align === "right") {
      setPos({ right: Math.max(0, hostBox.right - box.right) });
    } else {
      // The menu starts at its button and stays inside the window (the preview's openPop), not inside the box.
      const left = Math.max(8, Math.min(box.left, window.innerWidth - 8 - el.offsetWidth)) - hostBox.left;
      setPos({ left });
    }
  }

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
    };
  }, [anchor, onClose]);

  return (
    <div ref={ref} className={`c-pop in17 ${className ?? ""}`} role="dialog" tabIndex={-1} aria-label={label} style={pos} onKeyDown={(event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const buttons = [...ref.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []].filter((button) => button.offsetParent !== null || button.getClientRects().length > 0);
      if (!buttons.length) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      {children}
    </div>
  );
}

/** Arrow keys move between a menu's items (§5.4 behaviour 4). */
export function moveFocus(container: HTMLElement | null, dir: 1 | -1): void {
  if (!container) return;
  const items = [...container.querySelectorAll<HTMLElement>("[data-mi]:not([disabled])")];
  if (items.length === 0) return;
  const at = items.indexOf(document.activeElement as HTMLElement);
  items[(at + dir + items.length) % items.length].focus();
}
