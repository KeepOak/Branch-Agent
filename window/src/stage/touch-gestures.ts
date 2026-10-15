// Pure gesture recognition for driving a remote screen, the way Jump Desktop and noVNC do on a touch screen.
// Pointer events go in (with their time); what to do comes out. Nothing here reads the DOM or a clock: the pane feeds
// events and calls tick() when a long press could have ripened. Points out are client pixels; the pane maps them to
// the remote screen (remote-map.ts).
//
// A mouse or pen with buttons drives directly: a press and release clicks, a press-move-release drags, the right
// button right-clicks, and moving with no button pressed moves the remote pointer.
//
// Touch, in either mode:
//   two fingers moving together scroll; two fingers spreading or closing zoom the local view and pan it;
//   holding one finger still right-clicks.
// Touch mode: a tap clicks under the finger; a one-finger drag drags.
// Trackpad mode: one finger moves an on-screen cursor relatively; a tap clicks at the cursor; a two-finger tap
// right-clicks at the cursor.

import type { Point, Rect } from "./remote-map";

export type TouchMode = "touch" | "trackpad";
export type PointerKind = "mouse" | "touch" | "pen";

export type PointerIn = {
  type: "down" | "move" | "up" | "cancel";
  id: number;
  x: number;
  y: number;
  /** Milliseconds, any origin, increasing. */
  t: number;
  pointerType: PointerKind;
  /** The button that changed (DOM PointerEvent.button): 0 main, 2 secondary. */
  button?: number;
  /** The buttons held (DOM PointerEvent.buttons). */
  buttons?: number;
};

export type GestureOut =
  | { kind: "click"; x: number; y: number; button: "left" | "right" }
  | { kind: "move"; x: number; y: number }
  | { kind: "drag"; fromX: number; fromY: number; x: number; y: number }
  | { kind: "scroll"; x: number; y: number; dx: number; dy: number }
  | { kind: "zoom"; factor: number; x: number; y: number }
  | { kind: "pan"; dx: number; dy: number }
  | { kind: "cursor"; x: number; y: number };

export type GestureConfig = {
  mode: TouchMode;
  /** Where the picture is on screen; the trackpad cursor stays inside it. */
  bounds: Rect;
  /** How far a finger may wander and still be a tap, in CSS pixels. */
  slop?: number;
  /** How long a finger must stay still to right-click. */
  longPressMs?: number;
  /** The longest two-finger touch that still counts as a tap. */
  twoTapMs?: number;
  /** Cursor pixels per finger pixel in trackpad mode. */
  speed?: number;
  /** How far apart two fingers must spread or close, as a fraction, before it is a pinch rather than a scroll. */
  pinchThreshold?: number;
};

export const SLOP = 10;
export const LONG_PRESS_MS = 600;
export const TWO_TAP_MS = 300;
export const TRACKPAD_SPEED = 1.5;
export const PINCH_THRESHOLD = 0.12;

type Finger = { sx: number; sy: number; x: number; y: number };

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export class GestureMachine {
  private cfg: Required<GestureConfig>;
  private fingers = new Map<number, Finger>();
  /** "one": one finger down; "two": two fingers down or lifting; "mouse": a mouse button held. */
  private phase: "idle" | "one" | "two" | "mouse" = "idle";
  private startT = 0;
  private moved = false;
  private longFired = false;
  private twoT = 0;
  private two: "pending" | "scroll" | "pinch" | "done" = "pending";
  private startSpread = 0;
  private lastSpread = 0;
  private lastCentre: Point = { x: 0, y: 0 };
  private mouse: { sx: number; sy: number; button: number } | null = null;
  private cur: Point;

  constructor(config: GestureConfig) {
    this.cfg = { slop: SLOP, longPressMs: LONG_PRESS_MS, twoTapMs: TWO_TAP_MS, speed: TRACKPAD_SPEED, pinchThreshold: PINCH_THRESHOLD, ...config };
    this.cur = { x: config.bounds.left + config.bounds.width / 2, y: config.bounds.top + config.bounds.height / 2 };
  }

  get mode(): TouchMode {
    return this.cfg.mode;
  }

  /** The trackpad cursor, in client pixels. */
  get cursor(): Point {
    return { ...this.cur };
  }

  setMode(mode: TouchMode) {
    this.cfg.mode = mode;
    this.reset();
  }

  /** The picture moved or was zoomed: the cursor stays inside it. */
  setBounds(bounds: Rect) {
    const was = this.cfg.bounds;
    this.cfg.bounds = bounds;
    if (was.width <= 0 || was.height <= 0) this.cur = { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    else this.cur = this.clamp(this.cur);
  }

  reset() {
    this.fingers.clear();
    this.phase = "idle";
    this.mouse = null;
    this.moved = false;
    this.longFired = false;
    this.two = "pending";
  }

  /** Call when time passes with no event: a still finger becomes a right-click once it has been held long enough. */
  tick(t: number): GestureOut[] {
    if (this.phase !== "one" || this.moved || this.longFired) return [];
    if (t - this.startT < this.cfg.longPressMs) return [];
    this.longFired = true;
    const at = this.cfg.mode === "trackpad" ? this.cur : this.only();
    return at ? [{ kind: "click", x: at.x, y: at.y, button: "right" }] : [];
  }

  feed(ev: PointerIn): GestureOut[] {
    if (ev.type === "cancel") {
      this.reset();
      return [];
    }
    return ev.pointerType === "mouse" ? this.mouseEvent(ev) : this.touchEvent(ev);
  }

  private clamp(p: Point): Point {
    const b = this.cfg.bounds;
    return { x: Math.min(b.left + b.width, Math.max(b.left, p.x)), y: Math.min(b.top + b.height, Math.max(b.top, p.y)) };
  }

  private only(): Point | null {
    const f = this.fingers.values().next().value as Finger | undefined;
    return f ? { x: f.sx, y: f.sy } : null;
  }

  private mouseEvent(ev: PointerIn): GestureOut[] {
    if (ev.type === "down") {
      if (this.mouse) return [];
      this.mouse = { sx: ev.x, sy: ev.y, button: ev.button ?? 0 };
      this.moved = false;
      this.phase = "mouse";
      return [];
    }
    if (ev.type === "move") {
      if (!this.mouse) return (ev.buttons ?? 0) === 0 ? [{ kind: "move", x: ev.x, y: ev.y }] : [];
      if (!this.moved && dist({ x: ev.x, y: ev.y }, { x: this.mouse.sx, y: this.mouse.sy }) > this.cfg.slop) this.moved = true;
      return [];
    }
    // up
    const down = this.mouse;
    this.mouse = null;
    this.phase = "idle";
    if (!down) return [];
    if (down.button === 2) return [{ kind: "click", x: ev.x, y: ev.y, button: "right" }];
    if (down.button !== 0) return [];
    if (this.moved) return [{ kind: "drag", fromX: down.sx, fromY: down.sy, x: ev.x, y: ev.y }];
    return [{ kind: "click", x: ev.x, y: ev.y, button: "left" }];
  }

  private touchEvent(ev: PointerIn): GestureOut[] {
    const trackpad = this.cfg.mode === "trackpad";
    if (ev.type === "down") {
      this.fingers.set(ev.id, { sx: ev.x, sy: ev.y, x: ev.x, y: ev.y });
      if (this.fingers.size === 1) {
        this.phase = "one";
        this.startT = ev.t;
        this.moved = false;
        this.longFired = false;
      } else if (this.fingers.size === 2) {
        const [a, b] = [...this.fingers.values()];
        this.phase = "two";
        this.twoT = ev.t;
        this.two = "pending";
        this.startSpread = this.lastSpread = Math.max(1, dist(a, b));
        this.lastCentre = centre(a, b);
      } else {
        // A third finger ends whatever was happening; nothing more fires until every finger lifts.
        this.phase = "two";
        this.two = "done";
      }
      return [];
    }
    const finger = this.fingers.get(ev.id);
    if (!finger) return [];
    if (ev.type === "move") {
      const px = finger.x, py = finger.y;
      finger.x = ev.x;
      finger.y = ev.y;
      if (this.phase === "one") {
        if (this.longFired) return [];
        if (!this.moved && dist({ x: ev.x, y: ev.y }, { x: finger.sx, y: finger.sy }) > this.cfg.slop) {
          this.moved = true;
          // The first move past the slop carries the whole distance from where the finger landed.
          if (trackpad) return this.moveCursor(ev.x - finger.sx, ev.y - finger.sy);
          return [];
        }
        if (this.moved && trackpad) return this.moveCursor(ev.x - px, ev.y - py);
        return [];
      }
      if (this.phase === "two" && this.fingers.size === 2 && this.two !== "done") return this.twoMove();
      return [];
    }
    // up
    this.fingers.delete(ev.id);
    if (this.phase === "one") {
      this.phase = "idle";
      if (this.longFired) return [];
      if (!this.moved) {
        if (ev.t - this.startT >= this.cfg.longPressMs) {
          const at = trackpad ? this.cur : { x: finger.sx, y: finger.sy };
          return [{ kind: "click", x: at.x, y: at.y, button: "right" }];
        }
        const at = trackpad ? this.cur : { x: finger.sx, y: finger.sy };
        return [{ kind: "click", x: at.x, y: at.y, button: "left" }];
      }
      if (!trackpad) return [{ kind: "drag", fromX: finger.sx, fromY: finger.sy, x: ev.x, y: ev.y }];
      return [];
    }
    if (this.phase === "two") {
      const out: GestureOut[] = [];
      if (this.two === "pending" && trackpad && ev.t - this.twoT <= this.cfg.twoTapMs) out.push({ kind: "click", x: this.cur.x, y: this.cur.y, button: "right" });
      this.two = "done";
      if (this.fingers.size === 0) this.phase = "idle";
      return out;
    }
    return [];
  }

  private moveCursor(dx: number, dy: number): GestureOut[] {
    this.cur = this.clamp({ x: this.cur.x + dx * this.cfg.speed, y: this.cur.y + dy * this.cfg.speed });
    return [
      { kind: "cursor", x: this.cur.x, y: this.cur.y },
      { kind: "move", x: this.cur.x, y: this.cur.y },
    ];
  }

  private twoMove(): GestureOut[] {
    const [a, b] = [...this.fingers.values()];
    const c = centre(a, b), spread = Math.max(1, dist(a, b));
    if (this.two === "pending") {
      if (Math.abs(spread / this.startSpread - 1) > this.cfg.pinchThreshold) this.two = "pinch";
      else if (dist(c, this.lastCentre) > this.cfg.slop) this.two = "scroll";
      else return [];
    }
    const dx = c.x - this.lastCentre.x, dy = c.y - this.lastCentre.y;
    const out: GestureOut[] = [];
    if (this.two === "pinch") {
      const factor = spread / this.lastSpread;
      if (factor !== 1) out.push({ kind: "zoom", factor, x: c.x, y: c.y });
      if (dx || dy) out.push({ kind: "pan", dx, dy });
    } else {
      // Content follows the fingers, as on a phone: fingers moving up scroll the page down.
      const at = this.cfg.mode === "trackpad" ? this.cur : c;
      if (dx || dy) out.push({ kind: "scroll", x: at.x, y: at.y, dx: -dx || 0, dy: -dy || 0 });
    }
    this.lastCentre = c;
    this.lastSpread = spread;
    return out;
  }
}
