import { GestureMachine, LONG_PRESS_MS, type GestureOut, type PointerIn, type TouchMode } from "./touch-gestures";

const bounds = { left: 0, top: 0, width: 1000, height: 600 };
const make = (mode: TouchMode) => new GestureMachine({ mode, bounds });
const touch = (type: PointerIn["type"], id: number, x: number, y: number, t: number): PointerIn => ({ type, id, x, y, t, pointerType: "touch" });
const mouse = (type: PointerIn["type"], x: number, y: number, t: number, button = 0, buttons = 0): PointerIn => ({ type, id: 1, x, y, t, pointerType: "mouse", button, buttons });
/** Feeds events in order and collects everything that came out. */
const run = (m: GestureMachine, events: PointerIn[]): GestureOut[] => events.flatMap((e) => m.feed(e));
const kinds = (outs: GestureOut[]) => outs.map((o) => o.kind);

describe("Touch mode", () => {
  it("a tap clicks under the finger", () => {
    const m = make("touch");
    expect(run(m, [touch("down", 1, 200, 100, 0), touch("move", 1, 203, 102, 40), touch("up", 1, 203, 102, 90)])).toEqual([
      { kind: "click", x: 200, y: 100, button: "left" },
    ]);
  });

  it("a one-finger drag drags from where it landed to where it lifted", () => {
    const m = make("touch");
    expect(run(m, [touch("down", 1, 100, 100, 0), touch("move", 1, 160, 100, 50), touch("move", 1, 300, 220, 100), touch("up", 1, 300, 220, 150)])).toEqual([
      { kind: "drag", fromX: 100, fromY: 100, x: 300, y: 220 },
    ]);
  });

  it("a long press right-clicks under the finger once, and the lift adds nothing", () => {
    const m = make("touch");
    m.feed(touch("down", 1, 400, 300, 0));
    expect(m.tick(LONG_PRESS_MS - 1)).toEqual([]);
    expect(m.tick(LONG_PRESS_MS)).toEqual([{ kind: "click", x: 400, y: 300, button: "right" }]);
    expect(m.tick(LONG_PRESS_MS + 500)).toEqual([]);
    expect(m.feed(touch("up", 1, 400, 300, LONG_PRESS_MS + 600))).toEqual([]);
  });

  it("a long press with no tick still right-clicks when the finger lifts", () => {
    const m = make("touch");
    expect(run(m, [touch("down", 1, 10, 20, 0), touch("up", 1, 10, 20, LONG_PRESS_MS + 10)])).toEqual([{ kind: "click", x: 10, y: 20, button: "right" }]);
  });

  it("a moving finger is not a long press", () => {
    const m = make("touch");
    run(m, [touch("down", 1, 100, 100, 0), touch("move", 1, 150, 100, 100)]);
    expect(m.tick(LONG_PRESS_MS * 2)).toEqual([]);
  });

  it("two fingers moving together scroll at the fingers, with the content following them", () => {
    const m = make("touch");
    const outs = run(m, [
      touch("down", 1, 100, 300, 0),
      touch("down", 2, 200, 300, 10),
      touch("move", 1, 100, 260, 40),
      touch("move", 2, 200, 260, 45),
      touch("up", 1, 200, 260, 400),
      touch("up", 2, 200, 260, 410),
    ]);
    expect(outs).toEqual([
      { kind: "scroll", x: 150, y: 280, dx: 0, dy: 20 },
      { kind: "scroll", x: 150, y: 260, dx: 0, dy: 20 },
    ]);
  });

  it("a two-finger tap does nothing in Touch mode", () => {
    const m = make("touch");
    expect(run(m, [touch("down", 1, 100, 100, 0), touch("down", 2, 200, 100, 5), touch("up", 1, 100, 100, 80), touch("up", 2, 200, 100, 90)])).toEqual([]);
  });

  it("a pinch zooms the local view about the fingers and pans it, and never reaches the remote", () => {
    const m = make("touch");
    const outs = run(m, [
      touch("down", 1, 400, 300, 0),
      touch("down", 2, 600, 300, 0),
      touch("move", 1, 300, 300, 30),
      touch("move", 2, 700, 310, 40),
      touch("up", 1, 300, 300, 100),
      touch("up", 2, 700, 310, 100),
    ]);
    expect(kinds(outs).every((k) => k === "zoom" || k === "pan")).toBe(true);
    const zooms = outs.filter((o): o is Extract<GestureOut, { kind: "zoom" }> => o.kind === "zoom");
    const total = zooms.reduce((f, z) => f * z.factor, 1);
    expect(total).toBeCloseTo(Math.hypot(400, 10) / 200, 5);
    expect(outs.some((o) => o.kind === "pan")).toBe(true);
  });

  it("a cancelled touch does nothing", () => {
    const m = make("touch");
    expect(run(m, [touch("down", 1, 10, 10, 0), touch("cancel", 1, 10, 10, 20), touch("up", 1, 10, 10, 30)])).toEqual([]);
  });
});

describe("Trackpad mode", () => {
  it("starts the cursor in the middle of the picture", () => {
    expect(make("trackpad").cursor).toEqual({ x: 500, y: 300 });
  });

  it("one finger moves the cursor relatively, and a tap then clicks at the cursor, not the finger", () => {
    const m = make("trackpad");
    const moved = run(m, [touch("down", 1, 100, 100, 0), touch("move", 1, 120, 100, 30), touch("move", 1, 140, 110, 60), touch("up", 1, 140, 110, 90)]);
    // 1.5 cursor pixels per finger pixel: 20 then 20/10 more.
    expect(moved).toEqual([
      { kind: "cursor", x: 530, y: 300 },
      { kind: "move", x: 530, y: 300 },
      { kind: "cursor", x: 560, y: 315 },
      { kind: "move", x: 560, y: 315 },
    ]);
    expect(run(m, [touch("down", 1, 900, 50, 200), touch("up", 1, 900, 50, 260)])).toEqual([{ kind: "click", x: 560, y: 315, button: "left" }]);
  });

  it("keeps the cursor inside the picture", () => {
    const m = make("trackpad");
    run(m, [touch("down", 1, 0, 0, 0), touch("move", 1, 2000, 2000, 30), touch("up", 1, 2000, 2000, 60)]);
    expect(m.cursor).toEqual({ x: 1000, y: 600 });
    m.setBounds({ left: 0, top: 0, width: 400, height: 200 });
    expect(m.cursor).toEqual({ x: 400, y: 200 });
  });

  it("a two-finger tap right-clicks at the cursor", () => {
    const m = make("trackpad");
    expect(run(m, [touch("down", 1, 100, 100, 0), touch("down", 2, 160, 100, 20), touch("up", 2, 160, 100, 120), touch("up", 1, 100, 100, 130)])).toEqual([
      { kind: "click", x: 500, y: 300, button: "right" },
    ]);
  });

  it("a slow two-finger touch is not a tap", () => {
    const m = make("trackpad");
    expect(run(m, [touch("down", 1, 100, 100, 0), touch("down", 2, 160, 100, 20), touch("up", 2, 160, 100, 900), touch("up", 1, 100, 100, 910)])).toEqual([]);
  });

  it("two-finger scrolling scrolls at the cursor", () => {
    const m = make("trackpad");
    const outs = run(m, [touch("down", 1, 100, 100, 0), touch("down", 2, 200, 100, 0), touch("move", 1, 100, 140, 30), touch("move", 2, 200, 140, 30)]);
    expect(outs).toEqual([
      { kind: "scroll", x: 500, y: 300, dx: 0, dy: -20 },
      { kind: "scroll", x: 500, y: 300, dx: 0, dy: -20 },
    ]);
  });

  it("a long press right-clicks at the cursor", () => {
    const m = make("trackpad");
    m.feed(touch("down", 1, 50, 50, 0));
    expect(m.tick(LONG_PRESS_MS)).toEqual([{ kind: "click", x: 500, y: 300, button: "right" }]);
  });

  it("a pinch zooms here too, with no click after it", () => {
    const m = make("trackpad");
    const outs = run(m, [touch("down", 1, 400, 300, 0), touch("down", 2, 500, 300, 0), touch("move", 2, 700, 300, 40), touch("up", 2, 700, 300, 60), touch("up", 1, 400, 300, 70)]);
    expect(kinds(outs)).toEqual(["zoom", "pan"]);
  });

  it("switching modes drops a half-finished gesture", () => {
    const m = make("trackpad");
    m.feed(touch("down", 1, 50, 50, 0));
    m.setMode("touch");
    expect(m.feed(touch("up", 1, 50, 50, 20))).toEqual([]);
    expect(m.mode).toBe("touch");
  });
});

describe("a mouse drives directly in either mode", () => {
  for (const mode of ["touch", "trackpad"] as const) {
    it(`clicks, right-clicks, drags and hovers (${mode})`, () => {
      const m = make(mode);
      expect(run(m, [mouse("down", 10, 20, 0), mouse("up", 10, 20, 30)])).toEqual([{ kind: "click", x: 10, y: 20, button: "left" }]);
      expect(run(m, [mouse("down", 10, 20, 0, 2), mouse("up", 10, 20, 30, 2)])).toEqual([{ kind: "click", x: 10, y: 20, button: "right" }]);
      expect(run(m, [mouse("down", 10, 20, 0), mouse("move", 80, 90, 20, 0, 1), mouse("up", 80, 90, 40)])).toEqual([{ kind: "drag", fromX: 10, fromY: 20, x: 80, y: 90 }]);
      expect(run(m, [mouse("move", 300, 200, 50)])).toEqual([{ kind: "move", x: 300, y: 200 }]);
    });
  }
});
