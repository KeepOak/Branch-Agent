/**
 * Where a Trunk's name plate sits, in world pixels.
 *
 * A seated Trunk is drawn behind its desk with the monitor beside the chair
 * (branchLayout's desk unit), so a plate hung from the Trunk's feet lands on
 * the desk front and a long name runs across the screen. While seated, the
 * plate goes under the furniture in front of the chair instead, in the aisle
 * the layout leaves between desk rows. A Trunk that is walking keeps the plate
 * at its feet: there is no desk to clear.
 */
import type { Character, PlacedFurniture, Seat } from '../office/types.js';
import { TILE_SIZE } from '../office/types.js';

/** Space between the bottom of the desk unit and the top of the plate. */
export const NAME_PLATE_GAP_PX = 2;

type Footprint = (type: string) => { w: number; h: number } | undefined;

/** Bottom edge (world px) of the furniture in front of a seat: the tiles beside the chair
 *  and the row under it. Null when nothing stands there. */
export function deskBottomY(seat: Seat, furniture: readonly PlacedFurniture[], footprint: Footprint): number | null {
  const c0 = seat.seatCol - 1;
  const c1 = seat.seatCol + 1;
  const r0 = seat.seatRow;
  const r1 = seat.seatRow + 1;
  let bottom: number | null = null;
  for (const f of furniture) {
    if (f.uid === seat.uid) continue;
    const fp = footprint(f.type);
    if (!fp) continue;
    const overlaps = f.col <= c1 && f.col + fp.w - 1 >= c0 && f.row <= r1 && f.row + fp.h - 1 >= r0;
    if (!overlaps) continue;
    const y = (f.row + fp.h) * TILE_SIZE;
    if (bottom === null || y > bottom) bottom = y;
  }
  return bottom;
}

/** World y of the top of a character's name plate. `feetY` is the plate top used when the
 *  character is not sitting at a desk. */
export function namePlateWorldY(
  ch: Pick<Character, 'seatId' | 'tileCol' | 'tileRow' | 'path'>,
  seats: ReadonlyMap<string, Seat>,
  furniture: readonly PlacedFurniture[],
  footprint: Footprint,
  feetY: number,
): number {
  const seat = ch.seatId ? seats.get(ch.seatId) : undefined;
  const seated = !!seat && ch.path.length === 0 && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow;
  if (!seated) return feetY;
  const bottom = deskBottomY(seat, furniture, footprint);
  return bottom === null ? feetY : Math.max(feetY, bottom + NAME_PLATE_GAP_PX);
}
