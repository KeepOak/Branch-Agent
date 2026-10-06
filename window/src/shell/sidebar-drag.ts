import { useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

export type DropZone = "before" | "after" | "onto";
export type SidebarDrop = { source: string; target: string; zone: DropZone };
export type SidebarDragOptions = {
  itemAttribute: string;
  ignoreSelector: string;
  axis: "x" | "y";
  dropZones: readonly DropZone[];
};

/** Divide an item's projected length equally among its allowed drop zones. */
export function dropZoneAt(position: number, start: number, length: number, zones: readonly DropZone[]): DropZone | null {
  if (!zones.length) return null;
  const fraction = Math.max(0, Math.min(0.999999, (position - start) / Math.max(1, length)));
  return zones[Math.floor(fraction * zones.length)];
}

/** Shared pointer path for pin ordering and contact-on-contact group drops. */
export function useSidebarPointerDrag(onDrop: (drop: SidebarDrop) => void, options: SidebarDragOptions) {
  const active = useRef<{ id: number; source: string; x: number; y: number; moved: boolean; touch: boolean; timer?: number; capture?: HTMLElement } | null>(null);
  const suppressClick = useRef(false);
  const marks = ["pin-drop-before", "pin-drop-after", "pin-drop-onto"];
  const clearMarks = () => document.querySelectorAll(marks.map((mark) => `.${mark}`).join(", ")).forEach((el) => el.classList.remove(...marks));
  const selector = `[${options.itemAttribute}]`;
  const itemAt = (element: Element | null) => element?.closest<HTMLElement>(selector) ?? null;
  const targetAt = (x: number, y: number) => {
    const el = itemAt(document.elementFromPoint(x, y));
    if (!el || el.matches(options.ignoreSelector)) return null;
    const target = el.getAttribute(options.itemAttribute);
    if (!target) return null;
    const r = el.getBoundingClientRect();
    const zone = dropZoneAt(options.axis === "y" ? y : x, options.axis === "y" ? r.top : r.left,
      options.axis === "y" ? r.height : r.width, options.dropZones);
    return zone ? { target, zone, el } : null;
  };
  const cancel = () => {
    const drag = active.current;
    if (drag?.timer) window.clearTimeout(drag.timer);
    active.current = null;
    if (drag?.capture?.hasPointerCapture?.(drag.id)) drag.capture.releasePointerCapture(drag.id);
    clearMarks();
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      cancel();
      suppressClick.current = false;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if ((e.target as Element).closest(options.ignoreSelector)) return;
      const source = itemAt(e.target as Element);
      const key = source?.getAttribute(options.itemAttribute);
      if (!source || !key || source.matches(options.ignoreSelector)) return;
      const drag = { id: e.pointerId, source: key, x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType === "touch", timer: undefined as number | undefined, capture: undefined as HTMLElement | undefined };
      active.current = drag;
      if (drag.touch) drag.timer = window.setTimeout(() => { if (active.current === drag) drag.moved = true; }, 350);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const drag = active.current;
      if (!drag || drag.id !== e.pointerId) return;
      const distance = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      if (!drag.moved && !drag.touch && distance >= 5) drag.moved = true;
      if (drag.touch && !drag.moved && distance > 8) { cancel(); return; }
      if (!drag.moved) return;
      if (!drag.capture) {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.capture = e.currentTarget;
      }
      clearMarks();
      const target = targetAt(e.clientX, e.clientY);
      if (target && target.target !== drag.source) target.el.classList.add(`pin-drop-${target.zone}`);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const drag = active.current;
      if (!drag || drag.id !== e.pointerId) return;
      const target = drag.moved ? targetAt(e.clientX, e.clientY) : null;
      cancel();
      if (drag.moved) suppressClick.current = true;
      if (target && target.target !== drag.source) onDrop({ source: drag.source, target: target.target, zone: target.zone });
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

export function reorderedPins(order: readonly string[], source: string, target: string, zone: DropZone): string[] {
  if (source === target || zone === "onto" || !order.includes(source) || !order.includes(target)) return [...order];
  const next = order.filter((key) => key !== source);
  next.splice(next.indexOf(target) + Number(zone === "after"), 0, source);
  return next;
}
