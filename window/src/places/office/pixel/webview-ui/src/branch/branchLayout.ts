/**
 * Branch's default office, built from upstream furniture (pixel-agents webview-ui/public/assets) and
 * upstream's layout model (OfficeLayout v1 with Areas). Three rooms:
 *   Office   one desk per Trunk (+1 spare), chairs behind the desks so the front-facing Trunk looks
 *            face you; the monitor stands beside them
 *   Guests   sofas around a coffee table for grafted agents (A2A visitors), mapped by upstream's Areas
 *   Meeting  a table with chairs where group chats show their plaques
 * Wide panes put Guests and Meeting to the right of the Office; narrow panes stack them below.
 * Furniture uids are stable (seat-<n>, guest-sofa-<n>, ...) so remembered seats survive a re-layout.
 * Only used until the owner saves their own layout in the editor.
 */
import type { ColorValue } from '../components/ui/types.js';
import type { OfficeLayout, PlacedFurniture, TileType as TileTypeVal } from '../office/types.js';
import { TileType } from '../office/types.js';

export const AREA_OFFICE = 'Office';
export const AREA_GUESTS = 'Guests';
export const AREA_MEETING = 'Meeting';
export const MEETING_TABLE_UID = 'meeting-table';
/** Rows from one desk row to the next: desk (2) + an aisle wide enough for name plates and bubbles. */
const DESK_PITCH = 4;

/** Upstream default-layout-1.json colours. */
const WALL_COLOR: ColorValue = { h: 214, s: 30, b: -100, c: -55 };
const WOOD: ColorValue = { h: 25, s: 48, b: -43, c: -88 };
const CARPET: ColorValue = { h: 209, s: 39, b: -25, c: -80 };
const TILE: ColorValue = { h: 209, s: 0, b: -16, c: -8 };

interface Grid {
  cols: number;
  rows: number;
  tiles: TileTypeVal[];
  colors: Array<ColorValue | null>;
  areas: Array<string | null>;
  furniture: PlacedFurniture[];
}

function grid(cols: number, rows: number): Grid {
  const n = cols * rows;
  return {
    cols,
    rows,
    tiles: new Array<TileTypeVal>(n).fill(TileType.VOID),
    colors: new Array<ColorValue | null>(n).fill(null),
    areas: new Array<string | null>(n).fill(null),
    furniture: [],
  };
}

function fill(g: Grid, c0: number, r0: number, c1: number, r1: number, t: TileTypeVal, color: ColorValue | null, area: string | null): void {
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * g.cols + c;
      g.tiles[i] = t;
      g.colors[i] = color;
      g.areas[i] = t === TileType.WALL ? null : area;
    }
  }
}

function wall(g: Grid, c0: number, r0: number, c1: number, r1: number): void {
  fill(g, c0, r0, c1, r1, TileType.WALL, WALL_COLOR, null);
}

function put(g: Grid, uid: string, type: string, col: number, row: number): void {
  g.furniture.push({ uid, type, col, row });
}

/** A desk unit at (x,y): 3×2 desk, chair on the desk's back row facing down, monitor beside it. */
function deskUnit(g: Grid, i: number, x: number, y: number): void {
  put(g, `desk-${i}`, 'DESK_FRONT', x, y);
  put(g, `seat-${i}`, 'CUSHIONED_CHAIR_FRONT', x + 1, y);
  put(g, `pc-${i}`, 'PC_BACK', x + 2, y);
  if (i % 3 === 1) put(g, `mug-${i}`, 'COFFEE', x, y + 1);
}

interface Section {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

function office(g: Grid, s: Section, desks: number, perRow: number): void {
  fill(g, s.c0, s.r0, s.c1, s.r1, TileType.FLOOR_7, WOOD, AREA_OFFICE);
  for (let i = 0; i < desks; i++) {
    const x = s.c0 + 1 + (i % perRow) * 4;
    const y = s.r0 + 1 + Math.floor(i / perRow) * DESK_PITCH;
    deskUnit(g, i, x, y);
  }
  // Rest corner in the spare rows under the desks: where resting Trunks sit (upstream sofas are seats).
  const deskBottom = s.r0 + 1 + Math.ceil(desks / perRow) * DESK_PITCH;
  if (s.r1 - deskBottom >= 2) {
    const y = s.r1 - 1;
    put(g, 'rest-sofa-0', 'SOFA_FRONT', s.c0 + 1, y - 1);
    put(g, 'rest-table', 'SMALL_TABLE_FRONT', s.c0 + 3, y - 1);
    if (s.c1 - s.c0 >= 9) put(g, 'rest-sofa-1', 'SOFA_FRONT', s.c0 + 5, y - 1);
    put(g, 'rest-plant', 'PLANT_2', s.c0 + 8 <= s.c1 - 2 ? s.c0 + 8 : s.c1 - 1, y - 2);
  }
  // Wall decor on the wall row above the office (bottom row on the wall tile, upper row above it).
  const top = s.r0 - 2;
  const span = s.c1 - s.c0 + 1;
  put(g, 'office-shelf-a', 'DOUBLE_BOOKSHELF', s.c0, top);
  if (span >= 8) put(g, 'office-clock', 'CLOCK', s.c0 + 3, top);
  if (span >= 11) put(g, 'office-board', 'WHITEBOARD', s.c0 + 5, top);
  if (span >= 14) put(g, 'office-shelf-b', 'DOUBLE_BOOKSHELF', s.c1 - 2, top);
  put(g, 'office-plant', 'PLANT', s.c1, s.r1 - 1);
  put(g, 'office-bin', 'BIN', s.c0, s.r1);
}

function lounge(g: Grid, s: Section, guests: number): void {
  fill(g, s.c0, s.r0, s.c1, s.r1, TileType.FLOOR_1, CARPET, AREA_GUESTS);
  const sofas = Math.max(2, Math.ceil(guests / 2));
  const perRow = Math.max(1, Math.floor((s.c1 - s.c0) / 3));
  for (let k = 0; k < sofas; k++) {
    const x = s.c0 + 1 + (k % perRow) * 3;
    const y = s.r0 + 1 + Math.floor(k / perRow) * 4;
    put(g, `guest-sofa-${k}`, 'SOFA_FRONT', x, y);
    if (k % perRow === 0) put(g, `guest-table-${k}`, 'COFFEE_TABLE', x + 1, y + 1);
  }
  put(g, 'guest-plant', 'LARGE_PLANT', s.c1 - 1, s.r1 - 2);
  put(g, 'guest-painting', 'LARGE_PAINTING', s.c0 + 1, s.r0 - 2);
  put(g, 'guest-hanging', 'HANGING_PLANT', s.c1, s.r0 - 2);
}

function meeting(g: Grid, s: Section): void {
  fill(g, s.c0, s.r0, s.c1, s.r1, TileType.FLOOR_9, TILE, AREA_MEETING);
  const tx = s.c0 + Math.max(1, Math.floor((s.c1 - s.c0 + 1 - 3) / 2));
  const ty = s.r0;
  put(g, MEETING_TABLE_UID, 'TABLE_FRONT', tx, ty);
  for (let k = 0; k < 2; k++) {
    put(g, `meet-chair-l${k}`, 'WOODEN_CHAIR_SIDE', tx - 1, ty + 1 + k);
    put(g, `meet-chair-r${k}`, 'WOODEN_CHAIR_SIDE:left', tx + 3, ty + 1 + k);
  }
  put(g, 'meet-board', 'WHITEBOARD', s.c0, s.r0 - 2);
  put(g, 'meet-plant', 'PLANT_2', s.c1, s.r1 - 1);
}

export interface LayoutPlan {
  trunks: number;
  guests: number;
  wide: boolean;
  /** Desks per row; default chosen from the desk count. */
  perRow?: number;
}

/** Tiles a plan occupies (for choosing the plan that gives the biggest integer zoom). */
export function planSize(plan: LayoutPlan): { cols: number; rows: number } {
  const l = generateBranchLayout(plan);
  return { cols: l.cols, rows: l.rows };
}

export function generateBranchLayout({ trunks, guests, wide, perRow: rowHint }: LayoutPlan): OfficeLayout {
  const desks = Math.max(4, trunks + 1);
  const perRow = rowHint ?? (wide ? Math.min(6, Math.max(3, Math.ceil(desks / 2))) : 3);
  const unitRows = Math.ceil(desks / perRow);
  const officeW = perRow * 4 + 1;
  const officeH = unitRows * DESK_PITCH + 1;
  const sofaRows = Math.ceil(Math.max(2, Math.ceil(guests / 2)) / 2);
  const loungeH = 5 + (sofaRows - 1) * 4;
  const meetH = 5;

  let g: Grid;
  if (wide) {
    const sideW = 8;
    const rightH = loungeH + 3 + meetH;
    const inner = Math.max(officeH, rightH);
    const cols = 1 + officeW + 1 + sideW + 1;
    const rows = 2 + inner + 1;
    g = grid(cols, rows);
    wall(g, 0, 1, cols - 1, rows - 1);
    const oc0 = 1;
    const oc1 = officeW;
    office(g, { c0: oc0, r0: 3, c1: oc1, r1: rows - 2 }, desks, perRow);
    fill(g, oc0, 2, oc1, 2, TileType.FLOOR_7, WOOD, AREA_OFFICE);
    const sc0 = oc1 + 2;
    const sc1 = cols - 2;
    lounge(g, { c0: sc0, r0: 3, c1: sc1, r1: 2 + loungeH }, guests);
    fill(g, sc0, 2, sc1, 2, TileType.FLOOR_1, CARPET, AREA_GUESTS);
    const mr0 = 2 + loungeH + 3;
    meeting(g, { c0: sc0, r0: mr0, c1: sc1, r1: rows - 2 });
    fill(g, sc0, mr0 - 1, sc1, mr0 - 1, TileType.FLOOR_9, TILE, AREA_MEETING);
    // doorways: office ↔ lounge, office ↔ meeting, lounge ↔ meeting
    fill(g, oc1 + 1, 4, oc1 + 1, 5, TileType.FLOOR_7, WOOD, AREA_OFFICE);
    fill(g, oc1 + 1, mr0 + 1, oc1 + 1, mr0 + 2, TileType.FLOOR_7, WOOD, AREA_OFFICE);
    fill(g, sc1 - 2, mr0 - 2, sc1 - 1, mr0 - 2, TileType.FLOOR_1, CARPET, AREA_GUESTS);
  } else {
    // Narrow: the office on top, the lounge and the meeting room side by side below it.
    const loungeW = 7;
    const meetW = 5;
    const cols = Math.max(officeW, loungeW + 1 + meetW) + 2;
    const bh = Math.max(loungeH, meetH);
    const rows = 6 + officeH + bh;
    g = grid(cols, rows);
    wall(g, 0, 1, cols - 1, rows - 1);
    const c0 = 1;
    const c1 = cols - 2;
    const o1 = 2 + officeH;
    fill(g, c0, 2, c1, 2, TileType.FLOOR_7, WOOD, AREA_OFFICE);
    office(g, { c0, r0: 3, c1, r1: o1 }, desks, perRow);
    const b0 = o1 + 3;
    const b1 = rows - 2;
    const l1c = c0 + loungeW - 1;
    const m0c = l1c + 2;
    fill(g, c0, b0 - 1, l1c, b0 - 1, TileType.FLOOR_1, CARPET, AREA_GUESTS);
    lounge(g, { c0, r0: b0, c1: l1c, r1: b1 }, guests);
    fill(g, m0c, b0 - 1, c1, b0 - 1, TileType.FLOOR_9, TILE, AREA_MEETING);
    meeting(g, { c0: m0c, r0: b0, c1, r1: b1 });
    // doorways: office ↔ lounge, office ↔ meeting
    fill(g, l1c - 2, o1 + 1, l1c - 1, o1 + 1, TileType.FLOOR_1, CARPET, AREA_GUESTS);
    fill(g, m0c + 2, o1 + 1, m0c + 2, o1 + 1, TileType.FLOOR_9, TILE, AREA_MEETING);
  }

  return {
    version: 1,
    cols: g.cols,
    rows: g.rows,
    tiles: g.tiles,
    tileColors: g.colors,
    furniture: g.furniture,
    areas: [
      { label: AREA_OFFICE, color: '#feca57' },
      { label: AREA_GUESTS, color: '#48dbfb' },
      { label: AREA_MEETING, color: '#1dd1a1' },
    ],
    areaTiles: g.areas,
    pets: [],
  };
}

/** The folder→Area mapping upstream uses to bias seat choice: Trunks to the Office, guests to Guests. */
export const BRANCH_AREA_MAPPINGS: Record<string, string[]> = {
  Trunks: [AREA_OFFICE],
  Grafted: [AREA_GUESTS],
};
