// Packages an unsigned macOS app, installs it into a temporary Applications folder, and checks the bundle.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const desktopRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(join(desktopRoot, "package.json"));

if (process.platform !== "darwin") {
  console.error("check-mac-bundle.mjs runs on macOS");
  process.exit(1);
}

function plistString(plist, key) {
  const value = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
  if (value === undefined) throw new Error(`Info.plist is missing ${key}`);
  return value;
}

function icnsTypes(bytes) {
  assert.equal(bytes.toString("ascii", 0, 4), "icns");
  assert.equal(bytes.readUInt32BE(4), bytes.length);
  const types = [];
  for (let offset = 8; offset + 8 <= bytes.length;) {
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32BE(offset + 4);
    assert.ok(size >= 8, `icns chunk ${type} is too small`);
    types.push(type);
    offset += size;
  }
  return types;
}

function capture(command, args) {
  return execFileSync(command, args, { encoding: "utf8", windowsHide: true }).trim();
}

const temp = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "branch-mac-bundle-"));
try {
  const { darwinPackagerOptions, stampMacBundle, installMacApp, MAC_ARCHIVE_BUNDLE_FOLDER, MAC_BUNDLE_FOLDER, MAC_BUNDLE_ID, MAC_EXECUTABLE_NAME } = await import(pathToFileURL(join(desktopRoot, "dist/mac-applications.js")));
  const packageJson = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
  const appDirectory = join(temp, "app");
  await mkdir(appDirectory);
  await writeFile(join(appDirectory, "package.json"), JSON.stringify({ name: "branch", version: packageJson.version, main: "main.js" }));
  await writeFile(join(appDirectory, "main.js"), "\n");
  const { packager } = require("@electron/packager");
  const icon = join(desktopRoot, "assets/branch.icns");
  const folders = await packager({
    dir: appDirectory,
    platform: "darwin",
    arch: process.arch,
    electronVersion: packageJson.devDependencies.electron,
    asar: true,
    out: join(temp, "packaged"),
    prune: false,
    overwrite: true,
    ...darwinPackagerOptions(icon),
  });
  assert.equal(folders.length, 1);
  const packaged = join(folders[0], MAC_ARCHIVE_BUNDLE_FOLDER);
  await stampMacBundle(packaged);
  const applications = join(temp, "Applications");
  const installed = await installMacApp(packaged, { applicationsDirectory: applications });
  await installMacApp(packaged, { applicationsDirectory: applications });
  const names = await readdir(applications);
  assert.deepEqual(names.filter(name => name.endsWith(".app")), [MAC_BUNDLE_FOLDER]);
  const plistPath = join(installed, "Contents/Info.plist");
  const plist = await readFile(plistPath, "utf8");
  execFileSync("plutil", ["-lint", plistPath], { stdio: "ignore", windowsHide: true });
  for (const key of ["CFBundleName", "CFBundleDisplayName"]) {
    assert.equal(plistString(plist, key), "Branch");
    assert.equal(capture("plutil", ["-extract", key, "raw", "-o", "-", plistPath]).replaceAll('"', ""), "Branch");
  }
  assert.equal(plistString(plist, "CFBundlePackageType"), "APPL");
  assert.equal(capture("plutil", ["-extract", "CFBundlePackageType", "raw", "-o", "-", plistPath]).replaceAll('"', ""), "APPL");
  assert.equal(plistString(plist, "CFBundleIdentifier"), MAC_BUNDLE_ID);
  assert.equal(plistString(plist, "CFBundleExecutable"), MAC_EXECUTABLE_NAME);
  const executable = join(installed, "Contents/MacOS", MAC_EXECUTABLE_NAME);
  assert.equal((await readFile(executable)).length > 0, true);
  const iconName = plistString(plist, "CFBundleIconFile");
  const iconFile = join(installed, "Contents/Resources", iconName.endsWith(".icns") ? iconName : `${iconName}.icns`);
  const shipped = await readFile(iconFile);
  const sourceIcon = await readFile(icon);
  assert.deepEqual(shipped, sourceIcon);
  const types = icnsTypes(shipped);
  assert.deepEqual(types, icnsTypes(sourceIcon));
  assert.ok(types.includes("icp4") && types.includes("ic10"), "bundled icon is missing a required size");
  execFileSync("mdls", [installed], { stdio: "ignore", windowsHide: true });
  console.log("macOS bundle check passed");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
