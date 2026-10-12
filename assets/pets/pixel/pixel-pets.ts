/* Branch's three pixel pets and their three reactions, drawn from code on a small canvas.

   The rest grids and palettes are copied unchanged from the old app (`public/app/core/pets.js` `PIXEL`, KeepOak/test
   branch `mac/cross-platform`, the same rows as the mock's `PETS`). Each grid is 12 × 10 cells, one letter per cell,
   "." see-through, drawn at 2× on a 24 × 20 canvas that the page shows at 48 × 40 CSS px with
   `image-rendering: pixelated`.

   A pet rests as its still. It moves only when `play()` is called for an event, then settles back on the exact rest
   frame (DESIGN-SPEC §6.5, §6.7):
   - `pat`    being patted: pressed down with its eyes shut, then the 0.9 s hop;
   - `cheer`  a Trunk finished a task: a crouch, then the full 0.9 s hop with happy shut eyes;
   - `notice` the owner came back: a blink, ears or spines up, then a few steps of the old walk.
   Under `prefers-reduced-motion: reduce`, Branch's "Keep things still" (`:root[data-still]`) or a hidden window,
   `play()` shows only the rest frame. Nothing runs at import and nothing loops. */

export type PetId = "squirrel" | "owl" | "hedgehog";
export type Reaction = "pat" | "cheer" | "notice";
export type Pose = "rest" | "squash" | "stretch" | "perk";

export interface PixelPet {
  readonly name: string;
  /** Letter → colour. "." is see-through. */
  readonly col: Readonly<Record<string, string>>;
  /** The eye letter and the letter that paints over it when the eyes are shut. */
  readonly eye: readonly [string, string];
  readonly poses: Readonly<Record<Pose, readonly string[]>>;
}

export interface Frame {
  readonly pose: Pose;
  /** Milliseconds this frame stays up. */
  readonly ms: number;
  /** Whole-sprite lift, in canvas pixels (1 canvas px = half a cell). */
  readonly lift: number;
  /** Eyes shut (blink, content, happy). */
  readonly shut?: boolean;
  /** The old walk's step: the feet row drawn 1 canvas px higher. */
  readonly step?: boolean;
}

export const GRID_W = 12;
export const GRID_H = 10;
export const CELL = 2;
export const CANVAS_W = GRID_W * CELL;
export const CANVAS_H = GRID_H * CELL;
/** The old app's walk tick, one step of the feet. */
export const STEP_MS = 360;

/* rest: the old app's rows, unchanged. squash, stretch and perk are new: one body row taken out (squash) or doubled
   (stretch) with the feet kept on their row, and the ears, tufts or spines one cell taller (perk). */
export const PIXEL_PETS: Readonly<Record<PetId, PixelPet>> = {
  squirrel: {
    name: "Squirrel",
    col: { o: "#B8652B", b: "#F2D0AE", e: "#1B1A18" },
    eye: ["e", "o"],
    poses: {
      rest: ["............", ".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", ".oooooooooo.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"],
      squash: ["............", "............", ".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"],
      stretch: [".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", ".oooooooooo.", ".oooooooooo.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"],
      perk: ["........o...", ".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", ".oooooooooo.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"],
    },
  },
  owl: {
    name: "Owl",
    col: { o: "#6E5A45", w: "#F4EDE0", e: "#1B1A18", y: "#E0A33B", b: "#A38B6C" },
    eye: ["e", "w"],
    poses: {
      rest: ["............", "...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "..obbbbbbo..", "...oo..oo...", "............"],
      squash: ["............", "............", "...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "...oo..oo...", "............"],
      stretch: ["...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "..obbbbbbo..", "..obbbbbbo..", "...oo..oo...", "............"],
      perk: ["...o....o...", "...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "..obbbbbbo..", "...oo..oo...", "............"],
    },
  },
  hedgehog: {
    name: "Hedgehog",
    col: { s: "#5B4A3B", f: "#D9B48F", e: "#1B1A18" },
    eye: ["e", "f"],
    poses: {
      rest: ["............", "...s.s.s....", "..sssssss...", ".sssssssss..", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"],
      squash: ["............", "............", "...s.s.s....", "..sssssss...", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"],
      stretch: ["...s.s.s....", "..sssssss...", ".sssssssss..", ".sssssssss..", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"],
      perk: ["...s.s.s....", "...s.s.s....", "..sssssss...", ".sssssssss..", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"],
    },
  },
};

/* The old hop (`hop11`, 0.9 s): up to its height by 35 %, down by 60 % landing squashed, then settled. `peak` is in
   canvas px; the old hop rose 14 CSS px on the 48 × 40 pet, which is 7 canvas px. */
function hop(peak: number, shut: boolean): Frame[] {
  return [
    { pose: "stretch", ms: 120, lift: Math.round(peak * 0.6), shut },
    { pose: "stretch", ms: 195, lift: peak, shut },
    { pose: "rest", ms: 105, lift: Math.round(peak * 0.4), shut },
    { pose: "squash", ms: 120, lift: 0 },
    { pose: "rest", ms: 360, lift: 0 },
  ];
}

/* Every reaction ends on { pose: "rest", lift: 0 }, and play() then draws the rest frame itself. */
export const REACTIONS: Readonly<Record<Reaction, readonly Frame[]>> = {
  pat: [{ pose: "squash", ms: 300, lift: 0, shut: true }, ...hop(4, false)],
  cheer: [{ pose: "squash", ms: 120, lift: 0 }, ...hop(7, true)],
  notice: [
    { pose: "rest", ms: 150, lift: 0, shut: true },
    { pose: "rest", ms: 150, lift: 0 },
    { pose: "perk", ms: 420, lift: 0 },
    { pose: "perk", ms: STEP_MS, lift: 0, step: true },
    { pose: "perk", ms: STEP_MS, lift: 0 },
    { pose: "perk", ms: STEP_MS, lift: 0, step: true },
    { pose: "rest", ms: STEP_MS, lift: 0 },
  ],
};

/** Total length of a reaction in ms. */
export const reactionMs = (reaction: Reaction): number => REACTIONS[reaction].reduce((sum, f) => sum + f.ms, 0);

/** The row the feet stand on: the last row with anything drawn, as the old app found it. */
const feetRow = (grid: readonly string[]): number => grid.findLastIndex((row) => /[^.]/.test(row));

/** Draws one frame's cells on the canvas (24 × 20). The lift is not drawn here; play() lifts the element. */
export function drawFrame(petId: PetId, frame: Frame, canvas: HTMLCanvasElement): void {
  const pet = PIXEL_PETS[petId];
  const grid = pet.poses[frame.pose];
  if (canvas.width !== CANVAS_W) canvas.width = CANVAS_W;
  if (canvas.height !== CANVAS_H) canvas.height = CANVAS_H;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, CANVAS_W, CANVAS_H);
  const low = feetRow(grid);
  grid.forEach((row, y) => [...row].forEach((ch, x) => {
    const letter = frame.shut && ch === pet.eye[0] ? pet.eye[1] : ch;
    const colour = pet.col[letter];
    if (!colour) return;
    g.fillStyle = colour;
    g.fillRect(x * CELL, y * CELL - (frame.step && y >= low ? 1 : 0), CELL, CELL);
  }));
}

const REST: Frame = { pose: "rest", ms: 0, lift: 0 };

/** Draws the pet's still: the old app's rest frame exactly. */
export function drawRest(petId: PetId, canvas: HTMLCanvasElement): void {
  drawFrame(petId, REST, canvas);
}

/** True when the pet must stay a still: reduced motion, "Keep things still", or nobody can see it. */
export function keepStill(): boolean {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduce || document.documentElement.hasAttribute("data-still") || document.hidden;
}

/* The lift moves the element by the CSS `translate` property, so it composes with the host's `.flip` scaleX(-1) and
   its own placement. It is whole canvas pixels, so the sprite stays on the pixel grid. */
function lift(canvas: HTMLCanvasElement, base: string, px: number): void {
  if (px === 0) { canvas.style.translate = base; return; }
  const cssPerPx = Math.max(1, Math.round((canvas.clientHeight || CANVAS_H * 2) / CANVAS_H));
  canvas.style.translate = `0 ${-px * cssPerPx}px`;
}

interface Run { timer: ReturnType<typeof setTimeout> | undefined; done: () => void; base: string }
const running = new WeakMap<HTMLCanvasElement, Run>();

/* Ends whatever reaction this canvas is playing and puts it back on its still. */
function settle(petId: PetId, canvas: HTMLCanvasElement): void {
  const run = running.get(canvas);
  if (run) {
    clearTimeout(run.timer);
    running.delete(canvas);
    canvas.style.translate = run.base;
    run.done();
  }
  drawRest(petId, canvas);
}

/** Plays a reaction once and resolves when the pet is back on its rest frame. A new call on the same canvas ends the
 *  one before it. Under reduced motion or "Keep things still" it only draws the rest frame. */
export function play(petId: PetId, reaction: Reaction, canvas: HTMLCanvasElement): Promise<void> {
  settle(petId, canvas);
  const frames = REACTIONS[reaction];
  if (keepStill() || !frames.length) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const run: Run = { timer: undefined, done: resolve, base: canvas.style.translate };
    running.set(canvas, run);
    const show = (i: number): void => {
      const frame = frames[i];
      if (!frame || keepStill()) { settle(petId, canvas); return; }
      drawFrame(petId, frame, canvas);
      lift(canvas, run.base, frame.lift);
      run.timer = setTimeout(() => show(i + 1), frame.ms);
    };
    show(0);
  });
}
