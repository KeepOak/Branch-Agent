/**
 * Unpacks the verified computer-use downloads (on-demand.ts) without a tar
 * dependency: regular files and folders only. Runs only after the archive's
 * SHA-256 and size matched their pins.
 */
import { createReadStream } from "node:fs";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { createGunzip } from "node:zlib";

type TarEntry = {
  remaining: number;
  padding: number;
  kind: "file" | "pax" | "longname" | "skip";
  out?: FileHandle;
  memory?: Buffer[];
};

export type TarballLayout =
  /** An npm package tarball: every entry sits under "package/". */
  | { kind: "npm-package" }
  /** A release archive: only the named top-level files are kept, the rest skipped. */
  | { kind: "only"; files: readonly string[] };

/**
 * Unpacks a gzipped tarball into root. Files are written without execute bits;
 * the paths that had them are returned so the caller marks them executable.
 * Links, devices and paths outside root are refused.
 */
export async function extractTarball(
  tarball: string,
  root: string,
  layout: TarballLayout,
): Promise<string[]> {
  await mkdir(root, { recursive: true });
  const executables: string[] = [];
  let pending: Buffer = Buffer.alloc(0);
  let entry: TarEntry | undefined;
  let skip = 0;
  let paxPath: string | undefined;
  let longName: string | undefined;
  let ended = false;

  const finishEntry = async (current: TarEntry) => {
    await current.out?.close();
    if (current.kind === "pax" && current.memory) {
      paxPath = parsePaxPath(Buffer.concat(current.memory).toString("utf8"));
    } else if (current.kind === "longname" && current.memory) {
      longName = Buffer.concat(current.memory).toString("utf8").replace(/\0.*$/su, "");
    }
    skip = current.padding;
    entry = undefined;
  };

  try {
    // pipe() does not forward a read error (a missing file): hand it to gunzip so the loop ends with it.
    const gunzip = createGunzip();
    const source = createReadStream(tarball);
    source.once("error", (error) => gunzip.destroy(error));
    for await (const chunk of source.pipe(gunzip)) {
      pending = pending.length ? Buffer.concat([pending, chunk as Buffer]) : (chunk as Buffer);
      while (!ended) {
        if (entry) {
          if (entry.remaining > 0) {
            if (pending.length === 0) {
              break;
            }
            const take = pending.subarray(0, Math.min(entry.remaining, pending.length));
            pending = pending.subarray(take.length);
            entry.remaining -= take.length;
            if (entry.out) {
              await entry.out.write(take);
            } else if (entry.memory) {
              entry.memory.push(Buffer.from(take));
            }
          }
          if (entry.remaining === 0) {
            await finishEntry(entry);
          }
          continue;
        }
        if (skip > 0) {
          if (pending.length === 0) {
            break;
          }
          const drop = Math.min(skip, pending.length);
          pending = pending.subarray(drop);
          skip -= drop;
          continue;
        }
        if (pending.length < 512) {
          break;
        }
        const header = pending.subarray(0, 512);
        pending = pending.subarray(512);
        if (header.every((byte) => byte === 0)) {
          ended = true;
          break;
        }
        const size = readOctal(header, 124, 12);
        const padding = (512 - (size % 512)) % 512;
        const type = String.fromCharCode(header[156] || 48);
        if (type === "x") {
          entry = { remaining: size, padding, kind: "pax", memory: [] };
          continue;
        }
        if (type === "g") {
          entry = { remaining: size, padding, kind: "skip" };
          continue;
        }
        if (type === "L") {
          entry = { remaining: size, padding, kind: "longname", memory: [] };
          continue;
        }
        const name = paxPath ?? longName ?? readHeaderName(header);
        paxPath = undefined;
        longName = undefined;
        const relative = layoutPath(name, layout);
        if (relative === undefined) {
          entry = { remaining: size, padding, kind: "skip" };
          continue;
        }
        if (type === "5") {
          await mkdir(path.join(root, relative), { recursive: true });
          entry = { remaining: size, padding, kind: "skip" };
          continue;
        }
        if (type !== "0" && type !== "7") {
          throw new Error(`refusing tar entry ${name} of type ${JSON.stringify(type)}`);
        }
        const target = path.join(root, relative);
        await mkdir(path.dirname(target), { recursive: true });
        const out = await open(target, "w", 0o644);
        if ((readOctal(header, 100, 8) & 0o111) !== 0) {
          executables.push(target);
        }
        entry = { remaining: size, padding, kind: "file", out };
      }
      if (ended) {
        break;
      }
    }
  } finally {
    await entry?.out?.close().catch(() => undefined);
  }
  if (entry && entry.remaining > 0) {
    throw new Error("The download ended in the middle of a file.");
  }
  return executables;
}

function readOctal(header: Buffer, offset: number, length: number): number {
  const field = header.subarray(offset, offset + length);
  if ((field[0] ?? 0) & 0x80) {
    let value = 0;
    for (let index = 1; index < field.length; index += 1) {
      value = value * 256 + (field[index] ?? 0);
    }
    return value;
  }
  const text = field.toString("ascii").replace(/\0.*$/su, "").trim();
  return text ? Number.parseInt(text, 8) : 0;
}

function readHeaderName(header: Buffer): string {
  const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/su, "");
  const magic = header.subarray(257, 262).toString("ascii");
  const prefix =
    magic === "ustar" ? header.subarray(345, 500).toString("utf8").replace(/\0.*$/su, "") : "";
  return prefix ? prefix + "/" + name : name;
}

function parsePaxPath(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const match = /^\d+ path=(.*)$/su.exec(line);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/** The entry's path under root, undefined to skip it; throws for anything outside root. */
function layoutPath(name: string, layout: TarballLayout): string | undefined {
  const normalized = path.posix.normalize(name.replace(/\\/gu, "/"));
  const unsafe = (relative: string) =>
    !relative ||
    normalized.includes("\0") ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.posix.isAbsolute(relative);
  if (layout.kind === "npm-package") {
    const relative = normalized.startsWith("package/") ? normalized.slice("package/".length) : "";
    if (unsafe(relative)) {
      throw new Error(`refusing tar entry outside the package: ${name}`);
    }
    return relative;
  }
  // Only the named top-level files are written; every other entry is skipped unread.
  const relative = normalized.replace(/^\.\//u, "");
  return layout.files.includes(relative) && !unsafe(relative) ? relative : undefined;
}
