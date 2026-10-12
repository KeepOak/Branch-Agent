import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { decode } from "./build-brand-icons.mjs";

const root = resolve(import.meta.dirname, "..");
const text = file => readFileSync(join(root, file), "utf8");
const bytes = file => readFileSync(join(root, file));

function assertClearEdges(png, label) {
  const image = decode(png);
  const alpha = (x, y) => image.pixels[(y * image.size + x) * 4 + 3];
  for (let i = 0; i < image.size; i++) {
    assert.equal(alpha(i, 0), 0, `${label} top edge`);
    assert.equal(alpha(i, image.size - 1), 0, `${label} bottom edge`);
    assert.equal(alpha(0, i), 0, `${label} left edge`);
    assert.equal(alpha(image.size - 1, i), 0, `${label} right edge`);
  }
}

function assertTemplate(png, label) {
  const image = decode(png);
  assertClearEdges(png, label);
  let ink = false;
  for (let at = 0; at < image.pixels.length; at += 4) {
    assert.equal(image.pixels[at], 0, `${label} red`);
    assert.equal(image.pixels[at + 1], 0, `${label} green`);
    assert.equal(image.pixels[at + 2], 0, `${label} blue`);
    if (image.pixels[at + 3] === 255) ink = true;
  }
  assert.equal(ink, true, `${label} has no leaf`);
}

function icnsEntries(icon) {
  assert.equal(icon.toString("ascii", 0, 4), "icns");
  assert.equal(icon.readUInt32BE(4), icon.length);
  const entries = [];
  let offset = 8;
  for (; offset + 8 <= icon.length;) {
    const type = icon.toString("ascii", offset, offset + 4);
    const size = icon.readUInt32BE(offset + 4);
    assert.ok(size >= 8, type);
    entries.push({ type, png: icon.subarray(offset + 8, offset + size) });
    offset += size;
  }
  assert.equal(offset, icon.length);
  return entries;
}

test("packaged Keeper icon contains all seven Windows sizes and the approved 256 tile", () => {
  const icon = bytes("assets/branch.ico");
  assert.equal(icon.readUInt16LE(2), 1);
  assert.equal(icon.readUInt16LE(4), 7);
  const entries = Array.from({ length: 7 }, (_, i) => {
    const at = 6 + i * 16;
    const size = icon[at] || 256;
    return { size, png: icon.subarray(icon.readUInt32LE(at + 12), icon.readUInt32LE(at + 12) + icon.readUInt32LE(at + 8)) };
  });
  assert.deepEqual(entries.map(item => item.size), [16, 24, 32, 48, 64, 128, 256]);
  assert.deepEqual(entries.at(-1).png, bytes("assets/brand/linux/branch-256.png"));
  assert.deepEqual(entries[0].png, bytes("assets/brand/linux/branch-16.png"));
  const icns = icnsEntries(bytes("assets/branch.icns"));
  assert.deepEqual(icns.map(entry => entry.type), ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10", "ic11", "ic12", "ic13", "ic14"]);
  for (const entry of entries) assertClearEdges(entry.png, `ico ${entry.size}`);
  for (const entry of icns) assertClearEdges(entry.png, `icns ${entry.type}`);
});

test("desktop window, tray, shortcuts and packager use the approved icon; updater refreshes Windows cache", () => {
  const main = text("src/main.ts"), release = text("scripts/release-build.mjs"), shortcuts = text("scripts/shortcuts.ps1");
  assert.match(main, /process\.platform === "win32"/);
  assert.match(main, /join\(__dirname, "\.\.", "assets", "branch\.ico"\)/);
  assert.match(main, /join\(__dirname, "\.\.", "assets", "brand", "linux", "branch-48\.png"\)/);
  assert.match(main, /icon: ICON/);
  assert.match(main, /keepWindowResident\(app, w, TRAY_ICON/);
  for (const size of [16, 32]) {
    const png = bytes(`assets/brand/linux/branch-${size}.png`);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  assert.deepEqual(bytes("assets/brand/linux/branch-16@2x.png"), bytes("assets/brand/linux/branch-32.png"));
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) assertClearEdges(bytes(`assets/brand/linux/branch-${size}.png`), `branch-${size}.png`);
  for (const name of ["branchTemplate.png", "branchTemplate@2x.png", "branch-32Template.png", "branch-32Template@2x.png"]) {
    assertTemplate(bytes(`assets/brand/linux/${name}`), name);
  }
  assert.match(main, /process\.platform === "darwin"/);
  assert.match(main, /branchTemplate\.png/);
  assert.match(text("scripts/build-brand-icons.mjs"), /branch-16@2x\.png/);
  assert.match(text("scripts/build-brand-icons.mjs"), /branchTemplate@2x\.png/);
  assert.match(text("scripts/build-brand-icons.mjs"), /branch-32Template@2x\.png/);
  assert.match(text("src/resident-window.ts"), /setTemplateImage\(true\)/);
  assert.match(shortcuts, /IconLocation = "\$executable,0"/);
  assert.match(release, /assets\/branch\.ico/);
  assert.match(release, /assets\/branch\.icns/);
  assert.match(release, /assets\/brand\/linux\/branch-512\.png/);
  const desktopSources = readdirSync(join(root, "src"), { recursive: true }).filter(file => file.endsWith(".ts"))
    .map(file => text(`src/${file}`)).join("\n");
  assert.doesNotMatch(desktopSources + release, /assets[/\\](?:mascot|branch-mark)|branch-wave\.webp/);
  const helper = text("src/desktop-update-helper.ts");
  assert.match(helper, /ie4uinit\.exe/);
  assert.match(helper, /windowsHide: true/);
  assert.match(helper, /IconLocation=/);
});
