/**
 * Procedural mocap library plus trajectory selection — seeded determinism of the
 * generated library and the pointer-lands-in-target selection bounds. Pure.
 */
import { describe, expect, it } from "vitest";
import { buildMocapLibrary, MocapEngine } from "./pw-pointer-mocap.js";
import type { Rect } from "./pw-pointer-mocap.types.js";

describe("mocap library generation", () => {
  it("produces a non-empty, deterministic library for a fixed seed", () => {
    const a = buildMocapLibrary(0x1234);
    const b = buildMocapLibrary(0x1234);
    expect(a.sequences.length).toBeGreaterThan(50);
    expect(a.sequences.length).toBe(b.sequences.length);
    // First sequence identical across builds with the same seed.
    const [firstA] = a.sequences;
    const [firstB] = b.sequences;
    if (!firstA || !firstB) {
      throw new Error("Pinned generated libraries must contain their first sequence");
    }
    expect(firstA.total_dx).toBe(firstB.total_dx);
    expect(firstA.total_dy).toBe(firstB.total_dy);
  });

  it("each generated sequence's summed deltas equal its declared totals", () => {
    const lib = buildMocapLibrary();
    for (const seq of lib.sequences.slice(0, 40)) {
      const dx = seq.movements.reduce((a, m) => a + m.dx, 0);
      const dy = seq.movements.reduce((a, m) => a + m.dy, 0);
      expect(dx).toBe(seq.total_dx);
      expect(dy).toBe(seq.total_dy);
      // Dwell times are positive and bounded (human-plausible per-step).
      for (const m of seq.movements) {
        expect(m.dt).toBeGreaterThan(0);
        expect(m.dt).toBeLessThan(0.1);
      }
    }
  });
});

describe("MocapEngine trajectory selection bounds", () => {
  const engine = new MocapEngine();

  function landsInside(startX: number, startY: number, rect: Rect): boolean {
    const seq =
      engine.findSequenceLandingInRect(startX, startY, rect) ??
      engine.findSequenceWithStretchAndRotation(startX, startY, rect);
    if (!seq) {
      return false;
    }
    const fx = startX + seq.total_dx;
    const fy = startY + seq.total_dy;
    return fx >= rect.left && fx <= rect.right && fy >= rect.top && fy <= rect.bottom;
  }

  it("lands the pointer inside a target rect in several directions", () => {
    const start = { x: 400, y: 400 };
    const targets: Rect[] = [
      { left: 690, top: 390, right: 730, bottom: 430 }, // right
      { left: 120, top: 380, right: 160, bottom: 420 }, // left
      { left: 380, top: 700, right: 420, bottom: 740 }, // down
      { left: 380, top: 120, right: 420, bottom: 160 }, // up
    ];
    for (const rect of targets) {
      expect(landsInside(start.x, start.y, rect)).toBe(true);
    }
  });

  it("expands the base library with rotational perturbations", () => {
    const base = buildMocapLibrary().sequences.length;
    expect(engine.size).toBeGreaterThan(base);
  });
});

describe("pinned motion reproducibility and fallback", () => {
  it("reproduces every sequence including jitter and timing for a fixed seed", () => {
    expect(buildMocapLibrary(0x1234)).toEqual(buildMocapLibrary(0x1234));
    expect(buildMocapLibrary(0x1234).sequences).not.toEqual(buildMocapLibrary(0x1235).sequences);
  });

  it("reproduces the seeded engine's sequence selections", () => {
    const a = new MocapEngine(undefined, 37);
    const b = new MocapEngine(undefined, 37);
    const rect = { left: 100, top: 0, right: 1_000, bottom: 400 };
    for (let i = 0; i < 8; i++) {
      expect(a.findSequenceLandingInRect(0, 0, rect)).toEqual(
        b.findSequenceLandingInRect(0, 0, rect),
      );
    }
  });

  const sequence = {
    movements: [{ dx: 100, dy: 0, dt: 0.01 }],
    total_dx: 100,
    total_dy: 0,
    click_down_dt: 0.07,
    click_up_dt: 0.06,
  };
  const engine = new MocapEngine({ meta: {}, sequences: [sequence] });

  it("stretches and rotates when no original endpoint lands in the rectangle", () => {
    const rect = { left: 169, top: 74, right: 171, bottom: 76 };
    expect(engine.findSequenceLandingInRect(0, 0, rect)).toBeNull();
    const fitted = engine.findSequenceWithStretchAndRotation(0, 0, rect);
    expect(fitted).not.toBeNull();
    expect(fitted!.total_dx).toBeGreaterThanOrEqual(rect.left);
    expect(fitted!.total_dx).toBeLessThanOrEqual(rect.right);
    expect(fitted!.total_dy).toBeGreaterThanOrEqual(rect.top);
    expect(fitted!.total_dy).toBeLessThanOrEqual(rect.bottom);
    expect(fitted!.movements.reduce((sum, m) => sum + m.dx, 0)).toBe(fitted!.total_dx);
    expect(fitted!.movements.reduce((sum, m) => sum + m.dy, 0)).toBe(fitted!.total_dy);
  });

  it("retains the source no-match result outside its scale admissibility", () => {
    expect(
      engine.findSequenceWithStretchAndRotation(0, 0, {
        left: 400,
        top: 400,
        right: 401,
        bottom: 401,
      }),
    ).toBeNull();
  });
});
