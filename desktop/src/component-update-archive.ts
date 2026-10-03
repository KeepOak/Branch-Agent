import { createReadStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createGunzip } from "node:zlib";

class ArchiveReader {
  private pending = Buffer.alloc(0);
  private readonly chunks: AsyncIterator<Buffer>;
  constructor(stream: AsyncIterable<Buffer>) { this.chunks = stream[Symbol.asyncIterator](); }
  async take(size: number): Promise<Buffer> {
    while (this.pending.length < size) {
      const next = await this.chunks.next();
      if (next.done) throw new Error("Truncated component archive");
      this.pending = Buffer.concat([this.pending, next.value]);
    }
    const result = this.pending.subarray(0, size);
    this.pending = this.pending.subarray(size);
    return result;
  }
  async finish(): Promise<void> {
    if (this.pending.some(byte => byte !== 0)) throw new Error("Trailing archive data");
    for (let next = await this.chunks.next(); !next.done; next = await this.chunks.next()) {
      if (next.value.some(byte => byte !== 0)) throw new Error("Trailing archive data");
    }
  }
}

const text = (header: Buffer, start: number, end: number): string => header.subarray(start, end).toString("utf8").replace(/\0.*$/, "");
function octal(value: string): number {
  if (!/^[0-7]+$/.test(value.trim())) throw new Error("Invalid archive size or checksum");
  const result = Number.parseInt(value.trim(), 8);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error("Invalid archive number");
  return result;
}

export function safeArchivePath(name: string): string {
  const parts = name.replace(/\/$/, "").split("/");
  if (!name || parts.some(part => !part || part === "." || part === ".." || /[\\:\x00-\x1f]/.test(part)
    || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) {
    throw new Error("Unsafe component archive path");
  }
  return parts.join("/");
}

function entry(header: Buffer): { name: string; size: number; mode: number; directory: boolean } {
  const checksum = octal(text(header, 148, 156));
  const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
  if (checksum !== actual || text(header, 257, 263) !== "ustar") throw new Error("Invalid ustar header");
  const type = header[156];
  if (type !== 0 && type !== 48 && type !== 53) throw new Error("Archive links/extensions are unsupported");
  const prefix = text(header, 345, 500);
  const name = safeArchivePath((prefix ? `${prefix}/` : "") + text(header, 0, 100));
  const size = octal(text(header, 124, 136));
  if (type === 53 && size !== 0) throw new Error("Archive directory has content");
  return { name, size, directory: type === 53, mode: octal(text(header, 100, 108)) & 0o777 };
}

async function writeEntry(reader: ArchiveReader, file: string, size: number, mode: number): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file, "wx", mode);
  try {
    for (let remaining = size; remaining > 0;) {
      const chunk = await reader.take(Math.min(remaining, 65536));
      await handle.writeFile(chunk);
      remaining -= chunk.length;
    }
  } finally { await handle.close(); }
  const padding = (512 - size % 512) % 512;
  if (padding) await reader.take(padding);
}

/** Only regular ustar files/directories; extraction always targets a new, private staging directory. */
export async function extractComponentArchive(archive: string, destination: string, expectedBytes: number): Promise<void> {
  const input = createReadStream(archive);
  const gzip = createGunzip();
  input.on("error", error => gzip.destroy(error));
  input.pipe(gzip);
  const reader = new ArchiveReader(gzip);
  const names = new Set<string>();
  let expanded = 0;
  try {
    for (;;) {
      const header = await reader.take(512);
      if (header.every(byte => byte === 0)) { await reader.finish(); break; }
      const item = entry(header);
      const key = process.platform === "win32" ? item.name.toLowerCase() : item.name;
      if (names.has(key)) throw new Error("Duplicate archive entry");
      names.add(key);
      expanded += item.size;
      if (expanded > expectedBytes) throw new Error("Expanded component size mismatch");
      const file = join(destination, item.name);
      if (item.directory) await mkdir(file, { recursive: true });
      else await writeEntry(reader, file, item.size, item.mode);
    }
    if (expanded !== expectedBytes) throw new Error("Expanded component size mismatch");
  } finally { input.destroy(); gzip.destroy(); }
}
