// Branch: the media part of a Git backup copies real pictures, sound, video and PDFs only, within the
// per-file and total limits, and reports what it left out.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyBackupMedia, describeSkippedMedia, isMediaFile } from "./git-backup-media.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PDF = Buffer.from("%PDF-1.7\n%âã\n1 0 obj\n<<>>\nendobj\n", "latin1");
const MB = 1024 * 1024;

let root: string;
let media: string;
let out: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "git-backup-media-"));
  media = path.join(root, "media");
  out = path.join(root, "out");
  await fs.mkdir(path.join(media, "outgoing", "records"), { recursive: true });
  await fs.mkdir(path.join(media, "playback-transcode"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function listOut(): Promise<string[]> {
  const files = await fs.readdir(out, { recursive: true, withFileTypes: true }).catch(() => []);
  return files
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(out, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .toSorted();
}

describe("Git backup media", () => {
  it("includes real images, PDFs and photos and leaves out secrets, records, caches and disguised files", async () => {
    await fs.writeFile(path.join(media, "outgoing", "chart.png"), PNG);
    await fs.writeFile(path.join(media, "inbound-photo.jpg"), JPEG);
    await fs.writeFile(path.join(media, "report.pdf"), PDF);
    await fs.writeFile(path.join(media, "token.json"), '{"token":"SENTINEL-MEDIA-TOKEN"}');
    await fs.writeFile(path.join(media, "key.pem"), "-----BEGIN PRIVATE KEY-----\nSENTINEL\n");
    await fs.writeFile(path.join(media, "notes.txt"), "api_key=SENTINEL");
    await fs.writeFile(path.join(media, "disguised.png"), "OPENAI_API_KEY=SENTINEL-DISGUISED");
    await fs.writeFile(path.join(media, "outgoing", "records", "r1.json"), '{"id":"r1"}');
    await fs.writeFile(path.join(media, "playback-transcode", "cache.mp4"), PNG);

    const manifest = await copyBackupMedia(media, out, { maxFileMb: 50, maxTotalMb: 1024 });

    expect(await listOut()).toEqual(["inbound-photo.jpg", "outgoing/chart.png", "report.pdf"]);
    expect(await fs.readFile(path.join(out, "outgoing", "chart.png"))).toEqual(PNG);
    // Five non-media files plus the playback cache folder.
    expect(manifest).toMatchObject({ files: 3, skippedLarge: 0, skippedOther: 6 });
    expect(describeSkippedMedia(manifest)).toBeUndefined();
  });

  it("skips a file over the per-file limit and media past the total, and says how many", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * MB)]);
    await fs.writeFile(path.join(media, "a-small.png"), PNG);
    await fs.writeFile(path.join(media, "b-huge.png"), big);
    const perFile = await copyBackupMedia(media, out, { maxFileMb: 1, maxTotalMb: 1024 });
    expect(await listOut()).toEqual(["a-small.png"]);
    expect(perFile).toMatchObject({ files: 1, skippedLarge: 1 });
    expect(describeSkippedMedia(perFile)).toBe(
      "1 large file skipped (media over 1 MB each or past 1024 MB in all)",
    );

    await fs.rm(out, { recursive: true, force: true });
    await fs.writeFile(path.join(media, "c-medium.png"), Buffer.concat([PNG, Buffer.alloc(MB)]));
    const total = await copyBackupMedia(media, out, { maxFileMb: 50, maxTotalMb: 2 });
    // Path order: a-small fits, b-huge would pass 2 MB in all, c-medium still fits after it.
    expect(await listOut()).toEqual(["a-small.png", "c-medium.png"]);
    expect(describeSkippedMedia(total)).toBe(
      "1 large file skipped (media over 50 MB each or past 2 MB in all)",
    );
  });

  it("never follows a symbolic link out of the media folder", async () => {
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "elsewhere.png"), PNG);
    try {
      await fs.symlink(outside, path.join(media, "linked"), process.platform === "win32" ? "junction" : "dir");
    } catch {
      return; // A host that cannot create links has nothing to follow.
    }
    const manifest = await copyBackupMedia(media, out, { maxFileMb: 50, maxTotalMb: 1024 });
    expect(await listOut()).toEqual([]);
    // The link and the (empty) playback cache folder.
    expect(manifest.skippedOther).toBe(2);
  });

  it("needs both a media extension and its file signature", async () => {
    await fs.writeFile(path.join(media, "real.png"), PNG);
    await fs.writeFile(path.join(media, "png-bytes.json"), PNG);
    await fs.writeFile(path.join(media, "jpeg-named.png"), JPEG);
    expect(await isMediaFile(path.join(media, "real.png"))).toBe(true);
    expect(await isMediaFile(path.join(media, "png-bytes.json"))).toBe(false);
    expect(await isMediaFile(path.join(media, "jpeg-named.png"))).toBe(false);
  });
});
