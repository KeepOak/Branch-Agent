/**
 * Decodes the inlined PNGs (generated/assets.gen.ts) into upstream's SpriteData payloads — the same
 * work upstream's browserMock.ts does with fetched PNGs, but from base64 so nothing touches the network
 * (and no data: URL fetch that a CSP could block). Decoded once per page and shared by every mount.
 */
import { rgbaToHex } from '../../../core/src/assets/colorUtils.js';
import {
  CARPET_GRID_COLS,
  CARPET_MARCHING_SQUARES_COUNT,
  CARPET_TILE_SIZE,
  CHAR_FRAME_H,
  CHAR_FRAME_W,
  CHAR_FRAMES_PER_ROW,
  CHARACTER_DIRECTIONS,
  FLOOR_TILE_SIZE,
  PET_FRAME_H,
  PET_FRAME_W_LARGE,
  PET_FRAME_W_SMALL,
  PET_IDLE_FRAMES_VERT,
  PET_WALK_FRAMES_HORIZ,
  PET_WALK_FRAMES_VERT,
  WALL_BITMASK_COUNT,
  WALL_GRID_COLS,
  WALL_PIECE_HEIGHT,
  WALL_PIECE_WIDTH,
} from '../../../core/src/assets/constants.js';
import type { CatalogEntry, CharacterDirectionSprites } from '../../../core/src/assets/types.js';
import { ASSETS } from './generated/assets.gen.js';

export interface DecodedPng {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface PetFramesRaw {
  walkDown: string[][][];
  idleDown: string[][][];
  walkUp: string[][][];
  idleUp: string[][][];
  walkRight: string[][][];
}

export interface DecodedAssets {
  characters: CharacterDirectionSprites[];
  floorSprites: string[][][];
  wallSets: string[][][][];
  carpetSets: string[][][][];
  furnitureCatalog: CatalogEntry[];
  furnitureSprites: Record<string, string[][]>;
  pets: PetFramesRaw[];
  petNames: string[];
  trunkSheets: Record<string, DecodedPng>;
}

async function decodeB64(b64: string): Promise<DecodedPng> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('[PixelOffice] no 2d context for PNG decode');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: img.data };
}

/** Same as upstream browserMock.readSprite: a w×h window of the PNG as hex SpriteData. */
export function readSprite(png: DecodedPng, w: number, h: number, ox = 0, oy = 0): string[][] {
  const sprite: string[][] = [];
  for (let y = 0; y < h; y++) {
    const row: string[] = [];
    for (let x = 0; x < w; x++) {
      const i = ((oy + y) * png.width + (ox + x)) * 4;
      row.push(rgbaToHex(png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]));
    }
    sprite.push(row);
  }
  return sprite;
}

function decodeCharacter(png: DecodedPng): CharacterDirectionSprites {
  const out: CharacterDirectionSprites = { down: [], up: [], right: [] };
  CHARACTER_DIRECTIONS.forEach((dir, d) => {
    for (let f = 0; f < CHAR_FRAMES_PER_ROW; f++) {
      out[dir].push(readSprite(png, CHAR_FRAME_W, CHAR_FRAME_H, f * CHAR_FRAME_W, d * CHAR_FRAME_H));
    }
  });
  return out;
}

function decodeGrid(png: DecodedPng, count: number, cols: number, w: number, h: number): string[][][] {
  const set: string[][][] = [];
  for (let m = 0; m < count; m++) set.push(readSprite(png, w, h, (m % cols) * w, Math.floor(m / cols) * h));
  return set;
}

/** Upstream core/src/assets/pngDecoder.ts decodePetPng layout (96×96 sheet). */
function decodePet(png: DecodedPng): PetFramesRaw {
  const row = (y: number, n: number, w: number, start = 0) =>
    Array.from({ length: n }, (_, i) => readSprite(png, w, PET_FRAME_H, (start + i) * w, y));
  return {
    walkDown: row(0, PET_WALK_FRAMES_VERT, PET_FRAME_W_SMALL),
    idleDown: row(0, PET_IDLE_FRAMES_VERT, PET_FRAME_W_SMALL, PET_WALK_FRAMES_VERT),
    walkUp: row(PET_FRAME_H, PET_WALK_FRAMES_VERT, PET_FRAME_W_SMALL),
    idleUp: row(PET_FRAME_H, PET_IDLE_FRAMES_VERT, PET_FRAME_W_SMALL, PET_WALK_FRAMES_VERT),
    walkRight: row(PET_FRAME_H * 2, PET_WALK_FRAMES_HORIZ, PET_FRAME_W_LARGE),
  };
}

let decoded: Promise<DecodedAssets> | null = null;

export function loadAssets(): Promise<DecodedAssets> {
  decoded ??= (async () => {
    const all = (list: readonly string[]) => Promise.all(list.map(decodeB64));
    const [chars, floors, walls, carpets, pets] = await Promise.all([
      all(ASSETS.characters),
      all(ASSETS.floors),
      all(ASSETS.walls),
      all(ASSETS.carpets),
      all(ASSETS.pets.map((p) => p.png)),
    ]);
    const catalog = ASSETS.catalog as unknown as CatalogEntry[];
    const furnitureSprites: Record<string, string[][]> = {};
    await Promise.all(
      catalog.map(async (e) => {
        const png = await decodeB64((ASSETS.furniturePngs as Record<string, string>)[e.furniturePath]);
        furnitureSprites[e.id] = readSprite(png, e.width, e.height);
      }),
    );
    const trunkSheets: Record<string, DecodedPng> = {};
    await Promise.all(
      Object.entries(ASSETS.trunkPngs as Record<string, string>).map(async ([k, v]) => {
        trunkSheets[k] = await decodeB64(v);
      }),
    );
    return {
      characters: chars.map(decodeCharacter),
      floorSprites: floors.map((p) => readSprite(p, FLOOR_TILE_SIZE, FLOOR_TILE_SIZE)),
      wallSets: walls.map((p) =>
        decodeGrid(p, WALL_BITMASK_COUNT, WALL_GRID_COLS, WALL_PIECE_WIDTH, WALL_PIECE_HEIGHT),
      ),
      carpetSets: carpets.map((p) =>
        decodeGrid(p, CARPET_MARCHING_SQUARES_COUNT, CARPET_GRID_COLS, CARPET_TILE_SIZE, CARPET_TILE_SIZE),
      ),
      furnitureCatalog: catalog,
      furnitureSprites,
      pets: pets.map(decodePet),
      petNames: ASSETS.pets.map((p) => p.name),
      trunkSheets,
    };
  })();
  decoded.catch(() => {
    decoded = null;
  });
  return decoded;
}

let fontReady: Promise<void> | null = null;

/** Upstream ships FS Pixel Sans via @font-face; inside a shadow root that is ignored, so register it
 *  document-wide with the FontFace API (subset to Latin-1 + punctuation by scripts/build-assets). */
export function loadPixelFont(): Promise<void> {
  fontReady ??= (async () => {
    try {
      const bin = atob(ASSETS.font);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const face = new FontFace('FS Pixel Sans', bytes.buffer, { style: 'normal', weight: '400' });
      await face.load();
      document.fonts.add(face);
    } catch (err) {
      console.warn('[PixelOffice] pixel font unavailable, using sans-serif', err);
    }
  })();
  return fontReady;
}
