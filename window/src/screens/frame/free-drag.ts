// Freedom Mode's pointer and key handling (owner item 6). A drag moves the widths on screen and commits them on release, so
// the saved widths only change when the person lets go. The rules themselves live in free-widths.ts.
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  collapseBoth, commitSide, commitTopics, getFree, maxSide, maxTopics, proportional, setFree, sideNow, step, toggleRail, useFree, type FreeState,
} from "./free-widths";

export type Edge = "side" | "topics";
type Drag = { edge: Edge; x0: number; s0: number; t0: number; s: number; t: number; alt: boolean; moved: boolean };
export type LiveWidths = { side: number; topics: number };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));
const appWidth = (frame: HTMLElement | null) => frame?.clientWidth || window.innerWidth;

/** Drag, double-click, Enter and arrow keys on a handle, and ⌘[ ⌘] ⌘\ for the whole window. */
export function useFreeDrag(frame: { current: HTMLElement | null }, hasTopics: boolean) {
  const fs = useFree();
  const [live, setLive] = useState<LiveWidths | null>(null);
  const drag = useRef<Drag | null>(null);
  const begin = (edge: Edge, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const s0 = sideNow(fs), t0 = fs.topics;
    drag.current = { edge, x0: event.clientX, s0, t0, s: s0, t: t0, alt: event.altKey, moved: false };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    const app = appWidth(frame.current);
    if (d.edge === "side") {
      d.s = clamp(d.s0 + dx, 0, maxSide(app, d.t0));
      d.t = d.alt ? proportional(d.s, d.s0, d.t0, maxTopics(app, d.s)) : d.t0;
    } else {
      d.t = clamp(d.t0 + dx, 0, maxTopics(app, d.s0));
      d.s = d.alt ? proportional(d.t, d.t0, d.s0, maxSide(app, d.t)) : d.s0;
    }
    setLive({ side: d.s, topics: d.t });
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    drag.current = null;
    setLive(null);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!d || !d.moved) return;
    const app = appWidth(frame.current);
    const cur = getFree();
    let next: FreeState;
    if (d.edge === "side") {
      next = commitSide(cur, d.s, app);
      if (d.alt) next = commitTopics(next, d.t, app);
    } else {
      next = commitTopics(cur, d.t, app);
      if (d.alt) next = commitSide(next, d.s, app);
    }
    setFree({ ...next, last: d.edge });
  };
  const doubleClick = (edge: Edge) => setFree({ ...toggleRail(getFree(), edge), last: edge });
  const handleKey = (edge: Edge, event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      setFree({ ...step(getFree(), edge, event.key === "ArrowRight" ? 1 : -1, appWidth(frame.current)), last: edge });
    } else if (event.key === "Enter") {
      event.preventDefault();
      setFree({ ...toggleRail(getFree(), edge), last: edge });
    }
  };
  /** ⌘[ and ⌘] act on the edge touched last (or the sidebar when there is no threads column); ⌘\ collapses both. */
  const shortcut = (event: globalThis.KeyboardEvent, typing: boolean): boolean => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || typing) return false;
    const cur = getFree();
    if (event.key === "[" || event.key === "]") {
      event.preventDefault();
      const edge: Edge = cur.last === "topics" && hasTopics ? "topics" : "side";
      setFree({ ...step(cur, edge, event.key === "]" ? 1 : -1, appWidth(frame.current)), last: edge });
      return true;
    }
    if (event.key === "\\") {
      event.preventDefault();
      setFree(collapseBoth(cur, hasTopics));
      return true;
    }
    return false;
  };
  return { fs, live, begin, move, end, doubleClick, handleKey, shortcut };
}
