import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const text = file => readFileSync(join(root, file), "utf8");
const bytes = file => readFileSync(join(root, file));

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
  assert.deepEqual(entries[0].png, bytes("assets/brand/keepoak-app-icon-16.png"));
  const icns = bytes("assets/branch.icns");
  assert.equal(icns.toString("ascii", 0, 4), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  assert.deepEqual([...icns.toString("ascii").matchAll(/icp4|icp5|icp6|ic07|ic08|ic09|ic10/g)].map(match => match[0]), ["icp4", "icp5", "icp6", "ic07", "ic08", "ic09", "ic10"]);
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
  assert.match(main, /process\.platform !== "darwin"/);
  assert.match(main, /branch-16\.png/);
  assert.match(main, /scaleFactor: 2, buffer: readFileSync\([^)]+branch-32\.png/);
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
