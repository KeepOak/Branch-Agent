import { layout } from "./tokens";
/** One viewport-clamped positioner for all floating layers, including very tall menus. */
export function place(anchor: Pick<DOMRect, "left" | "right" | "top" | "bottom">, size: { w: number; h: number }, vw: number, vh: number, o: { align?: "start" | "end"; prefer?: "above" | "below"; gap?: number } = {}) {
  const inset = layout.popInset, gap = o.gap ?? 6;
  const width = Math.max(0, vw <= 480 ? vw - 2 * inset : Math.min(size.w, vw - 2 * inset));
  const left = Math.max(inset, Math.min(o.align === "end" ? anchor.right - width : anchor.left, vw - width - inset));
  const roomBelow = Math.max(0, vh - inset - anchor.bottom - gap), roomAbove = Math.max(0, anchor.top - gap - inset);
  const above = o.prefer === "above" ? roomAbove >= Math.min(size.h, roomBelow) : size.h > roomBelow && roomAbove > roomBelow;
  const maxHeight = Math.max(0, Math.min(size.h, above ? roomAbove : roomBelow, vh - 2 * inset));
  const top = Math.max(inset, Math.min(above ? anchor.top - gap - maxHeight : anchor.bottom + gap, vh - inset - maxHeight));
  return { left, top, width, maxHeight };
}
