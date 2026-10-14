import { describe, expect, it } from 'vitest';

import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, TILE_SIZE, TileType } from '../office/types.js';
import { makeLighting, type OfficeTheme } from './lighting.js';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Gradient {
  x0: number;
  y0: number;
  r0: number;
  x1: number;
  y1: number;
  r1: number;
  stops: Array<[number, string]>;
  addColorStop(offset: number, color: string): void;
}

interface Fill {
  style: unknown;
  composite: string;
  rects: Rect[];
}

class FakeContext {
  fillStyle: unknown = '#000000';
  globalCompositeOperation = 'source-over';
  events: string[] = [];
  fills: Fill[] = [];
  clips: Rect[][] = [];
  gradients: Gradient[] = [];
  private path: Rect[] = [];

  save(): void {
    this.events.push('save');
  }

  restore(): void {
    this.events.push('restore');
  }

  beginPath(): void {
    this.path = [];
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.path.push({ x, y, w, h });
  }

  clip(): void {
    this.events.push('clip');
    this.clips.push([...this.path]);
  }

  fill(): void {
    this.events.push('fill');
    this.fills.push({ style: this.fillStyle, composite: this.globalCompositeOperation, rects: [...this.path] });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.events.push('fillRect');
    this.fills.push({ style: this.fillStyle, composite: this.globalCompositeOperation, rects: [{ x, y, w, h }] });
  }

  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): Gradient {
    const gradient: Gradient = {
      x0, y0, r0, x1, y1, r1,
      stops: [],
      addColorStop(offset, color) {
        this.stops.push([offset, color]);
      },
    };
    this.gradients.push(gradient);
    return gradient;
  }

  get veilFill(): Fill | undefined {
    return this.fills.find((f) => typeof f.style === 'string');
  }

  get glowFills(): Fill[] {
    return this.fills.filter((f) => typeof f.style !== 'string');
  }
}

interface FakeChar {
  state?: string;
  isActive?: boolean;
  offline?: boolean;
  x?: number;
  y?: number;
}

function officeWith(tiles: number[][], chars: FakeChar[] = []): OfficeState {
  const characters = new Map(
    chars.map((c, i) => [
      i,
      { state: CharacterState.IDLE, isActive: false, offline: false, x: 0, y: 0, ...c },
    ]),
  );
  return { tileMap: tiles, characters } as unknown as OfficeState;
}

function draw(office: OfficeState | undefined, theme: OfficeTheme, zoom = 1, offset = { x: 0, y: 0 }) {
  const ctx = new FakeContext();
  const lighting = makeLighting(() => office as OfficeState, () => theme);
  lighting(ctx as unknown as CanvasRenderingContext2D, offset.x, offset.y, zoom);
  return ctx;
}

const VOID = TileType.VOID;
const FLOOR_1 = TileType.FLOOR_1;
const WALL = TileType.WALL;

describe('lighting veil', () => {
  it('uses the warm-white veil at 3 percent in the light theme', () => {
    const ctx = draw(officeWith([[FLOOR_1]]), 'light');
    expect(ctx.veilFill?.style).toBe('rgba(255, 255, 240, 0.03)');
    expect(ctx.veilFill?.composite).toBe('source-over');
  });

  it('uses the navy veil at 30 percent in the dark theme', () => {
    const ctx = draw(officeWith([[FLOOR_1]]), 'dark');
    expect(ctx.veilFill?.style).toBe('rgba(10, 10, 50, 0.3)');
    expect(ctx.veilFill?.composite).toBe('source-over');
  });

  it('reads the theme on every draw', () => {
    const office = officeWith([[FLOOR_1]]);
    let theme: OfficeTheme = 'light';
    const lighting = makeLighting(() => office, () => theme);
    const first = new FakeContext();
    lighting(first as unknown as CanvasRenderingContext2D, 0, 0, 1);
    theme = 'dark';
    const second = new FakeContext();
    lighting(second as unknown as CanvasRenderingContext2D, 0, 0, 1);
    expect(first.veilFill?.style).toBe('rgba(255, 255, 240, 0.03)');
    expect(second.veilFill?.style).toBe('rgba(10, 10, 50, 0.3)');
  });
});

describe('lighting room mask', () => {
  it('covers non-empty tiles and a one-tile strip above each wall, never void tiles', () => {
    const office = officeWith([
      [VOID, VOID, FLOOR_1],
      [WALL, FLOOR_1, VOID],
    ]);
    const ctx = draw(office, 'dark', 2, { x: 5, y: 7 });
    const tile = TILE_SIZE * 2;
    const covered = ctx.veilFill?.rects ?? [];
    expect(covered).toEqual([
      { x: 5 + 2 * tile, y: 7, w: tile, h: tile },
      { x: 5, y: 7 + tile, w: tile, h: tile },
      { x: 5, y: 7, w: tile, h: tile },
      { x: 5 + tile, y: 7 + tile, w: tile, h: tile },
    ]);
    const voidTile = { x: 5 + tile, y: 7, w: tile, h: tile };
    expect(covered).not.toContainEqual(voidTile);
  });

  it('scales the tile size and the wall strip with zoom', () => {
    const ctx = draw(officeWith([[WALL]]), 'light', 3, { x: 0, y: 0 });
    const size = TILE_SIZE * 3;
    expect(ctx.veilFill?.rects).toEqual([
      { x: 0, y: 0, w: size, h: size },
      { x: 0, y: -size, w: size, h: size },
    ]);
  });

  it('draws nothing for a room map with no rows, and raises no error', () => {
    const ctx = draw(officeWith([]), 'dark');
    expect(ctx.events).toEqual([]);
    expect(ctx.fills).toEqual([]);
  });

  it('draws nothing when every tile is empty space', () => {
    const ctx = draw(officeWith([[VOID, VOID]]), 'dark');
    expect(ctx.events).toEqual([]);
  });

  it('fails with an error and draws nothing when there is no office state', () => {
    const ctx = new FakeContext();
    const lighting = makeLighting(() => undefined as unknown as OfficeState, () => 'dark');
    expect(() => lighting(ctx as unknown as CanvasRenderingContext2D, 0, 0, 1)).toThrow();
    expect(ctx.events).toEqual([]);
  });
});

describe('lighting monitor glows', () => {
  const glowingChar: FakeChar = { state: CharacterState.TYPE, isActive: true, x: 40, y: 60 };

  it('adds a glow for a working, active, online character, centred 4 map pixels above it', () => {
    const ctx = draw(officeWith([[FLOOR_1]], [glowingChar]), 'dark', 3, { x: 10, y: 20 });
    expect(ctx.glowFills).toHaveLength(1);
    const gradient = ctx.gradients[0];
    expect(gradient.x0).toBe(10 + 40 * 3);
    expect(gradient.y0).toBe(20 + (60 - 4) * 3);
    expect(gradient.r1).toBe(22 * 3);
  });

  it('fades from 30 percent at the centre to nothing at the edge in the dark theme', () => {
    const ctx = draw(officeWith([[FLOOR_1]], [glowingChar]), 'dark');
    expect(ctx.gradients[0].stops).toEqual([
      [0, 'rgba(120, 190, 255, 0.3)'],
      [1, 'rgba(120, 190, 255, 0)'],
    ]);
    expect(ctx.glowFills[0].composite).toBe('lighter');
  });

  it('uses a 12 percent centre and screen blending in the light theme', () => {
    const ctx = draw(officeWith([[FLOOR_1]], [glowingChar]), 'light');
    expect(ctx.gradients[0].stops[0]).toEqual([0, 'rgba(120, 190, 255, 0.12)']);
    expect(ctx.glowFills[0].composite).toBe('screen');
  });

  it('draws no glow for idle, inactive, or offline characters', () => {
    const office = officeWith(
      [[FLOOR_1]],
      [
        { state: CharacterState.IDLE, isActive: true },
        { state: CharacterState.TYPE, isActive: false },
        { state: CharacterState.TYPE, isActive: true, offline: true },
      ],
    );
    const ctx = draw(office, 'dark');
    expect(ctx.glowFills).toHaveLength(0);
  });

  it('clips glows to the room area', () => {
    const ctx = draw(officeWith([[FLOOR_1]], [glowingChar]), 'dark', 1, { x: 0, y: 0 });
    const clipIndex = ctx.events.indexOf('clip');
    const glowIndex = ctx.events.indexOf('fillRect');
    expect(clipIndex).toBeGreaterThan(-1);
    expect(glowIndex).toBeGreaterThan(clipIndex);
    expect(ctx.clips[0]).toEqual([{ x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE }]);
  });

  it('balances save and restore around the overlay', () => {
    const ctx = draw(officeWith([[FLOOR_1]], [glowingChar]), 'dark');
    const saves = ctx.events.filter((e) => e === 'save').length;
    const restores = ctx.events.filter((e) => e === 'restore').length;
    expect(saves).toBe(restores);
  });
});
