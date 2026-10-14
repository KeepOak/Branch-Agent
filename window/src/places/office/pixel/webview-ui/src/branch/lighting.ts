import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, TILE_SIZE, TileType } from '../office/types.js';

export type OfficeTheme = 'dark' | 'light';

interface LightPhase {
  veilRgb: string;
  veilAlpha: number;
  glowAlpha: number;
  glowBlend: GlobalCompositeOperation;
}

interface Rect {
  x: number;
  y: number;
  size: number;
}

const PHASES: Record<OfficeTheme, LightPhase> = {
  light: { veilRgb: '255, 255, 240', veilAlpha: 0.03, glowAlpha: 0.12, glowBlend: 'screen' },
  dark: { veilRgb: '10, 10, 50', veilAlpha: 0.3, glowAlpha: 0.3, glowBlend: 'lighter' },
};

const GLOW_RGB = '120, 190, 255';
const GLOW_RADIUS = 22;
const GLOW_LIFT = 4;

function roomRects(office: OfficeState, offsetX: number, offsetY: number, tile: number): Rect[] {
  const rects: Rect[] = [];
  office.tileMap.forEach((cells, row) => {
    cells.forEach((kind, col) => {
      if (kind === TileType.VOID) return;
      const x = offsetX + col * tile;
      const y = offsetY + row * tile;
      rects.push({ x, y, size: tile });
      if (kind === TileType.WALL) rects.push({ x, y: y - tile, size: tile });
    });
  });
  return rects;
}

function addRectPath(ctx: CanvasRenderingContext2D, rects: Rect[]): void {
  ctx.beginPath();
  for (const r of rects) ctx.rect(r.x, r.y, r.size, r.size);
}

function rgba(rgb: string, alpha: number): string {
  return `rgba(${rgb}, ${alpha})`;
}

function drawVeil(ctx: CanvasRenderingContext2D, rects: Rect[], phase: LightPhase): void {
  ctx.fillStyle = rgba(phase.veilRgb, phase.veilAlpha);
  addRectPath(ctx, rects);
  ctx.fill();
}

function glowCentres(office: OfficeState, offsetX: number, offsetY: number, zoom: number) {
  const centres: Array<{ x: number; y: number }> = [];
  for (const ch of office.characters.values()) {
    if (ch.state !== CharacterState.TYPE || !ch.isActive || ch.offline) continue;
    centres.push({ x: offsetX + ch.x * zoom, y: offsetY + (ch.y - GLOW_LIFT) * zoom });
  }
  return centres;
}

function drawGlow(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, alpha: number): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, rgba(GLOW_RGB, alpha));
  gradient.addColorStop(1, rgba(GLOW_RGB, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
}

function drawGlows(
  ctx: CanvasRenderingContext2D,
  office: OfficeState,
  rects: Rect[],
  offsetX: number,
  offsetY: number,
  zoom: number,
  phase: LightPhase,
): void {
  const centres = glowCentres(office, offsetX, offsetY, zoom);
  if (centres.length === 0) return;
  ctx.save();
  addRectPath(ctx, rects);
  ctx.clip();
  ctx.globalCompositeOperation = phase.glowBlend;
  for (const c of centres) drawGlow(ctx, c.x, c.y, GLOW_RADIUS * zoom, phase.glowAlpha);
  ctx.restore();
}

export function makeLighting(getOffice: () => OfficeState, getTheme: () => OfficeTheme) {
  return (ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, zoom: number): void => {
    const office = getOffice();
    const phase = PHASES[getTheme()];
    const rects = roomRects(office, offsetX, offsetY, TILE_SIZE * zoom);
    if (rects.length === 0) return;
    ctx.save();
    drawVeil(ctx, rects, phase);
    drawGlows(ctx, office, rects, offsetX, offsetY, zoom, phase);
    ctx.restore();
  };
}
