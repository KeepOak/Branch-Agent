import { useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react";

export type SidebarDrop = { source: string; target: string; after: boolean };

/** One pointer path for sidebar drops. A later group drop can use the same source/target contract. */
export function useSidebarPointerDrag(onDrop: (drop: SidebarDrop) => void, rail: boolean) {
  const active = useRef<{ id: number; source: string; x: number; y: number; moved: boolean; touch: boolean; timer?: number } | null>(null);
  const suppressClick = useRef(false);
  const clearMarks = () => document.querySelectorAll(".pin-drop-before, .pin-drop-after").forEach((el) => el.classList.remove("pin-drop-before", "pin-drop-after"));
  const targetAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pin-key]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { target: el.dataset.pinKey!, after: rail ? y > r.top + r.height / 2 : x > r.left + r.width / 2, el };
  };
  const cancel = () => {
    if (active.current?.timer) window.clearTimeout(active.current.timer);
    active.current = null;
    clearMarks();
  };
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const source = (e.target as Element).closest<HTMLElement>("[data-pin-key]");
      if (!source || source.dataset.pinFixed === "true" || (e.target as Element).closest(".pin-more")) return;
      const drag = { id: e.pointerId, source: source.dataset.pinKey!, x: e.clientX, y: e.clientY, moved: false, touch: e.pointerType === "touch", timer: undefined as number | undefined };
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
      clearMarks();
      const target = targetAt(e.clientX, e.clientY);
      if (target && target.target !== drag.source) target.el.classList.add(target.after ? "pin-drop-after" : "pin-drop-before");
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const drag = active.current;
      if (!drag || drag.id !== e.pointerId) return;
      const target = drag.moved ? targetAt(e.clientX, e.clientY) : null;
      cancel();
      if (drag.moved) suppressClick.current = true;
      if (target && target.target !== drag.source) onDrop({ source: drag.source, target: target.target, after: target.after });
    },
    onPointerCancel: cancel,
    onClickCapture: (e: ReactMouseEvent<HTMLElement>) => {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

export function reorderedPins(order: readonly string[], source: string, target: string, after: boolean): string[] {
  if (source === target || !order.includes(source) || !order.includes(target)) return [...order];
  const next = order.filter((key) => key !== source);
  next.splice(next.indexOf(target) + Number(after), 0, source);
  return next;
}
