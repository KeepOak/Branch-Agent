const GRID_W = 12;
const GRID_H = 10;
const CELL = 2;
const CANVAS_W = GRID_W * CELL;
const CANVAS_H = GRID_H * CELL;
const STEP_MS = 360;
const PIXEL_PETS = {
  squirrel: {
    name: "Squirrel",
    col: { o: "#B8652B", b: "#F2D0AE", e: "#1B1A18" },
    eye: ["e", "o"],
    poses: {
      rest: ["............", ".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", ".oooooooooo.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"],
      squash: ["............", "............", ".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"],
      stretch: [".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", ".oooooooooo.", ".oooooooooo.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"],
      perk: ["........o...", ".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", ".oooooooooo.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"]
    }
  },
  owl: {
    name: "Owl",
    col: { o: "#6E5A45", w: "#F4EDE0", e: "#1B1A18", y: "#E0A33B", b: "#A38B6C" },
    eye: ["e", "w"],
    poses: {
      rest: ["............", "...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "..obbbbbbo..", "...oo..oo...", "............"],
      squash: ["............", "............", "...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "...oo..oo...", "............"],
      stretch: ["...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "..obbbbbbo..", "..obbbbbbo..", "...oo..oo...", "............"],
      perk: ["...o....o...", "...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "..obbbbbbo..", "...oo..oo...", "............"]
    }
  },
  hedgehog: {
    name: "Hedgehog",
    col: { s: "#5B4A3B", f: "#D9B48F", e: "#1B1A18" },
    eye: ["e", "f"],
    poses: {
      rest: ["............", "...s.s.s....", "..sssssss...", ".sssssssss..", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"],
      squash: ["............", "............", "...s.s.s....", "..sssssss...", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"],
      stretch: ["...s.s.s....", "..sssssss...", ".sssssssss..", ".sssssssss..", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"],
      perk: ["...s.s.s....", "...s.s.s....", "..sssssss...", ".sssssssss..", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"]
    }
  }
};
function hop(peak, shut) {
  return [
    { pose: "stretch", ms: 120, lift: Math.round(peak * 0.6), shut },
    { pose: "stretch", ms: 195, lift: peak, shut },
    { pose: "rest", ms: 105, lift: Math.round(peak * 0.4), shut },
    { pose: "squash", ms: 120, lift: 0 },
    { pose: "rest", ms: 360, lift: 0 }
  ];
}
const REACTIONS = {
  pat: [{ pose: "squash", ms: 300, lift: 0, shut: true }, ...hop(4, false)],
  cheer: [{ pose: "squash", ms: 120, lift: 0 }, ...hop(7, true)],
  notice: [
    { pose: "rest", ms: 150, lift: 0, shut: true },
    { pose: "rest", ms: 150, lift: 0 },
    { pose: "perk", ms: 420, lift: 0 },
    { pose: "perk", ms: STEP_MS, lift: 0, step: true },
    { pose: "perk", ms: STEP_MS, lift: 0 },
    { pose: "perk", ms: STEP_MS, lift: 0, step: true },
    { pose: "rest", ms: STEP_MS, lift: 0 }
  ]
};
const reactionMs = (reaction) => REACTIONS[reaction].reduce((sum, f) => sum + f.ms, 0);
const feetRow = (grid) => grid.findLastIndex((row) => /[^.]/.test(row));
function drawFrame(petId, frame, canvas) {
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
const REST = { pose: "rest", ms: 0, lift: 0 };
function drawRest(petId, canvas) {
  drawFrame(petId, REST, canvas);
}
function keepStill() {
  const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return reduce || document.documentElement.hasAttribute("data-still") || document.hidden;
}
function lift(canvas, base, px) {
  if (px === 0) {
    canvas.style.translate = base;
    return;
  }
  const cssPerPx = Math.max(1, Math.round((canvas.clientHeight || CANVAS_H * 2) / CANVAS_H));
  canvas.style.translate = `0 ${-px * cssPerPx}px`;
}
const running = /* @__PURE__ */ new WeakMap();
function settle(petId, canvas) {
  const run = running.get(canvas);
  if (run) {
    clearTimeout(run.timer);
    running.delete(canvas);
    canvas.style.translate = run.base;
    run.done();
  }
  drawRest(petId, canvas);
}
function play(petId, reaction, canvas) {
  settle(petId, canvas);
  const frames = REACTIONS[reaction];
  if (keepStill() || !frames.length) return Promise.resolve();
  return new Promise((resolve) => {
    const run = { timer: void 0, done: resolve, base: canvas.style.translate };
    running.set(canvas, run);
    const show = (i) => {
      const frame = frames[i];
      if (!frame || keepStill()) {
        settle(petId, canvas);
        return;
      }
      drawFrame(petId, frame, canvas);
      lift(canvas, run.base, frame.lift);
      run.timer = setTimeout(() => show(i + 1), frame.ms);
    };
    show(0);
  });
}
export {
  CANVAS_H,
  CANVAS_W,
  CELL,
  GRID_H,
  GRID_W,
  PIXEL_PETS,
  REACTIONS,
  STEP_MS,
  drawFrame,
  drawRest,
  keepStill,
  play,
  reactionMs
};
