import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { place } from "./place";

const layers: { close: () => void }[] = [];
function escape(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented || !layers.length) return;
  event.preventDefault(); event.stopImmediatePropagation(); layers.at(-1)?.close();
}
/** Shared with the drawer: one Escape handler always dismisses only the topmost layer. */
export function useLayer(open: boolean, close: () => void) {
  const latest = useRef(close);
  useLayoutEffect(() => { latest.current = close; }, [close]);
  useEffect(() => {
    if (!open) return;
    const layer = { close: () => latest.current() };
    if (!layers.length) document.addEventListener("keydown", escape, true);
    layers.push(layer);
    return () => { const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1); if (!layers.length) document.removeEventListener("keydown", escape, true); };
  }, [open]);
}
export function Popover({ anchor, onClose, label, children, width = 340, align = "start", placement = "below", closeOnScroll = false }: {
  anchor: RefObject<HTMLElement | null>; onClose: () => void; label: string; children: ReactNode; width?: number; align?: "start" | "end"; placement?: "above" | "below";
  /** Closes when the page under it scrolls. A scroll inside the popover itself does not close it. */
  closeOnScroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose);
  useLayoutEffect(() => { latestClose.current = onClose; }, [onClose]);
  const [position, setPosition] = useState<ReturnType<typeof place>>();
  useLayer(true, onClose);
  useLayoutEffect(() => {
    const node = ref.current, opener = anchor.current;
    if (!node || !opener) return;
    const update = () => setPosition(place(opener.getBoundingClientRect(), { w: width, h: node.scrollHeight }, window.innerWidth, window.innerHeight, { align, prefer: placement }));
    // Its content too: a menu opening a submenu in place grows inside the clamped box, which alone wouldn't resize.
    const observer = new ResizeObserver(update); observer.observe(opener); observer.observe(node); if (node.firstElementChild) observer.observe(node.firstElementChild);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true); update();
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [anchor, width, align, placement]);
  useEffect(() => {
    if (!closeOnScroll) return;
    const scrolled = (event: Event) => { if (!ref.current?.contains(event.target as Node)) latestClose.current(); };
    window.addEventListener("scroll", scrolled, true);
    return () => window.removeEventListener("scroll", scrolled, true);
  }, [closeOnScroll]);
  useEffect(() => {
    const opener = anchor.current;
    (ref.current?.querySelector<HTMLElement>("input,button:not(:disabled),[tabindex='0']") ?? ref.current)?.focus();
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !opener?.contains(e.target as Node)) latestClose.current(); };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); if (opener?.isConnected) opener.focus(); };
  }, [anchor]);
  return createPortal(<div className="g-float g-popover" ref={ref} role="dialog" aria-label={label} tabIndex={-1} style={{ ...position, visibility: position ? "visible" : "hidden" }} onKeyDown={e => {
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input,[tabindex='0']")];
    const first = items[0], last = items.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }}>{children}</div>, document.body);
}
