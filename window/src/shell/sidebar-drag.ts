import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent, type KeyboardEvent as ReactKeyboardEvent, type TouchEvent as ReactTouchEvent } from "react";

export type DropZone = "before" | "after" | "onto";
export type SidebarDrop = { source: string; target: string; zone: DropZone };
export type SidebarDragOptions = {
  itemAttribute: string;
  ignoreSelector: string;
  axis: "x" | "y";
  dropZones: readonly DropZone[];
  zonesFor?: (source: string, target: string, element: HTMLElement) => readonly DropZone[];
  hint?: (drop: SidebarDrop) => string;
  onLongPress?: (source: string) => void;
};

/** Divide an item's projected length equally among its allowed drop zones. */
export function dropZoneAt(position: number, start: number, length: number, zones: readonly DropZone[]): DropZone | null {
  if (!zones.length) return null;
  const fraction = Math.max(0, Math.min(0.999999, (position - start) / Math.max(1, length)));
  return zones.length === 3 ? zones[fraction < .25 ? 0 : fraction > .75 ? 2 : 1] : zones[Math.floor(fraction * zones.length)];
}

/** Shared pointer path for pin ordering and contact-on-contact group drops. */
export function useSidebarPointerDrag(onDrop: (drop: SidebarDrop) => void, options: SidebarDragOptions) {
  const active = useRef<{ id: number; source: string; x: number; y: number; lastX: number; lastY: number; moved: boolean; touch: boolean; far: number; timer?: number; capture?: HTMLElement } | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const marks = ["pin-drop-before", "pin-drop-after", "pin-drop-onto", "pin-drop-duplicate"];
  const clearMarks = () => document.querySelectorAll(marks.map((mark) => `.${mark}`).join(", ")).forEach((el) => el.classList.remove(...marks));
  const selector = `[${options.itemAttribute}]`;
  const itemAt = (element: Element | null) => element?.closest<HTMLElement>(selector) ?? null;
  const targetAt = (x: number, y: number) => {
    const hit = document.elementFromPoint(x, y);
    let el = itemAt(hit);
    let gap = false;
    if (!el) {
      const lane = hit?.closest(".pin-grid, .list-sec[data-section=pinned]");
      const all = [...(lane?.querySelectorAll<HTMLElement>(selector) ?? [])];
      const inRow = all.filter((candidate) => {
        const r = candidate.getBoundingClientRect();
        return y >= r.top && y <= r.bottom;
      });
      el = (inRow.length ? inRow : all).sort((a, b) => {
        const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
        return options.axis === "y"
          ? Math.abs(y - (ar.top + ar.height / 2)) - Math.abs(y - (br.top + br.height / 2))
          : Math.abs(x - (ar.left + ar.width / 2)) - Math.abs(x - (br.left + br.width / 2));
      })[0] ?? null;
      gap = Boolean(el);
    }
    if (!el) return null;
    const target = el.getAttribute(options.itemAttribute);
    if (!target) return null;
    const r = el.getBoundingClientRect();
    const source = active.current?.source ?? "";
    const zones = options.zonesFor?.(source, target, el) ?? options.dropZones;
    const zone = gap && zones.includes("before") && zones.includes("after")
      ? ((options.axis === "y" ? y < r.top + r.height / 2 : x < r.left + r.width / 2) ? "before" : "after")
      : dropZoneAt(options.axis === "y" ? y : x, options.axis === "y" ? r.top : r.left,
        options.axis === "y" ? r.height : r.width, zones);
    return zone ? { target, zone, el } : null;
  };
  const cancel = () => {
    const drag = active.current;
    if (drag?.timer) window.clearTimeout(drag.timer);
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = null;
    active.current = null;
    if (drag?.capture?.hasPointerCapture?.(drag.id)) drag.capture.releasePointerCapture(drag.id);
    clearMarks();
    document.querySelectorAll(".sidebar-drag-source").forEach((el) => el.classList.remove("sidebar-drag-source"));
    document.getElementById("sidebar-drag-ghost")?.remove();
    document.body.classList.remove("sidebar-dragging");
  };
  const show = (drag: NonNullable<typeof active.current>, x: number, y: number) => {
    drag.lastX = x; drag.lastY = y;
    let ghost = document.getElementById("sidebar-drag-ghost");
    if (!ghost) {
      ghost = document.createElement("div");
      ghost.id = "sidebar-drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.innerHTML = '<span class="sidebar-drag-face"></span><span class="sidebar-drag-words"><strong></strong><small></small></span>';
      const source = document.querySelector(`[${options.itemAttribute}="${CSS.escape(drag.source)}"]`);
      source?.classList.add("sidebar-drag-source");
      const face = source?.querySelector(".pin-face, .row-av")?.cloneNode(true);
      if (face) ghost.querySelector(".sidebar-drag-face")!.appendChild(face);
      ghost.querySelector("strong")!.textContent = document.querySelector(`[${options.itemAttribute}="${CSS.escape(drag.source)}"] .pin-name, [${options.itemAttribute}="${CSS.escape(drag.source)}"] .row-name`)?.textContent ?? "";
      document.body.appendChild(ghost);
      document.body.classList.add("sidebar-dragging");
    }
    ghost.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y + 12)}px)`;
    clearMarks();
    const target = targetAt(x, y);
    const drop = target && target.target !== drag.source ? { source: drag.source, target: target.target, zone: target.zone } : null;
    const hint = drop ? options.hint?.(drop) ?? "Move here" : "";
    if (drop) target!.el.classList.add(hint === "Already in this group" ? "pin-drop-duplicate" : `pin-drop-${drop.zone}`);
    ghost.querySelector("small")!.textContent = hint;
    ghost.classList.toggle("duplicate", hint === "Already in this group");
  };
  const scrollNearEdge = () => {
    scrollFrame.current = null;
    const drag = active.current;
    const scroll = document.querySelector<HTMLElement>(".side-scroll");
    if (!drag?.moved || !scroll) return;
    const r = scroll.getBoundingClientRect();
    if (drag.lastX < r.left || drag.lastX > r.right) return;
    const direction = drag.lastY < r.top + 40 ? -1 : drag.lastY > r.bottom - 40 ? 1 : 0;
    if (!direction) return;
    scroll.scrollTop += direction * 8;
    show(drag, drag.lastX, drag.lastY);
    scrollFrame.current = requestAnimationFrame(scrollNearEdge);
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && active.current?.moved) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick.current = true; cancel(); } };
    window.addEventListener("keydown", escape, true);
    return () => { window.removeEventListener("keydown", escape, true); cancel(); };
  }, []);
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      cancel();
      suppressClick.current = false;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if ((e.target as Element).closest(options.ignoreSelector)) return;
      const source = itemAt(e.target as Element);
      const key = source?.getAttribute(options.itemAttribute);
      if (!source || !key || source.matches(options.ignoreSelector)) return;
      const drag = { id: e.pointerId, source: key, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, touch: e.pointerType === "touch", far: 0, timer: undefined as number | undefined, capture: undefined as HTMLElement | undefined };
      active.current = drag;
      if (drag.touch) drag.timer = window.setTimeout(() => { if (active.current === drag) { drag.moved = true; show(drag, drag.x, drag.y); } }, 350);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const drag = active.current;
      if (!drag || drag.id !== e.pointerId) return;
      const distance = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
      drag.far = Math.max(drag.far, distance);
      if (!drag.moved && !drag.touch && distance >= 5) drag.moved = true;
      if (drag.touch && !drag.moved && distance > 8) { cancel(); return; }
      if (!drag.moved) return;
      if (!drag.capture) {
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.capture = e.currentTarget;
      }
      e.preventDefault();
      show(drag, e.clientX, e.clientY);
      if (scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(scrollNearEdge);
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const drag = active.current;
      if (!drag || drag.id !== e.pointerId) return;
      const target = drag.moved ? targetAt(e.clientX, e.clientY) : null;
      const longPress = drag.touch && drag.moved && drag.far < 8;
      cancel();
      if (drag.moved) suppressClick.current = true;
      if (longPress) { suppressClick.current = false; options.onLongPress?.(drag.source); suppressClick.current = true; return; }
      if (target && target.target !== drag.source) onDrop({ source: drag.source, target: target.target, zone: target.zone });
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onTouchMoveCapture: (e: ReactTouchEvent<HTMLElement>) => { if (active.current?.moved) e.preventDefault(); },
    onContextMenuCapture: (e: ReactMouseEvent<HTMLElement>) => { if (active.current?.touch) { e.preventDefault(); e.stopPropagation(); } },
    onKeyDownCapture: (e: ReactKeyboardEvent<HTMLElement>) => { if (e.key === "Escape" && active.current?.moved) { e.preventDefault(); e.stopPropagation(); suppressClick.current = true; cancel(); } },
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
