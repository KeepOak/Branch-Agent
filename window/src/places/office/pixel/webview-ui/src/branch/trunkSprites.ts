/**
 * Trunk looks as office characters. Sheets come from scripts/trunk_sprites.py (the app's own character
 * clips, pixelized). Each look becomes an upstream CharacterSprites set:
 *   typing  = the look's "work" loop        reading = its "read" loop
 *   walk    = its "walk" loop when it has one (Branch's mascot), otherwise a one-pixel hop of the idle
 *             still — the looks are front-facing figures, so they hop across the office facing you
 *   poses   = every other state loop (wait, sleep, think, search, talk, yay, oops, idle)
 * The classic pebble is tinted per Trunk the way the app paints it: fill with the Trunk's colour,
 * multiply the body shading, keep the body's alpha, then draw the light and the eye layer on top.
 *
 * spriteKey formats: "look:<id>"  |  "pebble:<shape 0-4>:<eyes>:<#rrggbb>"
 * (upstream's six humans use palette 0-5 with no spriteKey).
 */
import type { CharacterSprites } from '../office/sprites/spriteData.js';
import type { Direction as DirT, SpriteData } from '../office/types.js';
import { Direction } from '../office/types.js';
import type { DecodedPng } from './assets.js';
import { ASSETS } from './generated/assets.gen.js';

const META = ASSETS.trunkMeta;
const CW = META.cellW;
const CH = META.cellH;

export const TRUNK_LOOKS = META.looks;
export const PEBBLE_EYES = META.pebble.eyes;
export const PEBBLE_SHAPES = META.pebble.shapes;

let sheets: Record<string, DecodedPng> = {};

export function setTrunkSheets(s: Record<string, DecodedPng>): void {
  sheets = s;
}

type Rgba = [number, number, number, number];

function px(png: DecodedPng, x: number, y: number): Rgba {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
}

function hex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function cell(row: number, frame: number, paint: (x: number, y: number) => string): SpriteData {
  const out: SpriteData = [];
  for (let y = 0; y < CH; y++) {
    const line: string[] = [];
    for (let x = 0; x < CW; x++) line.push(paint(frame * CW + x, row * CH + y));
    out.push(line);
  }
  return out;
}

function lookFrame(png: DecodedPng, row: number, frame: number): SpriteData {
  return cell(row, frame, (x, y) => {
    const [r, g, b, a] = px(png, x, y);
    return a > 110 ? hex(r, g, b) : '';
  });
}

function parseColor(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return [0x56, 0x61, 0x6b];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function pebbleFrame(
  body: DecodedPng,
  light: DecodedPng,
  fx: DecodedPng,
  color: [number, number, number],
  row: number,
  frame: number,
): SpriteData {
  return cell(row, frame, (x, y) => {
    const [br, bg, bb, ba] = px(body, x, y);
    const [fr, fg, fb, fa] = px(fx, x, y);
    if (ba <= 110 && fa <= 110) return '';
    let r = (color[0] * br) / 255;
    let g = (color[1] * bg) / 255;
    let b = (color[2] * bb) / 255;
    const [lr, lg, lb, la] = px(light, x, y);
    const k = la / 255;
    r = r * (1 - k) + lr * k;
    g = g * (1 - k) + lg * k;
    b = b * (1 - k) + lb * k;
    if (fa > 110) return hex(fr, fg, fb);
    return hex(r, g, b);
  });
}

function flip(s: SpriteData): SpriteData {
  return s.map((r) => [...r].reverse());
}

function lift(s: SpriteData): SpriteData {
  return [...s.slice(1), new Array<string>(s[0].length).fill('')];
}

type Frames = (state: string) => SpriteData[] | null;

function assemble(frames: Frames): CharacterSprites {
  const idle = frames('idle')!;
  const work = frames('work') ?? idle;
  const read = frames('read') ?? work;
  const walkLoop = frames('walk');
  const side = frames('side');
  const backF = frames('back')?.[0];
  type Four = [SpriteData, SpriteData, SpriteData, SpriteData];
  type Two = [SpriteData, SpriteData];
  const hop = (f: SpriteData): Four => [lift(f), f, lift(f), f];
  const four = (f: readonly SpriteData[]): Four => [f[0], f[1], f[2], f[3]];
  const pair = (f: SpriteData[]): Two => [f[1] ?? f[0], f[2] ?? f[0]];
  const flipAll = <T extends SpriteData[]>(f: T): T => f.map(flip) as T;
  // Walking down: the front-facing loop (the mascot's walk) or a hop of the idle still. Walking left /
  // right: the generated side walk; up: the generated back view, hopping. Without them, the front hop.
  const down = walkLoop ? four(walkLoop) : hop(idle[0]);
  const right = side ? four(side) : down;
  const up = backF ? hop(backF) : down;
  const sit = (f: SpriteData | undefined, fallback: Two): Two => (f ? [f, f] : fallback);
  const poses: Record<string, SpriteData[]> = {};
  for (const st of META.rows) {
    const f = frames(st);
    if (f && st !== 'walk' && st !== 'side' && st !== 'back') poses[st] = f;
  }
  return {
    walk: {
      [Direction.DOWN]: down,
      [Direction.UP]: up,
      [Direction.RIGHT]: right,
      [Direction.LEFT]: flipAll(right),
    } as Record<DirT, Four>,
    typing: {
      [Direction.DOWN]: pair(work),
      [Direction.UP]: sit(backF, pair(work)),
      [Direction.RIGHT]: sit(side?.[1], pair(work)),
      [Direction.LEFT]: flipAll(sit(side?.[1], pair(work))),
    } as Record<DirT, Two>,
    reading: {
      [Direction.DOWN]: pair(read),
      [Direction.UP]: sit(backF, pair(read)),
      [Direction.RIGHT]: sit(side?.[1], pair(read)),
      [Direction.LEFT]: flipAll(sit(side?.[1], pair(read))),
    } as Record<DirT, Two>,
    poses,
  };
}

/** Resolve a spriteKey to its sprite set, or null for unknown keys (upstream palette is used then). */
export function trunkSpriteFactory(key: string): CharacterSprites | null {
  const [kind, a, b, c] = key.split(':');
  if (kind === 'look') {
    const png = sheets[a];
    const look = META.looks.find((l) => l.id === a);
    if (!png || !look) return null;
    return assemble((st) => {
      if (!look.states.includes(st)) return null;
      const row = META.rows.indexOf(st);
      return Array.from({ length: META.frames }, (_, i) => lookFrame(png, row, i));
    });
  }
  if (kind === 'pebble') {
    const shape = Math.max(0, Math.min(PEBBLE_SHAPES - 1, Number(a) || 0));
    const eyes = PEBBLE_EYES.includes(b) ? b : 'round';
    const body = sheets[`pebble-body-${shape}`];
    const light = sheets[`pebble-light-${shape}`];
    const fx = sheets[`pebble-fx-${eyes}`];
    if (!body || !light || !fx) return null;
    const color = parseColor(c ?? '');
    return assemble((st) => {
      if (!META.pebble.states.includes(st)) return null;
      const row = META.rows.indexOf(st);
      return Array.from({ length: META.frames }, (_, i) => pebbleFrame(body, light, fx, color, row, i));
    });
  }
  return null;
}

/** The look a Trunk gets by default: its app look, else the classic pebble in its own colour. */
export function defaultSpriteKey(agent: {
  look?: string;
  colorHint?: string;
  shape?: number;
  eyes?: string;
}): string {
  if (agent.look && agent.look !== 'classic' && META.looks.some((l) => l.id === agent.look)) {
    return `look:${agent.look}`;
  }
  const color = /^#[0-9a-f]{6}$/i.test(agent.colorHint ?? '') ? agent.colorHint! : '#56616B';
  return `pebble:${agent.shape ?? 0}:${agent.eyes ?? 'round'}:${color}`;
}
