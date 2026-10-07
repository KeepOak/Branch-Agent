import { ZOOM_MAX, ZOOM_MIN } from '../constants.js';
import { TILE_SIZE } from '../office/types.js';

/** Bottom toolbar height kept clear when fitting the office into its pane (CSS px). */
export const TOOLBAR_RESERVE_CSS = 52;

/** Largest integer zoom (device px per sprite px) at which the whole office fits the pane. */
export function fitZoom(cssW: number, cssH: number, cols: number, rows: number): number {
  const dpr = window.devicePixelRatio || 1;
  const z = Math.floor(
    Math.min((cssW * dpr) / (cols * TILE_SIZE), ((cssH - TOOLBAR_RESERVE_CSS) * dpr) / ((rows + 0.5) * TILE_SIZE)),
  );
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}
