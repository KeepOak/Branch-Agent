/**
 * BRANCH PORT: two bubbles upstream does not have, drawn in upstream's bubble style
 * (bubble-permission.json palette: border #555566, fill #EEEEFF, amber #CCA700).
 *  - needs-you: amber "!" plus the count of things waiting on the owner
 *  - A2A chat: a message bubble shown while two Trunks talk
 */
import type { SpriteData } from '../types.js';

const B = '#555566';
const F = '#EEEEFF';
const A = '#CCA700';
const M = '#3794FF';

/** 3x5 pixel digits. */
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};
const BANG = ['1', '1', '1', '0', '1'];

function frame(width: number): SpriteData {
  const rows: SpriteData = [];
  for (let r = 0; r < 13; r++) {
    const row: string[] = [];
    for (let c = 0; c < width; c++) {
      if (r <= 9) {
        const edge = r === 0 || r === 9 || c === 0 || c === width - 1;
        const corner = (r === 0 || r === 9) && (c === 0 || c === width - 1);
        row.push(corner ? '' : edge ? B : F);
      } else {
        const mid = Math.floor(width / 2);
        const on = (r === 10 && Math.abs(c - mid) <= 1) || (r === 11 && c === mid);
        row.push(on ? B : '');
      }
    }
    rows.push(row);
  }
  return rows;
}

function stamp(sprite: SpriteData, glyph: string[], x: number, y: number, color: string): void {
  glyph.forEach((line, dy) => {
    for (let dx = 0; dx < line.length; dx++) if (line[dx] === '1') sprite[y + dy][x + dx] = color;
  });
}

const needsCache = new Map<number, SpriteData>();

export function getNeedsBubbleSprite(count: number): SpriteData {
  const hit = needsCache.get(count);
  if (hit) return hit;
  const text = count > 99 ? '99+' : String(count);
  const glyphs = text.split('').map((ch) => DIGITS[ch] ?? DIGITS['0']);
  const inner = 1 + 2 + glyphs.length * 4 - 1;
  const width = Math.max(11, inner + 6);
  const sprite = frame(width);
  let x = Math.floor((width - inner) / 2);
  stamp(sprite, BANG, x, 2, A);
  x += 3;
  for (const g of glyphs) {
    stamp(sprite, g, x, 2, A);
    x += 4;
  }
  needsCache.set(count, sprite);
  return sprite;
}

let chatSprite: SpriteData | null = null;

export function getChatBubbleSprite(): SpriteData {
  if (chatSprite) return chatSprite;
  const s = frame(11);
  for (const [y, len] of [
    [3, 7],
    [5, 7],
    [7, 4],
  ] as const) {
    for (let x = 2; x < 2 + len; x++) s[y - 1][x] = M;
  }
  chatSprite = s;
  return s;
}
