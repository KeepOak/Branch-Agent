// Rebuild the native icons from KeepOak's approved app-icon tile without image-tool dependencies.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const brand = join(root, "assets/brand");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const signature = Buffer.from("89504e470d0a1a0a", "hex");
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
  out.writeUInt32BE(data.length, 0); name.copy(out, 4); data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, out.length - 4)), out.length - 4);
  return out;
}
export function decode(png) {
  if (!png.subarray(0, 8).equals(signature)) throw new Error("Expected PNG");
  let width, height, depth, color, interlace;
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
    if (type === "IDAT") compressed.push(data);
    offset += length + 12;
  }
  if (depth !== 8 || color !== 6 || interlace !== 0 || width !== height) throw new Error("Expected non-interlaced square RGBA8 PNG");
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * 4, pixels = Buffer.alloc(height * stride);
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
        const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
        predictor = a <= b && a <= c ? left : b <= c ? up : corner;
      } else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      pixels[y * stride + x] = (raw[at++] + predictor) & 255;
    }
  }
  return { size: width, pixels };
}
function encode(size, pixels) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = size * 4, rows = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) pixels.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
function resize(source, size) {
  const pixels = Buffer.alloc(size * size * 4), scale = source.size / size;
  // Box sampling keeps the small tile legible and avoids a dependency on platform image encoders.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const x0 = x * scale, x1 = (x + 1) * scale, y0 = y * scale, y1 = (y + 1) * scale;
    const sums = [0, 0, 0, 0]; let total = 0;
    for (let sy = Math.floor(y0); sy < Math.min(source.size, Math.ceil(y1)); sy++)
      for (let sx = Math.floor(x0); sx < Math.min(source.size, Math.ceil(x1)); sx++) {
        const weight = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * (Math.min(sy + 1, y1) - Math.max(sy, y0));
        const at = (sy * source.size + sx) * 4;
        for (let c = 0; c < 4; c++) sums[c] += source.pixels[at + c] * weight;
        total += weight;
      }
    for (let c = 0; c < 4; c++) pixels[(y * size + x) * 4 + c] = Math.round(sums[c] / total);
  }
  return encode(size, pixels);
}
const BACKGROUND = [21, 58, 40];
function keyed(source, template) {
  const pixels = Buffer.from(source.pixels);
  for (let at = 0; at < pixels.length; at += 4) {
    const background = pixels[at] === BACKGROUND[0] && pixels[at + 1] === BACKGROUND[1] && pixels[at + 2] === BACKGROUND[2];
    if (background) {
      pixels[at] = 0; pixels[at + 1] = 0; pixels[at + 2] = 0; pixels[at + 3] = 0;
    } else if (template) {
      pixels[at] = 0; pixels[at + 1] = 0; pixels[at + 2] = 0; pixels[at + 3] = 255;
    }
  }
  return { size: source.size, pixels };
}
function buildBrandIcons() {
  const tile = keyed(decode(readFileSync(join(brand, "keepoak-app-icon-512.png"))), false);
  const mark = keyed(decode(readFileSync(join(brand, "keepoak-app-icon-512.png"))), true);
  const png = size => resize(tile, size);
  const templatePng = size => resize(mark, size);
  const images = sizes.map(png);
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  for (let i = 0; i < sizes.length; i++) {
    const at = 6 + i * 16, size = sizes[i];
    header[at] = size === 256 ? 0 : size; header[at + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(images[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += images[i].length;
  }
  writeFileSync(join(root, "assets/branch.ico"), Buffer.concat([header, ...images]));
  const icnsTypes = [[16, "icp4"], [32, "icp5"], [64, "icp6"], [128, "ic07"], [256, "ic08"], [512, "ic09"], [1024, "ic10"], [32, "ic11"], [64, "ic12"], [256, "ic13"], [512, "ic14"]];
  const icns = icnsTypes.map(([size, type]) => {
    const data = png(size), entry = Buffer.alloc(8 + data.length);
    entry.write(type); entry.writeUInt32BE(entry.length, 4); data.copy(entry, 8);
    return entry;
  });
  const icnsHeader = Buffer.alloc(8); icnsHeader.write("icns"); icnsHeader.writeUInt32BE(8 + icns.reduce((n, part) => n + part.length, 0), 4);
  writeFileSync(join(root, "assets/branch.icns"), Buffer.concat([icnsHeader, ...icns]));
  const linux = join(brand, "linux"); mkdirSync(linux, { recursive: true });
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) writeFileSync(join(linux, `branch-${size}.png`), png(size));
  writeFileSync(join(linux, "branch-16@2x.png"), png(32));
  writeFileSync(join(linux, "branchTemplate.png"), templatePng(16));
  writeFileSync(join(linux, "branchTemplate@2x.png"), templatePng(32));
  writeFileSync(join(linux, "branch-32Template.png"), templatePng(32));
  writeFileSync(join(linux, "branch-32Template@2x.png"), templatePng(64));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildBrandIcons();
