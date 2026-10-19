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

const procedure = (text, name) => {
  const start = text.search(new RegExp(`^(procedure|function) ${name}\\(`, "m"));
  assert.notEqual(start, -1, `[Code] defines ${name}`);
  return text.slice(start, text.indexOf("\nend;", start) + 5);
};
// CompareText(Copy(Value, 1, Length(Prefix)), Prefix) = 0, the way StartsWithText reads a process's image path.
const startsWithText = (value, prefix) => value.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase();
const localAppData = "C:\\LocalAppData";
const expand = (value) => value.replace("{localappdata}", localAppData);

test("Setup closes only processes running from the old dev copy, by image path and process id", () => {
  const text = section("Code").join("\n");
  const stop = procedure(text, "StopDevCopyProcesses");
  assert.match(stop, /Dist := ExpandConstant\('\{localappdata\}\\BranchAgent\\dist'\);/);
  assert.match(stop, /ExecQuery\('SELECT ProcessId, ExecutablePath FROM Win32_Process'\)/, "reads every process's full image path");
  assert.match(stop, /if not VarIsNull\(Proc\.ExecutablePath\) then/, "skips processes whose path Windows hides");
  assert.match(stop, /if StartsWithText\(ExePath, Dist \+ '\\'\) then/, "only images under dist\\ match");
  assert.match(stop, /Args := '\/PID ' \+ IntToStr\(Pid\);/, "stops by process id");
  assert.match(stop, /if Force then Args := '\/F ' \+ Args;/);
  assert.match(text, /function StartsWithText[\s\S]*?CompareText\(Copy\(Value, 1, Length\(Prefix\)\), Prefix\) = 0;/, "case-insensitive, like Windows paths");
  assert.doesNotMatch(text, /\/IM\b/, "never by image name, which would close the installed copy too");
  assert.doesNotMatch(text, /\/T\b/, "no tree kill, which follows parent ids rather than paths");
  assert.match(procedure(text, "CloseDevCopy"), /if StopDevCopyProcesses\(False\) > 0 then\s*begin\s*Sleep\(3000\);\s*StopDevCopyProcesses\(True\);/, "asks first, then forces what is still running");
});

test("the dev-copy path filter keeps the installed copy and anything that only looks like dist", () => {
  const dist = expand(WINDOWS_DEV_COPY) + "\\";
  const installedRoot = lines.find((line) => line.startsWith("DefaultDirName=")).slice("DefaultDirName=".length);
  assert.ok(startsWithText(`${dist}v0.4.3\\Branch Agent-win32-x64\\Branch Agent.exe`, dist), "the old dev copy closes");
  assert.ok(startsWithText(`${dist.toUpperCase()}V0.4.3\\BRANCH AGENT.EXE`, dist), "whatever the case of the path");
  assert.ok(startsWithText(`${dist}v0.4.3\\resources\\node.exe`, dist), "and so do helpers that run from it");
  for (const kept of [
    `${expand(installedRoot)}\\app-0.4.4\\Branch Agent.exe`,
    `${expand(installedRoot)}\\Branch Agent Launcher.exe`,
    `${expand(WINDOWS_DATA_DIR)}\\dist.migrated-20261019-101500\\v0.4.3\\Branch Agent.exe`,
    `${expand(WINDOWS_DATA_DIR)}\\distant\\Branch Agent.exe`,
    "D:\\Branch Agent\\Branch Agent.exe",
  ]) assert.equal(startsWithText(kept, dist), false, kept);
});

test("cancelling Setup closes nothing: the close runs only once the install is confirmed", () => {
  const text = section("Code").join("\n");
  for (const early of ["InitializeSetup", "InitializeWizard", "CurPageChanged", "NextButtonClick", "ShouldSkipPage"]) {
    assert.doesNotMatch(text, new RegExp(`\\b${early}\\b`), `${early} runs before the user confirms`);
  }
  const prepare = procedure(text, "PrepareToInstall");
  assert.match(prepare, /^function PrepareToInstall\(var NeedsRestart: Boolean\): String;/);
  assert.match(prepare, /CloseDevCopy\(\);\s*Result := '';/, "and never blocks the install");
  assert.equal(text.match(/CloseDevCopy\(\);/g).length, 2, "defined once and called only from PrepareToInstall");
  assert.equal(text.match(/StopDevCopyProcesses\(/g).length, 3, "defined once and called only from CloseDevCopy");
});

test("Setup moves the old dev copy aside after installing", () => {
  const text = section("Code").join("\n");
  assert.deepEqual(section("Code").filter(Boolean), innoMigrationCode().slice(1).filter(Boolean), "[Code] is the migration and nothing else");
  assert.match(text, /if CurStep = ssPostInstall then MigrateDevCopy\(\);/);
  assert.equal(WINDOWS_DATA_DIR, "{localappdata}\\BranchAgent");
  assert.equal(WINDOWS_DEV_COPY, "{localappdata}\\BranchAgent\\dist");
  assert.match(procedure(text, "MigrateDevCopy"), /Dist := ExpandConstant\('\{localappdata\}\\BranchAgent\\dist'\);/, "only the app folder moves");
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
  assert.match(main, /spawn\(installedLauncher, process\.argv\.slice\(1\), \{[^}]*\bwindowsHide: true\b[^}]*\}\)\.unref\(\);\s*app\.exit\(0\);/,
    "the handoff launch starts hidden, like every Windows child process");
  const lock = main.indexOf("app.requestSingleInstanceLock()");
  assert.equal(main.indexOf("app.requestSingleInstanceLock()", lock + 1), -1, "one single-instance lock");
  assert.match(main, /^if \(installedLauncher\) \{\n(?:\s*\/\/[^\n]*\n)*\s*log\([^\n]*\);\n\} else if \(!app\.requestSingleInstanceLock\(\)\) \{/m,
    "a copy that hands off never takes the lock, so the installed copy it just started does not see it and quit");
  const startup = main.slice(lock);
  for (const handler of ["app.whenReady().then(start)", 'app.on("second-instance"', 'app.on("will-quit"']) {
    assert.ok(startup.includes(handler), `${handler} runs only in the branch that took the lock`);
    assert.equal(main.indexOf(handler), lock + startup.indexOf(handler), `${handler} is registered nowhere before the lock`);
  }
});
