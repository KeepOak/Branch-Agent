import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";
import { launcherIconGroups, withWindowsIcon } from "./windows-launcher-icon.mjs";

// Needs the desktop's dev dependencies (resedit), so it runs only in desktop-checks, never in a job without them.
test("the launcher icon stamp gives an icon-less exe the app's icon group, every image unchanged, once", () => {
  const icon = readFileSync(join(import.meta.dirname, "..", "assets", "branch.ico"));
  const ico = Data.IconFile.from(icon);
  // Every image in branch.ico is PNG-compressed: why the .NET Framework csc cannot take it with /win32icon.
  assert.ok(ico.icons.length > 0 && ico.icons.every(item => !item.data.isIcon()), "branch.ico holds only PNG images");
  const stamped = withWindowsIcon(Buffer.from(NtExecutable.createEmpty(false, false).generate()), icon);
  const entries = NtExecutableResource.from(NtExecutable.from(stamped)).entries;
  const groups = Resource.IconGroupEntry.fromEntries(entries);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].icons.map(item => [item.width, item.height]), ico.icons.map(item => [item.width, item.height]));
  assert.deepEqual(entries.filter(entry => entry.type === 3).map(entry => Buffer.from(entry.bin)), ico.icons.map(item => Buffer.from(item.data.bin)));
  assert.equal(launcherIconGroups(withWindowsIcon(stamped, icon)), 1, "stamping again replaces the group");
});

test("only the release build loads the icon stamp, and only lazily", () => {
  const build = readFileSync(join(import.meta.dirname, "release-build.mjs"), "utf8");
  assert.doesNotMatch(build, /^import .*windows-launcher-icon/m);
  assert.match(build, /await import\("\.\/windows-launcher-icon\.mjs"\)/);
  for (const file of ["release-installers.mjs", "windows-launcher.mjs", "release-installers.test.mjs"]) {
    assert.doesNotMatch(readFileSync(join(import.meta.dirname, file), "utf8"), /^import .*(resedit|windows-launcher-icon)/m, file);
  }
});

const desktopRoot = join(import.meta.dirname, "..");
const source = (file) => readFileSync(join(desktopRoot, file), "utf8");

test("no shortcut writer Starts in the app folder or the exe folder", () => {
  const writers = {
    "scripts/release-installers.mjs": source("scripts/release-installers.mjs"),
    "scripts/shortcuts.ps1": source("scripts/shortcuts.ps1"),
    "src/desktop-update.ts": source("src/desktop-update.ts"),
    "src/desktop-update-helper.ts": source("src/desktop-update-helper.ts"),
    "scripts/windows-launcher.mjs": source("scripts/windows-launcher.mjs"),
  };
  const together = Object.values(writers).join("\n");
  assert.doesNotMatch(together, /WorkingDir:\s*"\{app\}"/);
  assert.doesNotMatch(together, /WorkingDirectory\s*=\s*Split-Path\s+-Parent\s+\$executable/);
  assert.doesNotMatch(together, /WorkingDirectory\s*=\s*\[IO\.Path\]::GetDirectoryName\(\$exe\)/);
  assert.doesNotMatch(together, /WorkingDirectory\s*=\s*Path\.GetDirectoryName\(exe\)/);
  assert.doesNotMatch(writers["scripts/windows-launcher.mjs"], /cwd:\s*dirname\(exe\)/);
  assert.match(writers["scripts/release-installers.mjs"], /WorkingDir:\s*"\{%USERPROFILE\}"/);
  assert.match(writers["scripts/shortcuts.ps1"], /WorkingDirectory\s*=\s*\$env:USERPROFILE/);
  assert.match(writers["src/desktop-update.ts"], /WorkingDirectory=\$env:USERPROFILE/);
  assert.match(writers["src/desktop-update-helper.ts"], /WorkingDirectory=\$env:USERPROFILE/);
  assert.match(writers["scripts/windows-launcher.mjs"], /GetEnvironmentVariable\("USERPROFILE"\)/);
  assert.match(writers["scripts/windows-launcher.mjs"], /cwd:\s*windowsUserWorkingDirectory\(env\)/);
});

test("startup leaves the app folder before it spawns anything", () => {
  const main = source("src/main.ts");
  const folder = source("src/app-working-folder.ts");
  assert.match(main, /import \{ leaveAppWorkingFolder, userHome \} from "\.\/app-working-folder"/);
  const call = main.indexOf("leaveAppWorkingFolder({");
  const spawnGateway = main.indexOf("startGateway(");
  const handOff = main.indexOf("async function start()");
  assert.ok(call !== -1 && handOff !== -1 && spawnGateway !== -1);
  assert.ok(call < handOff, "the working folder changes at module load, before start()");
  assert.ok(call < spawnGateway, "before the gateway is spawned");
  assert.match(main, /home:\s*userHome\(app, homedir\)/);
  assert.match(folder, /export function leaveAppWorkingFolder/);
  assert.match(folder, /export function userHome/);
  const nodeCopy = main.indexOf("cfg.nodePath = nodeOutsideSwappedFolder(cfg.nodePath, cfg.dataDir)");
  const install = main.indexOf("const install: DesktopInstall");
  assert.ok(nodeCopy !== -1 && install !== -1 && nodeCopy < install);
});

test("shortcut writers also cover Startup, and never Start in the data folder", () => {
  const shortcuts = source("scripts/shortcuts.ps1");
  const update = source("src/desktop-update.ts");
  const helper = source("src/desktop-update-helper.ts");
  assert.match(shortcuts, /GetFolderPath\('Startup'\)/);
  assert.match(update, /GetFolderPath\('Startup'\)/);
  assert.match(helper, /GetFolderPath\('Startup'\)/);
  assert.match(update, /working-dir=userprofile/);
  assert.match(update, /repairWorkingDirectory/);
  assert.doesNotMatch(shortcuts, /WorkingDirectory = \$dataDirectory/);
  assert.doesNotMatch(update + helper, /WorkingDirectory=\$dataDirectory/);
});
