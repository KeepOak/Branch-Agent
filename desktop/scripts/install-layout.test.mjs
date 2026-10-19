// One Windows install: the setup .exe, install.ps1, the dev packagers and the updater agree on where Branch lives,
// and an old dev copy under the data folder's dist\ is moved aside instead of running beside the installed app.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { innoMigrationCode, innoSetupScript, WINDOWS_APP_ID, WINDOWS_DATA_DIR, WINDOWS_DEV_COPY } from "./release-installers.mjs";

const here = import.meta.dirname;
const read = (...parts) => readFileSync(join(here, ...parts), "utf8");
const script = innoSetupScript({ version: "0.4.4-build-56aed4e6d99d", source: "C:\\stage\\payload", out: "C:\\out" });
const lines = script.split("\r\n");
const section = (name) => {
  const start = lines.indexOf(`[${name}]`);
  assert.notEqual(start, -1, `the script has a [${name}] section`);
  const end = lines.findIndex((line, i) => i > start && /^\[[A-Za-z]+\]$/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end);
};

test("the installer installs to the per-user Programs root under a pinned AppId", () => {
  assert.ok(lines.includes("DefaultDirName={localappdata}\\Programs\\Branch Agent"));
  assert.equal(WINDOWS_APP_ID, "{{6F0B6A43-3C1E-4D8B-9A57-2E4B1C9D7F10}", "changing the AppId makes every update a second install");
  assert.ok(lines.includes(`AppId=${WINDOWS_APP_ID}`));
});

test("install.ps1 looks for the app where the installer puts it", () => {
  const ps1 = read("..", "install", "install.ps1");
  assert.match(ps1, /Join-Path \$env:LOCALAPPDATA 'Programs\\Branch Agent'/);
  assert.match(ps1, /Join-Path \$root 'current\.txt'/);
});

test("Setup closes a running Branch, then moves the old dev copy aside after installing", () => {
  const code = section("Code");
  assert.deepEqual(code.filter(Boolean), innoMigrationCode().slice(1).filter(Boolean), "[Code] is the migration and nothing else");
  const text = code.join("\n");
  assert.match(text, /function InitializeSetup\(\): Boolean;[\s\S]*CloseRunningBranch\(\);[\s\S]*Result := True;/);
  assert.match(text, /taskkill\.exe'\), '\/IM "Branch Agent\.exe" \/T'/, "asks the real app process to close first");
  assert.match(text, /taskkill\.exe'\), '\/F \/IM "Branch Agent\.exe" \/T'/, "then forces it");
  assert.match(text, /if CurStep = ssPostInstall then MigrateDevCopy\(\);/);
  assert.equal(WINDOWS_DATA_DIR, "{localappdata}\\BranchAgent");
  assert.equal(WINDOWS_DEV_COPY, "{localappdata}\\BranchAgent\\dist");
  assert.match(text, /Dist := ExpandConstant\('\{localappdata\}\\BranchAgent\\dist'\);/, "only the app folder moves");
  assert.match(text, /Moved := Dist \+ '\.migrated-' \+ GetDateTimeString/);
  assert.match(text, /RenameFile\(Dist, Moved\)/, "a rename, so it can be undone");
  assert.doesNotMatch(text, /DelTree|DeleteFile|RemoveDir/, "nothing is deleted");
  assert.doesNotMatch(text, /RenameFile\([^)]*BranchAgent'\)/, "the data folder itself never moves");
});

test("engine-current.txt is rewritten before the rename and restored if it fails", () => {
  const text = section("Code").join("\n");
  const rewrite = text.indexOf("NewLines[0] := Updated;");
  const rename = text.indexOf("RenameFile(Dist, Moved)");
  const restore = text.indexOf("NewLines[0] := Original;");
  assert.ok(text.includes("\\engine-current.txt"));
  assert.ok(rewrite !== -1 && rename !== -1 && restore !== -1);
  assert.ok(rewrite < rename && rename < restore, "rewrite, then rename, then restore on failure");
  assert.match(text, /StartsWithText\(Original, Dist \+ '\\'\)/, "only a pointer inside dist\\ changes");
  assert.match(text, /could not be rewritten; leaving it in place'\);\s*Exit;/, "a pointer that can't be fixed stops the move");
});

test("old Branch Agent shortcuts are removed and recreated for the installed copy", () => {
  const remove = section("InstallDelete");
  for (const dir of ["autoprograms", "autodesktop", "userprograms", "userdesktop"]) {
    assert.ok(remove.includes(`Type: files; Name: "{${dir}}\\Branch Agent.lnk"`), dir);
  }
  assert.ok(section("Icons").some((line) => line.startsWith('Name: "{autoprograms}\\Branch Agent"; Filename: "{app}\\')));
});

test("the dev packagers never write into the data folder's dist", () => {
  const ps1 = read("package.ps1");
  assert.match(ps1, /if \(!\$OutputRoot\) \{ \$OutputRoot = Join-Path \(\[IO\.Path\]::GetTempPath\(\)\) 'branch-desktop-dist' \}/);
  assert.doesNotMatch(ps1, /\$OutputRoot = Join-Path \$dataRoot/);
  assert.match(ps1, /Refusing to package into the app data folder/);
  const sh = read("package.sh");
  assert.match(sh, /^OUT="\$\{BRANCH_DESKTOP_OUT:-\$\{TMPDIR:-\/tmp\}\/branch-desktop-dist\}"$/m);
  assert.doesNotMatch(sh, /^OUT=.*defaultDataDirectory/m);
  assert.match(sh, /Refusing to package into the app data folder/);
});

test("a dev copy under the data folder hands off to the installed copy", () => {
  const update = read("..", "src", "desktop-update.ts");
  assert.match(update, /export function windowsInstalledHandoff\(/);
  assert.match(update, /relative\(join\(dataDir, "dist"\), install\.appDir\)/);
  assert.match(update, /join\(env\.LOCALAPPDATA, "Programs", "Branch Agent"\)/);
  assert.match(update, /exists\(join\(root, WINDOWS_POINTER\)\)/, "only when the installed copy's current.txt exists");
  const main = read("..", "src", "main.ts");
  const handoff = main.indexOf("windowsInstalledHandoff(install, cfg.dataDir)");
  assert.ok(handoff !== -1 && handoff < main.indexOf("app.requestSingleInstanceLock()"), "hands off before taking the single-instance lock");
  assert.match(main, /spawn\(installedLauncher, [\s\S]{0,120}\.unref\(\);\s*app\.exit\(0\);/);
});
