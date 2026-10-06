/**
 * Day and night office lighting, matched to the app's light and dark themes. The phase colours are
 * SweetSophia openclaw-pixel-agents src/game/Schedule.ts DAY_PHASES ("Midday" for day, "Night" for
 * night); at night every Trunk working at a desk lights its face with the monitor glow, the way the
 * dashboards' DayNightCycle overlays do. Only the room is tinted — never the empty (VOID) space.
 */
import type { OfficeState } from '../office/engine/officeState.js';
import { CharacterState, TILE_SIZE, TileType } from '../office/types.js';

const MIDDAY = 'rgba(255, 255, 240, 0.03)';
const NIGHT = 'rgba(10, 10, 50, 0.30)';
const GLOW = '120, 190, 255';

export type OfficeTheme = 'dark' | 'light';

export function makeLighting(getOffice: () => OfficeState, getTheme: () => OfficeTheme) {
  return (ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number, zoom: number): void => {
    const os = getOffice();
    const map = os.tileMap;
    const s = TILE_SIZE * zoom;
    const night = getTheme() === 'dark';
    ctx.save();
    ctx.beginPath();
    for (let r = 0; r < map.length; r++) {
      for (let c = 0; c < map[r].length; c++) {
        if (map[r][c] === TileType.VOID) continue;
        // walls are drawn 16 px taller than their tile; light the overhang too
        const up = map[r][c] === TileType.WALL ? s : 0;
        ctx.rect(offsetX + c * s, offsetY + r * s - up, s, s + up);
      }
    }
    ctx.clip();
    ctx.fillStyle = night ? NIGHT : MIDDAY;
    ctx.fillRect(offsetX, offsetY - s, map[0]?.length * s || 0, map.length * s + s);
    {
      // Monitor glow for every Trunk at work: strong at night, a faint screen light by day.
      const strength = night ? 0.3 : 0.12;
      ctx.globalCompositeOperation = night ? 'lighter' : 'screen';
      for (const ch of os.characters.values()) {
        if (ch.state !== CharacterState.TYPE || !ch.isActive || ch.offline) continue;
        const x = offsetX + ch.x * zoom;
        const y = offsetY + (ch.y - 4) * zoom;
        const rad = 22 * zoom;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, `rgba(${GLOW}, ${strength})`);
        g.addColorStop(1, `rgba(${GLOW}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
    ctx.restore();
  };
}
