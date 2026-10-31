// Build the Expo launcher and splash PNGs from KeepOak's approved desktop app-icon tile.
// Source: desktop/assets/brand/keepoak-app-icon-512.png (cream oak leaf + acorn on #153a28).
//
//   node scripts/generate-brand-icons.mjs
//
// Writes:
//   assets/icon.png            1024×1024 opaque tile (iOS / legacy Android)
//   assets/adaptive-icon.png   1024×1024 transparent foreground, mark inside the 66% safe zone
//   assets/splash-icon.png     1024×1024 transparent mark for expo-splash-screen
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = resolve(root, '../desktop/assets/brand/keepoak-app-icon-512.png');
const OUT = join(root, 'assets');
export const ICON_SIZE = 1024;
export const BACKGROUND = [21, 58, 40];
export const BACKGROUND_HEX = '#153a28';
// Android adaptive-icon viewport is 108dp; the inner 72dp circle is the safe zone (66.67%).
const SAFE_ZONE = 72 / 108;
const ADAPTIVE_FIT = SAFE_ZONE * 0.88;

const signature = Buffer.from('89504e470d0a1a0a', 'hex');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc(bytes) {
  let n = 0xffffffff;
  for (const byte of bytes) n = crcTable[(n ^ byte) & 255] ^ (n >>> 8);
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, out.length - 4)), out.length - 4);
  return out;
}
export function decode(png) {
  if (!png.subarray(0, 8).equals(signature)) throw new Error('Expected PNG');
  let width, height, depth, color, interlace;
  const compressed = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      color = data[9];
      interlace = data[12];
    }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  if (depth !== 8 || color !== 6 || interlace !== 0 || width !== height) {
    throw new Error('Expected non-interlaced square RGBA8 PNG');
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0, at = 0; y < height; y++) {
    const filter = raw[at++];
    for (let x = 0; x < stride; x++) {
      const left = x < 4 ? 0 : pixels[y * stride + x - 4];
      const up = y ? pixels[(y - 1) * stride + x] : 0;
      const corner = y && x >= 4 ? pixels[(y - 1) * stride + x - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >>> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const a = Math.abs(p - left);
        const b = Math.abs(p - up);
        const c = Math.abs(p - corner);
        predictor = a <= b && a <= c ? left : b <= c ? up : corner;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = (raw[at++] + predictor) & 255;
    }
  }
  return { size: width, pixels };
}
function encode(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = size * 4;
  const rows = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function isBackground(pixels, at) {
  return pixels[at] === BACKGROUND[0] && pixels[at + 1] === BACKGROUND[1] && pixels[at + 2] === BACKGROUND[2];
}
function keyed(source) {
  const pixels = Buffer.from(source.pixels);
  for (let at = 0; at < pixels.length; at += 4) {
    if (isBackground(pixels, at) || pixels[at + 3] === 0) {
      pixels[at] = 0;
      pixels[at + 1] = 0;
      pixels[at + 2] = 0;
      pixels[at + 3] = 0;
    }
  }
  return { size: source.size, pixels };
}
function boundingBox(source) {
  let minX = source.size;
  let minY = source.size;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.size; y++) {
    for (let x = 0; x < source.size; x++) {
      if (source.pixels[(y * source.size + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('Icon tile has no foreground pixels');
  return { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
function sample(source, sx, sy) {
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(source.size - 1, x0 + 1);
  const y1 = Math.min(source.size - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;
  const out = [0, 0, 0, 0];
  const corners = [
    [x0, y0, (1 - tx) * (1 - ty)],
    [x1, y0, tx * (1 - ty)],
    [x0, y1, (1 - tx) * ty],
    [x1, y1, tx * ty],
  ];
  for (const [x, y, w] of corners) {
    const at = (y * source.size + x) * 4;
    const a = source.pixels[at + 3] * w;
    out[0] += source.pixels[at] * a;
    out[1] += source.pixels[at + 1] * a;
    out[2] += source.pixels[at + 2] * a;
    out[3] += a;
  }
  if (out[3] <= 0) return [0, 0, 0, 0];
  return [Math.round(out[0] / out[3]), Math.round(out[1] / out[3]), Math.round(out[2] / out[3]), Math.round(out[3])];
}
function placeMark(source, size, fit) {
  const box = boundingBox(source);
  const target = size * fit;
  const scale = Math.min(target / box.width, target / box.height);
  const outW = box.width * scale;
  const outH = box.height * scale;
  const originX = (size - outW) / 2;
  const originY = (size - outH) / 2;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = box.minX + (x + 0.5 - originX) / scale - 0.5;
      const sy = box.minY + (y + 0.5 - originY) / scale - 0.5;
      if (sx < 0 || sy < 0 || sx >= source.size || sy >= source.size) continue;
      const [r, g, b, a] = sample(source, sx, sy);
      const at = (y * size + x) * 4;
      pixels[at] = r;
      pixels[at + 1] = g;
      pixels[at + 2] = b;
      pixels[at + 3] = a;
    }
  }
  return { size, pixels };
}
function pixelDouble(source) {
  if (source.size * 2 !== ICON_SIZE) throw new Error(`Expected ${ICON_SIZE / 2}px source tile`);
  const pixels = Buffer.alloc(ICON_SIZE * ICON_SIZE * 4);
  for (let y = 0; y < source.size; y++) {
    for (let x = 0; x < source.size; x++) {
      const src = source.pixels.subarray((y * source.size + x) * 4, (y * source.size + x) * 4 + 4);
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          src.copy(pixels, ((y * 2 + dy) * ICON_SIZE + x * 2 + dx) * 4);
        }
      }
    }
  }
  return { size: ICON_SIZE, pixels };
}

export function generateBrandIcons({ sourcePath = SOURCE, outDir = OUT } = {}) {
  const tile = decode(readFileSync(sourcePath));
  const mark = keyed(tile);
  const tile1024 = pixelDouble(tile);
  writeFileSync(join(outDir, 'icon.png'), encode(ICON_SIZE, tile1024.pixels));
  writeFileSync(join(outDir, 'adaptive-icon.png'), encode(ICON_SIZE, placeMark(mark, ICON_SIZE, ADAPTIVE_FIT).pixels));
  // Opaque branded tile so the splash mark stays visible on both #f6f8f9 and #0b0f12.
  writeFileSync(join(outDir, 'splash-icon.png'), encode(ICON_SIZE, tile1024.pixels));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateBrandIcons();
}
