// The surface you drive the Trunk's browser or computer through while you have it (Take over). It wraps the live
// picture, turns your pointer, wheel, touch and typing into remote actions, and draws the trackpad cursor and the
// keyboard button. While you don't have it, it passes nothing on: the picture is look-only.
//
// Geometry lives in remote-map.ts, gestures in touch-gestures.ts and keys in drive-keys.ts; this file only wires
// them to the DOM. Each pane gives it a `send` that speaks its own route.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { contentRect, IDENTITY_VIEW, panBy, toRemote, zoomAt, type Point, type Rect, type Size, type View } from "./remote-map";
import { GestureMachine, LONG_PRESS_MS, type GestureOut, type PointerKind } from "./touch-gestures";
import { keyPress } from "./drive-keys";
import { editingKey } from "./browser-input";
import { useTouchMode } from "./touch-mode";
import { SIcon } from "./stage-icons";

/** What the person did, in the remote screen's pixels. */
export type RemoteAction =
  | { kind: "click"; x: number; y: number; button: "left" | "right" }
  | { kind: "move"; x: number; y: number }
  | { kind: "drag"; fromX: number; fromY: number; x: number; y: number }
  | { kind: "scroll"; x: number; y: number; dx: number; dy: number }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string };

type Props = {
  /** You have it: input goes to the remote. */
  active: boolean;
  /** The picture's own pixel size (the canvas bitmap or the image), or null before the first picture. */
  frame: () => Size | null;
  /** The remote coordinate space the route expects (viewport CSS pixels, or the screenshot's pixels). */
  remote: () => Size | null;
  send: (action: RemoteAction) => void;
  /** The typing field's name, read by screen readers. */
  typingLabel: string;
  children: ReactNode;
};

const WHEEL_FLUSH_MS = 60;
const LINE_PX = 16;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const kindOf = (t: string): PointerKind => (t === "touch" ? "touch" : t === "pen" ? "pen" : "mouse");
const rectOf = (el: HTMLElement): Rect => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

export function DriveSurface({ active, frame, remote, send, typingLabel, children }: Props) {
  const mode = useTouchMode();
  const surface = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<View>(IDENTITY_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [cursor, setCursor] = useState<Point | null>(null);
  const machine = useRef<GestureMachine | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef({ active, send, frame, remote });
  live.current = { active, send, frame, remote };

  const bounds = useCallback((): { box: Rect; content: Rect } | null => {
    const el = surface.current, f = live.current.frame();
    if (!el || !f) return null;
    const box = rectOf(el);
    const content = contentRect(box, f, viewRef.current);
    return content ? { box, content } : null;
  }, []);

  const gestures = useCallback((): GestureMachine | null => {
    const b = bounds();
    if (!b) return null;
    if (!machine.current) machine.current = new GestureMachine({ mode, bounds: b.content });
    else machine.current.setBounds(b.content);
    if (machine.current.mode !== mode) machine.current.setMode(mode);
    return machine.current;
  }, [bounds, mode]);

  // Leaving control, or switching modes, starts clean: no half gesture, no zoom, the cursor back in the middle.
  useEffect(() => {
    machine.current = null;
    clearTimeout(timer.current);
    setCursor(null);
    if (!active) setView(IDENTITY_VIEW);
  }, [active, mode]);

  const remotePoint = useCallback((p: Point, clamp = false): Point | null => {
    const el = surface.current, f = live.current.frame(), r = live.current.remote();
    if (!el || !f || !r) return null;
    return toRemote(p, rectOf(el), f, r, viewRef.current, clamp);
  }, []);

  const apply = useCallback((outs: GestureOut[]) => {
    const { send: out } = live.current;
    for (const g of outs) {
      if (g.kind === "zoom" || g.kind === "pan") {
        const el = surface.current;
        if (!el) continue;
        const box = rectOf(el);
        const next = g.kind === "zoom" ? zoomAt(viewRef.current, g.factor, { x: g.x, y: g.y }, box) : panBy(viewRef.current, g.dx, g.dy, box);
        viewRef.current = next;
        setView(next);
        continue;
      }
      if (g.kind === "cursor") {
        const el = surface.current;
        if (el) {
          const box = rectOf(el);
          setCursor({ x: g.x - box.left, y: g.y - box.top });
        }
        continue;
      }
      if (g.kind === "drag") {
        const from = remotePoint({ x: g.fromX, y: g.fromY });
        const to = remotePoint({ x: g.x, y: g.y }, true);
        if (from && to) out({ kind: "drag", fromX: from.x, fromY: from.y, x: to.x, y: to.y });
        continue;
      }
      const at = remotePoint({ x: g.x, y: g.y });
      if (!at) continue;
      if (g.kind === "click") out({ kind: "click", ...at, button: g.button });
      else if (g.kind === "move") out({ kind: "move", ...at });
      else out({ kind: "scroll", ...at, dx: g.dx, dy: g.dy });
    }
  }, [remotePoint]);

  const pointer = (type: "down" | "move" | "up" | "cancel") => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!live.current.active) return;
    if ((e.target as Element | null)?.closest?.(".rd-kb")) return;
    const m = gestures();
    if (!m) return;
    const pointerType = kindOf(e.pointerType);
    if (type === "down") {
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        // A pointer the browser no longer tracks can't be captured; the gesture still works without it.
      }
      // A mouse means a hardware keyboard: keep typing going to the remote. A finger asks with the keyboard button.
      if (pointerType === "mouse") field.current?.focus({ preventScroll: true });
      if (pointerType !== "mouse") {
        if (m.mode === "trackpad" && !cursor) setCursorFrom(m);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => apply(m.tick(now())), LONG_PRESS_MS + 20);
      }
    }
    if (type === "up" || type === "cancel") clearTimeout(timer.current);
    apply(m.feed({ type, id: e.pointerId, x: e.clientX, y: e.clientY, t: now(), pointerType, button: e.button, buttons: e.buttons }));
  };

  const setCursorFrom = (m: GestureMachine) => {
    const el = surface.current;
    if (!el) return;
    const box = rectOf(el), c = m.cursor;
    setCursor({ x: c.x - box.left, y: c.y - box.top });
  };

  // Wheel and trackpad scrolling: a native listener, because React's wheel listener can't stop the pane scrolling.
  useEffect(() => {
    const el = surface.current;
    if (!el || !active) return;
    let pending: { x: number; y: number; dx: number; dy: number } | null = null;
    let flush: ReturnType<typeof setTimeout> | undefined;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // A trackpad pinch arrives as a wheel with Control held: it zooms the local view, like two fingers do.
        apply([{ kind: "zoom", factor: Math.exp(-e.deltaY / 200), x: e.clientX, y: e.clientY }]);
        return;
      }
      const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? el.getBoundingClientRect().height : 1;
      pending = { x: e.clientX, y: e.clientY, dx: (pending?.dx ?? 0) + e.deltaX * unit, dy: (pending?.dy ?? 0) + e.deltaY * unit };
      if (flush === undefined) {
        flush = setTimeout(() => {
          flush = undefined;
          const p = pending;
          pending = null;
          if (p && (p.dx || p.dy)) apply([{ kind: "scroll", x: p.x, y: p.y, dx: Math.round(p.dx), dy: Math.round(p.dy) }]);
        }, WHEEL_FLUSH_MS);
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", wheel);
      clearTimeout(flush);
    };
  }, [active, apply]);

  // Text from a soft or hardware keyboard reaches the remote as text, never as one key press per character.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const beforeInput = (event: Event) => {
      const input = event as InputEvent;
      if (!live.current.active || input.isComposing || input.inputType === "insertFromComposition") {
        if (input.inputType === "insertFromComposition") input.preventDefault();
        return;
      }
      input.preventDefault();
      if (input.inputType === "insertText" && input.data) live.current.send({ kind: "type", text: input.data });
      else if (input.inputType !== "insertFromPaste") {
        const key = editingKey(input.inputType);
        if (key) live.current.send({ kind: "key", key });
      }
    };
    const composed = (event: Event) => {
      const text = (event as CompositionEvent).data;
      if (text && live.current.active) live.current.send({ kind: "type", text });
      el.value = "";
    };
    el.addEventListener("beforeinput", beforeInput);
    el.addEventListener("compositionend", composed);
    return () => {
      el.removeEventListener("beforeinput", beforeInput);
      el.removeEventListener("compositionend", composed);
    };
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const zoomed = view.zoom !== 1 || view.panX !== 0 || view.panY !== 0;
  return (
    <div
      ref={surface}
      className={active ? "rd-surface rd-on" : "rd-surface"}
      data-mode={mode}
      onPointerDown={pointer("down")}
      onPointerMove={pointer("move")}
      onPointerUp={pointer("up")}
      onPointerCancel={pointer("cancel")}
      onContextMenu={(e) => {
        if (active) e.preventDefault();
      }}
    >
      <div className="rd-view" style={zoomed ? { transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` } : undefined}>
        {children}
      </div>
      {active && mode === "trackpad" && cursor ? (
        <svg className="rd-cursor" data-testid="drive-cursor" aria-hidden="true" viewBox="0 0 16 16" style={{ left: cursor.x, top: cursor.y }}>
          <path d="M2 1l11 6.5-5 1.2L5.5 14z" />
        </svg>
      ) : null}
      <textarea
        ref={field}
        className="br-input-st"
        aria-label={typingLabel}
        tabIndex={active ? 0 : -1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onKeyDown={(e) => {
          const key = keyPress({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing, keyCode: e.keyCode });
          if (!active || !key) return;
          e.preventDefault();
          send({ kind: "key", key });
        }}
        onPaste={(e) => {
          if (!active) return;
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          if (text) send({ kind: "type", text });
        }}
      />
      {active ? (
        <button type="button" className="rd-kb" aria-label="Keyboard" title="Type on the screen" onClick={() => field.current?.focus({ preventScroll: true })}>
          <SIcon name="keyboard" small />
        </button>
      ) : null}
    </div>
  );
}
