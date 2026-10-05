// Branch: the media part of a Git backup's files scope — images, audio, video and PDFs that Trunks made
// or received, from <stateDir>/media. Only real media is copied: a file needs a media extension AND the
// matching file signature, so tokens, keys, JSON records or text renamed or placed in media/ stay out.
// Symbolic links are never followed. Files over the per-file limit, or past the total, are skipped and
// counted; the walk is in path order so the same files are kept from one backup to the next.
import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MEDIA_MAX_FILE_MB = 50;
export const DEFAULT_MEDIA_MAX_TOTAL_MB = 1024;
const MB = 1024 * 1024;
/** Rebuilt from originals on demand; never worth a backup copy. */
const SKIPPED_MEDIA_DIRS = new Set(["playback-transcode"]);

type Signature = (head: Buffer) => boolean;
const ascii = (head: Buffer, at: number, text: string) =>
  head.subarray(at, at + text.length).toString("latin1") === text;
const bytes = (head: Buffer, values: number[]) => values.every((v, i) => head[i] === v);
const riff = (kind: string): Signature => (h) => ascii(h, 0, "RIFF") && ascii(h, 8, kind);
const isoBmff: Signature = (h) => ascii(h, 4, "ftyp");
const mpegAudio: Signature = (h) => ascii(h, 0, "ID3") || (h[0] === 0xff && ((h[1] ?? 0) & 0xe0) === 0xe0);
const matroska: Signature = (h) => bytes(h, [0x1a, 0x45, 0xdf, 0xa3]);

/** Media extensions and the file signatures each may carry. */
const MEDIA_SIGNATURES: Record<string, Signature> = {
  png: (h) => bytes(h, [0x89, 0x50, 0x4e, 0x47]),
  jpg: (h) => bytes(h, [0xff, 0xd8, 0xff]),
  jpeg: (h) => bytes(h, [0xff, 0xd8, 0xff]),
  gif: (h) => ascii(h, 0, "GIF8"),
  webp: riff("WEBP"),
  bmp: (h) => ascii(h, 0, "BM"),
  tif: (h) => ascii(h, 0, "II*\0") || ascii(h, 0, "MM\0*"),
  tiff: (h) => ascii(h, 0, "II*\0") || ascii(h, 0, "MM\0*"),
  heic: isoBmff,
  heif: isoBmff,
  avif: isoBmff,
  pdf: (h) => ascii(h, 0, "%PDF"),
  mp3: mpegAudio,
  aac: (h) => h[0] === 0xff && ((h[1] ?? 0) & 0xf6) === 0xf0,
  m4a: isoBmff,
  wav: riff("WAVE"),
  ogg: (h) => ascii(h, 0, "OggS"),
  oga: (h) => ascii(h, 0, "OggS"),
  opus: (h) => ascii(h, 0, "OggS"),
  flac: (h) => ascii(h, 0, "fLaC"),
  mp4: isoBmff,
  m4v: isoBmff,
  mov: isoBmff,
  "3gp": isoBmff,
  webm: matroska,
  mkv: matroska,
  avi: riff("AVI "),
};

export type MediaLimits = { maxFileMb: number; maxTotalMb: number };
export type MediaManifest = {
  files: number;
  bytes: number;
  /** Over the per-file limit, or past the total limit. */
  skippedLarge: number;
  /** Not media (wrong extension or signature), symbolic links and caches. */
  skippedOther: number;
  maxFileMb: number;
  maxTotalMb: number;
};

/** True when the extension is a media type and the first bytes carry that type's signature. */
export async function isMediaFile(file: string): Promise<boolean> {
  const signature = MEDIA_SIGNATURES[path.extname(file).slice(1).toLowerCase()];
  if (!signature) {
    return false;
  }
  const handle = await fs.open(file, "r").catch(() => undefined);
  if (!handle) {
    return false;
  }
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return bytesRead >= 4 && signature(head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** Regular files under the media root in path order; links and caches are counted, never followed. */
async function listCandidates(root: string, skipped: { other: number }): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && !SKIPPED_MEDIA_DIRS.has(entry.name)) {
        await walk(full);
      } else if (entry.isFile()) {
        found.push(full);
      } else {
        skipped.other += 1;
      }
    }
  };
  await walk(root);
  return found;
}

/** Copy media from mediaDir into outputDir within the limits. */
export async function copyBackupMedia(
  mediaDir: string,
  outputDir: string,
  limits: MediaLimits,
): Promise<MediaManifest> {
  const maxFile = limits.maxFileMb * MB;
  const maxTotal = limits.maxTotalMb * MB;
  const skipped = { other: 0 };
  const manifest: MediaManifest = { files: 0, bytes: 0, skippedLarge: 0, skippedOther: 0, ...limits };
  for (const file of await listCandidates(mediaDir, skipped)) {
    if (!(await isMediaFile(file))) {
      skipped.other += 1;
      continue;
    }
    const size = (await fs.lstat(file)).size;
    if (size > maxFile || manifest.bytes + size > maxTotal) {
      manifest.skippedLarge += 1;
      continue;
    }
    const target = path.join(outputDir, path.relative(mediaDir, file));
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.copyFile(file, target);
    manifest.files += 1;
    manifest.bytes += size;
  }
  manifest.skippedOther = skipped.other;
  return manifest;
}

/** The line a backup records when large media was left out. */
export function describeSkippedMedia(media: MediaManifest): string | undefined {
  if (media.skippedLarge === 0) {
    return undefined;
  }
  const noun = media.skippedLarge === 1 ? "large file" : "large files";
  return `${media.skippedLarge} ${noun} skipped (media over ${media.maxFileMb} MB each or past ${media.maxTotalMb} MB in all)`;
}
