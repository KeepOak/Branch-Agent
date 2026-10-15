import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { APPIMAGE_DESKTOP_ENTRY, APPIMAGE_TOOLS, appImageToolArgs, appImageToolEnv, assembleAppDir, dmgArgs, fetchPinned, innoCompiler, innoSetupScript,
  installerName, main, numericVersion, parseArgs, WINDOWS_APP_ID, windowsInstallerFolderName, windowsLauncherScript } from "./release-installers.mjs";

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

test("installer names carry the release version and target", () => {
  assert.equal(installerName("0.4.4-build-56aed4e6d99d", "win32-x64"), "Branch-Agent-Setup-0.4.4-build-56aed4e6d99d-win32-x64.exe");
  assert.equal(installerName("0.4.4-build-56aed4e6d99d", "darwin-arm64"), "Branch-Agent-0.4.4-build-56aed4e6d99d-darwin-arm64.dmg");
  assert.equal(installerName("0.4.4-build-56aed4e6d99d", "linux-x64"), "Branch-Agent-0.4.4-build-56aed4e6d99d-linux-x64.AppImage");
});

test("the Windows installer is per-user and leaves nothing the desktop updater swaps behind", () => {
  const version = "0.4.4-build-56aed4e6d99d";
  const folder = windowsInstallerFolderName(version);
  const script = innoSetupScript({ version, source: "C:\\stage\\payload", out: "C:\\out", folder });
  const lines = script.split("\r\n");
  const exe = `{app}\\${folder}\\Branch Agent.exe`;
  assert.equal(folder, "app-0.4.4-build-56aed4e6d99d");
  assert.ok(lines.includes(`AppId=${WINDOWS_APP_ID}`));
  assert.ok(lines.includes("PrivilegesRequired=lowest"), "no admin prompt");
  assert.doesNotMatch(script, /requireAdministrator|PrivilegesRequired=admin|runas/i, "never needs a UAC prompt");
  assert.ok(lines.includes("MinVersion=10.0"), "Setup refuses Windows the bundled Electron can't run on");
  assert.ok(lines.includes("DefaultDirName={localappdata}\\Programs\\Branch Agent"), "a user-writable install root");
  assert.ok(lines.includes("UninstallFilesDir={localappdata}\\Programs\\Branch Agent Uninstall"), "the uninstaller survives leftover folders");
  assert.ok(script.includes(`Filename: "${exe}"`), "shortcuts point at the version folder");
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
