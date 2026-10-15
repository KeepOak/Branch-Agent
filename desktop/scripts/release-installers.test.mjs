import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { APPIMAGE_DESKTOP_ENTRY, APPIMAGE_TOOLS, appImageToolArgs, appImageToolEnv, assembleAppDir, dmgArgs, fetchPinned, innoCompiler, innoSetupScript,
  installerName, layoutWindowsInstallRoot, main, numericVersion, parseArgs, WINDOWS_APP_ID, windowsInstallerFolderName, windowsLauncherScript } from "./release-installers.mjs";
import * as launcher from "./windows-launcher.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("installer names carry the release version and target", () => {
  assert.equal(installerName("0.4.4-build-56aed4e6d99d", "win32-x64"), "Branch-Agent-Setup-0.4.4-build-56aed4e6d99d-win32-x64.exe");
  assert.equal(installerName("0.4.4-build-56aed4e6d99d", "darwin-arm64"), "Branch-Agent-0.4.4-build-56aed4e6d99d-darwin-arm64.dmg");
  assert.equal(installerName("0.4.4-build-56aed4e6d99d", "linux-x64"), "Branch-Agent-0.4.4-build-56aed4e6d99d-linux-x64.AppImage");
});

test("the Windows installer is per-user and leaves nothing the desktop updater swaps behind", () => {
  const version = "0.4.4-build-56aed4e6d99d";
  const folder = windowsInstallerFolderName(version);
  const script = innoSetupScript({ version, source: "C:\\stage\\payload", out: "C:\\out" });
  const lines = script.split("\r\n");
  const exe = "{app}\\Branch Agent Launcher.exe";
  assert.equal(folder, "app-0.4.4-build-56aed4e6d99d");
  assert.ok(lines.includes(`AppId=${WINDOWS_APP_ID}`));
  assert.ok(lines.includes("PrivilegesRequired=lowest"), "no admin prompt");
  assert.doesNotMatch(script, /requireAdministrator|PrivilegesRequired=admin|runas/i, "never needs a UAC prompt");
  assert.ok(lines.includes("MinVersion=10.0"), "Setup refuses Windows the bundled Electron can't run on");
  assert.ok(lines.includes("DefaultDirName={localappdata}\\Programs\\Branch Agent"), "a user-writable install root");
  assert.ok(lines.includes("UninstallFilesDir={localappdata}\\Programs\\Branch Agent Uninstall"), "the uninstaller survives leftover folders");
  const shortcut = `Filename: "${exe}"; WorkingDir: "{app}"; AppUserModelID: "dev.branch.agent.desktop"`;
  assert.ok(lines.includes(`Name: "{autoprograms}\\Branch Agent"; ${shortcut}`), "the Start-menu shortcut opens the stable launcher");
  assert.ok(lines.includes(`Name: "{autodesktop}\\Branch Agent"; ${shortcut}; Tasks: desktopicon`), "so does the desktop shortcut");
  assert.doesNotMatch(script, /\{app\}\\app-/, "no shortcut, icon or run entry names a version folder a prune can remove");
  assert.ok(lines.includes(`UninstallDisplayIcon=${exe}`));
  assert.ok(lines.includes('Type: filesandordirs; Name: "{app}"'));
  assert.ok(lines.includes('Type: filesandordirs; Name: "{app}.previous"'));
  assert.ok(lines.includes("AppVersion=0.4.4-build-56aed4e6d99d"));
  assert.ok(lines.includes("VersionInfoVersion=0.4.4.0"));
  assert.ok(lines.includes("OutputBaseFilename=Branch-Agent-Setup-0.4.4-build-56aed4e6d99d-win32-x64"));
  assert.ok(lines.some((line) => line.startsWith('Source: "C:\\stage\\payload\\*"')));
  assert.doesNotMatch(script, /SignTool|signtool/i, "nothing signs here");
  assert.match(windowsLauncherScript(), /set \/p VER=<"%ROOT%current\.txt"/);
});

test("the macOS image wraps the signed app with an Applications link", () => {
  assert.deepEqual(dmgArgs({ stage: "/tmp/p", out: "/tmp/o.dmg" }), ["create", "-volname", "Branch Agent", "-srcfolder", "/tmp/p", "-fs", "HFS+", "-format", "UDZO", "-ov", "/tmp/o.dmg"]);
});

test("arguments are checked before anything is extracted", async () => {
  assert.throws(() => parseArgs(["--assets", "a", "--version", "0.4.4", "--target", "win32-x64"]), /Missing --out/);
  assert.throws(() => parseArgs(["--assets", "a", "--version", "0.4.4", "--target", "win32-arm64", "--out", "o"]), /Unknown target/);
  assert.throws(() => numericVersion("latest"), /Not a release version/);
  await assert.rejects(main(["--assets", "a", "--version", "0.4.4", "--target", "linux-x64", "--out", "o"], () => assert.fail("nothing is downloaded")), /Missing desktop package/);
});

test("the AppImage tools are pinned by release, size and SHA-256", () => {
  for (const tool of Object.values(APPIMAGE_TOOLS)) {
    assert.match(tool.url, /^https:\/\/github\.com\/AppImage\/(appimagetool|type2-runtime)\/releases\/download\/[0-9.]+\/[^/]+$/, "a numbered release, never continuous");
    assert.equal(tool.url.split("/").at(-1), tool.name);
    assert.match(tool.sha256, /^[0-9a-f]{64}$/);
    assert(Number.isSafeInteger(tool.bytes) && tool.bytes > 0);
  }
  assert.equal(APPIMAGE_TOOLS.appimagetool.sha256, "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0");
  assert.equal(APPIMAGE_TOOLS.runtime.sha256, "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d");
});

test("a pinned tool is verified before it is written executable, and a mismatch never lands", async () => {
  const dir = mkdtempSync(join(tmpdir(), "branch-appimage-tool-"));
  try {
    const good = Buffer.from("pinned tool bytes");
    const tool = { name: "tool.AppImage", url: "https://github.com/AppImage/appimagetool/releases/download/1.0.0/tool.AppImage", sha256: sha256(good), bytes: good.length };
    const serve = bytes => async url => { assert.equal(url, tool.url); return new Response(bytes); };
    await assert.rejects(fetchPinned(tool, dir, serve(Buffer.from("tampered tool bytes"))), /tool\.AppImage SHA-256 mismatch.*refusing to run it/);
    assert.deepEqual(readdirSync(dir), []);
    await assert.rejects(fetchPinned(tool, dir, async () => new Response("gone", { status: 404 })), /HTTP 404/);
    const file = await fetchPinned(tool, dir, serve(good));
    assert.deepEqual(readFileSync(file), good);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o755);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the AppDir wraps the Linux package with an AppRun bound to its chrome-sandbox, a desktop entry and an icon", () => {
  const root = mkdtempSync(join(tmpdir(), "branch-appdir-"));
  try {
    const payload = join(root, "payload");
    mkdirSync(join(payload, "resources"), { recursive: true });
    writeFileSync(join(payload, "Branch Agent.bin"), "electron");
    writeFileSync(join(payload, "chrome-sandbox"), "sandbox helper");
    writeFileSync(join(payload, "resources", "app.asar"), "asar");
    const appDir = assembleAppDir(payload, join(root, "Branch-Agent.AppDir"));
    assert.equal(existsSync(payload), false);
    assert.equal(readFileSync(join(appDir, "resources", "app.asar"), "utf8"), "asar");
    const appRun = readFileSync(join(appDir, "AppRun"), "utf8");
    if (process.platform !== "win32") assert.equal(statSync(join(appDir, "AppRun")).mode & 0o777, 0o755);
    assert.doesNotMatch(appRun, /__BRANCH_SANDBOX_SHA256__/);
    assert.equal(appRun.split(sha256(Buffer.from("sandbox helper"))).length - 1, 2, "the copied helper's name and its check use this package's hash");
    assert.match(appRun, /CHROME_DEVEL_SANDBOX=/);
    assert.doesNotMatch(appRun, /--no-sandbox/);
    assert.equal(readFileSync(join(appDir, "branch-agent.desktop"), "utf8"), APPIMAGE_DESKTOP_ENTRY);
    assert.match(APPIMAGE_DESKTOP_ENTRY, /^Icon=branch-agent$/m);
    assert.ok(statSync(join(appDir, "branch-agent.png")).size > 0);
    const incomplete = join(root, "incomplete"); mkdirSync(incomplete);
    assert.throws(() => assembleAppDir(incomplete, join(root, "other.AppDir")), /no Branch Agent\.bin/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("appimagetool runs with the pinned runtime, no network and no FUSE", () => {
  assert.deepEqual(appImageToolArgs({ appDir: "/w/Branch-Agent.AppDir", runtime: "/w/runtime-x86_64", out: "/o/Branch-Agent-1.0.0-linux-x64.AppImage" }),
    ["--no-appstream", "--runtime-file", "/w/runtime-x86_64", "/w/Branch-Agent.AppDir", "/o/Branch-Agent-1.0.0-linux-x64.AppImage"]);
  const env = appImageToolEnv("1.0.0", { PATH: "/usr/bin" });
  assert.deepEqual(env, { PATH: "/usr/bin", ARCH: "x86_64", VERSION: "1.0.0", APPIMAGE_EXTRACT_AND_RUN: "1" });
});

test("the release workflow builds the Linux AppImage as a required step", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/component-release.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const at = workflow.indexOf("      - name: Build installers, signed only when configured\n");
  assert.ok(at !== -1);
  const step = workflow.slice(at, workflow.indexOf("\n      - ", at + 1));
  assert.doesNotMatch(step, /if: matrix\.target != 'linux-x64'/);
  assert.match(step, /continue-on-error: \$\{\{ matrix\.target != 'linux-x64' \}\}/);
  assert.match(step, /release-installers\.mjs --assets/);
});

test("the Inno Setup compiler is found or named", () => {
  const env = { "ProgramFiles(x86)": "C:\\PF86" };
  assert.equal(innoCompiler(env, (file) => file.startsWith("C:\\PF86")), join("C:\\PF86", "Inno Setup 6", "ISCC.exe"));
  assert.throws(() => innoCompiler({}, () => false), /INNO_SETUP_COMPILER/);
});

/** A fake Windows filesystem keyed by path, for the launcher's pure rules. */
const fakeFs = files => ({ readText: path => files[path], exists: path => path in files });

test("the stable launcher reads current.txt and starts that version folder's Branch Agent.exe", () => {
  const root = join("C:", "Users", "person", "AppData", "Local", "Programs", "Branch Agent");
  const exe = folder => join(root, folder, "Branch Agent.exe");
  const files = { [join(root, "current.txt")]: "\uFEFFapp-0.4.5-abcdef\r\n", [exe("app-0.4.4-123456")]: "", [exe("app-0.4.5-abcdef")]: "" };
  const started = [];
  const spawn = (command, args, options) => started.push({ command, args, cwd: options.cwd, detached: options.detached, windowsHide: options.windowsHide });
  assert.equal(launcher.runWindowsLauncher({ root, args: ["--from-shortcut", "a b"], fs: fakeFs(files), spawn }), exe("app-0.4.5-abcdef"));
  assert.deepEqual(started, [{ command: exe("app-0.4.5-abcdef"), args: ["--from-shortcut", "a b"], cwd: join(root, "app-0.4.5-abcdef"), detached: true, windowsHide: false }]);
  // The pointer moves after an update: the same launcher starts the new folder.
  files[join(root, "current.txt")] = "app-0.4.4-123456\n";
  assert.equal(launcher.windowsLaunchTarget(root, fakeFs(files)), exe("app-0.4.4-123456"));
  // A pointer at a folder that is gone, or at something that is not a version folder, never starts it.
  files[join(root, "current.txt")] = "app-0.4.3-gone00\n";
  assert.equal(launcher.windowsLaunchTarget(root, fakeFs(files)), undefined);
  files[join(root, "current.txt")] = "..\\..\\evil\n";
  files[join(root, "..", "..", "evil", "Branch Agent.exe")] = "";
  assert.equal(launcher.windowsLaunchTarget(root, fakeFs(files)), undefined);
  // A legacy install keeps its Branch Agent.exe at the root.
  files[join(root, "Branch Agent.exe")] = "";
  assert.equal(launcher.windowsLaunchTarget(root, fakeFs(files)), join(root, "Branch Agent.exe"));
  assert.equal(launcher.runWindowsLauncher({ root: join(root, "nowhere"), fs: fakeFs({}), spawn: () => assert.fail("nothing to start") }), undefined);
});

test("only shortcuts into a version folder or a legacy root copy are moved to the launcher", () => {
  const root = "C:\\Users\\person\\AppData\\Local\\Programs\\Branch Agent";
  assert.equal(launcher.windowsShortcutNeedsLauncher(root + "\\app-0.4.4-123456\\Branch Agent.exe", root), true);
  assert.equal(launcher.windowsShortcutNeedsLauncher(root.toUpperCase() + "\\APP-0.4.4\\branch agent.EXE", root + "\\"), true, "Windows paths are case-insensitive");
  assert.equal(launcher.windowsShortcutNeedsLauncher(root + "\\Branch Agent.exe", root), true, "a legacy root copy");
  assert.equal(launcher.windowsShortcutNeedsLauncher(root + "\\Branch Agent Launcher.exe", root), false, "already the launcher");
  assert.equal(launcher.windowsShortcutNeedsLauncher(root + "\\app-0.4.4\\resources\\Branch Agent.exe", root), false);
  assert.equal(launcher.windowsShortcutNeedsLauncher(root + " Other\\app-1\\Branch Agent.exe", root), false, "a sibling folder is not this install");
  assert.equal(launcher.windowsShortcutNeedsLauncher("C:\\Program Files\\Other\\Other.exe", root), false);
  assert.equal(launcher.windowsShortcutNeedsLauncher("", root), false);
});

test("the compiled launcher follows the same rules as a windowed exe", () => {
  const source = launcher.windowsLauncherSource();
  assert.match(source, /Path\.Combine\(root, "current\.txt"\)/);
  assert.match(source, /Regex\.IsMatch\(folder, "\^app-\[A-Za-z0-9\._-\]\+\$"\)/);
  assert.match(source, /"Branch Agent\.exe"/);
  assert.match(source, /UseShellExecute = false/);
  assert.deepEqual(launcher.windowsLauncherCompileArgs({ source: "l.cs", out: "o.exe", icon: "b.ico" }),
    ["/nologo", "/target:winexe", "/optimize+", "/platform:anycpu", "/out:o.exe", "/win32icon:b.ico", "l.cs"], "winexe: no console window");
  const csc = launcher.windowsLauncherCompiler({ SystemRoot: "C:\\Windows" }, file => file.includes("Framework64"));
  assert.equal(csc, "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe");
  assert.throws(() => launcher.windowsLauncherCompiler({}, () => false), /csc\.exe/);
});

test("the installer writes the one shared launcher: the exe from the package, the cmd stub and the pointer", () => {
  const work = mkdtempSync(join(tmpdir(), "branch-win-layout-"));
  try {
    const payload = join(work, "payload"), root = join(work, "root");
    mkdirSync(join(payload, "resources"), { recursive: true });
    writeFileSync(join(payload, "Branch Agent.exe"), "app");
    writeFileSync(join(payload, "resources", launcher.WINDOWS_LAUNCHER_RESOURCE), "launcher bytes");
    const signed = [];
    const folder = layoutWindowsInstallRoot({ payload, root, version: "0.4.5-build-1", signApp: file => signed.push(file) });
    assert.equal(folder, "app-0.4.5-build-1");
    assert.equal(readFileSync(join(root, folder, "Branch Agent.exe"), "utf8"), "app");
    assert.equal(readFileSync(join(root, "Branch Agent Launcher.exe"), "utf8"), "launcher bytes");
    assert.deepEqual(signed, [join(root, "Branch Agent Launcher.exe")]);
    assert.equal(readFileSync(join(root, "current.txt"), "utf8"), folder + "\n");
    assert.equal(readFileSync(join(root, "Branch Agent.cmd"), "utf8"), launcher.windowsLauncherScript());
    assert.equal(windowsLauncherScript, launcher.windowsLauncherScript, "the installer re-exports the shared source, not a copy");
    assert.equal(readFileSync(join(root, launcher.WINDOWS_LAUNCHER_REVISION_FILE), "utf8"), launcher.WINDOWS_LAUNCHER_REVISION + "\n");
    const bare = join(work, "bare");
    mkdirSync(bare);
    writeFileSync(join(bare, "Branch Agent.exe"), "app");
    assert.throws(() => layoutWindowsInstallRoot({ payload: bare, root: join(work, "root2"), version: "0.4.5" }), /branch-launcher\.exe/);
  } finally { rmSync(work, { recursive: true, force: true }); }
});

/** PE optional-header Subsystem: 2 is a windowed program (no console), 3 a console one. */
const peSubsystem = file => { const bytes = readFileSync(file); const pe = bytes.readUInt32LE(0x3c); return bytes.readUInt16LE(pe + 4 + 20 + 68); };

test("Windows: the built launcher has no console, starts the folder current.txt names and survives a prune", { skip: process.platform !== "win32" }, () => {
  const csc = launcher.windowsLauncherCompiler(process.env, existsSync);
  const work = mkdtempSync(join(tmpdir(), "branch-win-launcher-"));
  try {
    const root = join(work, "Branch Agent");
    mkdirSync(root);
    const build = (name, source, out) => {
      writeFileSync(join(work, name), source);
      const result = spawnSync(csc, launcher.windowsLauncherCompileArgs({ source: join(work, name), out }), { encoding: "utf8" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    build("launcher.cs", launcher.windowsLauncherSource(), join(root, launcher.WINDOWS_LAUNCHER_EXE));
    assert.equal(peSubsystem(join(root, launcher.WINDOWS_LAUNCHER_EXE)), 2, "a windowed exe: opening it shows no console");
    // A stand-in Branch Agent.exe that records where it ran from and what it was given.
    build("app.cs", "using System; using System.IO; static class App { static void Main(string[] a) { File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, \"ran.txt\"), Environment.CurrentDirectory + \"|\" + string.Join(\"|\", a)); } }",
      join(work, "Branch Agent.exe"));
    for (const folder of ["app-0.4.4-aaaaaa", "app-0.4.5-bbbbbb"]) {
      mkdirSync(join(root, folder));
      copyFileSync(join(work, "Branch Agent.exe"), join(root, folder, "Branch Agent.exe"));
    }
    writeFileSync(join(root, "current.txt"), "app-0.4.5-bbbbbb\r\n");
    rmSync(join(root, "app-0.4.4-aaaaaa"), { recursive: true, force: true });
    const run = spawnSync(join(root, launcher.WINDOWS_LAUNCHER_EXE), ["--hidden", "two words"], { encoding: "utf8" });
    assert.equal(run.status, 0);
    const ran = join(root, "app-0.4.5-bbbbbb", "ran.txt");
    for (const end = Date.now() + 10_000; !existsSync(ran) && Date.now() < end;) spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 100)"]);
    assert.equal(readFileSync(ran, "utf8"), [join(root, "app-0.4.5-bbbbbb"), "--hidden", "two words"].join("|"));
  } finally { rmSync(work, { recursive: true, force: true }); }
});

