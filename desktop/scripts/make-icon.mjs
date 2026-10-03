// Wraps the Branch mark PNG in a .ico (PNG-in-ICO, Windows Vista and later) for the exe and shortcuts.
//   node desktop/scripts/make-icon.mjs <png> <ico>
import { readFileSync, writeFileSync } from "node:fs";

const [png, ico] = process.argv.slice(2);
const data = readFileSync(png);
const width = data.readUInt32BE(16);
const height = data.readUInt32BE(20);
const header = Buffer.alloc(6 + 16);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(width >= 256 ? 0 : width, 6);
header.writeUInt8(height >= 256 ? 0 : height, 7);
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(data.length, 14);
header.writeUInt32LE(header.length, 18);
writeFileSync(ico, Buffer.concat([header, data]));
console.log(`icon ${width}x${height} -> ${ico}`);
