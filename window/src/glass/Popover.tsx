import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { place } from "./place";

function focusQuietly(node: HTMLElement | null | undefined) {
  // Opening must show the menu where it is. Scrolling the first row into view moves the page, and each
  // scroll event would otherwise redraw the menu still on screen.
  node?.focus({ preventScroll: true });
}

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
    // Same box as last time: keep the previous state object so a scroll does not redraw the menu.
    const apply = () => {
      const next = place(opener.getBoundingClientRect(), { w: width, h: node.scrollHeight }, window.innerWidth, window.innerHeight, { align, prefer: placement });
      setPosition((prev) => prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.maxHeight === next.maxHeight ? prev : next);
    };
    // A burst of scroll events is one redraw on the next frame, not one redraw inside the click that started it.
    let scrollFrame = 0;
    const onScroll = () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => { scrollFrame = 0; apply(); });
    };
    // Its content too: a menu opening a submenu in place grows inside the clamped box, which alone wouldn't resize.
    const observer = new ResizeObserver(apply); observer.observe(opener); observer.observe(node); if (node.firstElementChild) observer.observe(node.firstElementChild);
    window.addEventListener("resize", apply); window.addEventListener("scroll", onScroll, true); apply();
    return () => {
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      observer.disconnect(); window.removeEventListener("resize", apply); window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, width, align, placement]);
  useEffect(() => {
    if (!closeOnScroll) return;
    const scrolled = (event: Event) => { if (!ref.current?.contains(event.target as Node)) latestClose.current(); };
    window.addEventListener("scroll", scrolled, true);
    return () => window.removeEventListener("scroll", scrolled, true);
  }, [closeOnScroll]);
  useEffect(() => {
    const opener = anchor.current;
    focusQuietly(ref.current?.querySelector<HTMLElement>("input,button:not(:disabled),[tabindex='0']") ?? ref.current);
    const outside = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !opener?.contains(e.target as Node)) latestClose.current(); };
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("pointerdown", outside); if (opener?.isConnected) focusQuietly(opener); };
  }, [anchor]);
  return createPortal(<div className="g-float g-popover" ref={ref} role="dialog" aria-label={label} tabIndex={-1} style={{ ...position, visibility: position ? "visible" : "hidden" }} onKeyDown={e => {
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled),input,[tabindex='0']")];
    const first = items[0], last = items.at(-1);
    if (!first) { e.preventDefault(); return; }
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); focusQuietly(last); }
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); focusQuietly(first); }
  }}>{children}</div>, document.body);
}
