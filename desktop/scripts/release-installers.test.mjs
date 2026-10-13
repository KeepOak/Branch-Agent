import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { dmgArgs, innoCompiler, innoSetupScript, installerName, LINUX_PENDING, main, numericVersion, parseArgs, WINDOWS_APP_ID } from "./release-installers.mjs";

test("installer names carry the release version and target", () => {
  assert.equal(installerName("0.4.4-build-56aed4e6d99d", "win32-x64"), "Branch-Agent-Setup-0.4.4-build-56aed4e6d99d-win32-x64.exe");
  assert.equal(installerName("0.4.4-build-56aed4e6d99d", "darwin-arm64"), "Branch-Agent-0.4.4-build-56aed4e6d99d-darwin-arm64.dmg");
  assert.equal(installerName("0.4.4", "linux-x64"), null);
});

test("the Windows installer is per-user and leaves nothing the desktop updater swaps behind", () => {
  const script = innoSetupScript({ version: "0.4.4-build-56aed4e6d99d", source: "C:\\stage\\payload", out: "C:\\out" });
  const lines = script.split("\r\n");
  assert.ok(lines.includes(`AppId=${WINDOWS_APP_ID}`));
  assert.ok(lines.includes("PrivilegesRequired=lowest"), "no admin prompt");
  assert.ok(lines.includes("DefaultDirName={localappdata}\\Programs\\Branch Agent"), "a folder the updater can rename");
  assert.ok(lines.includes("UninstallFilesDir={localappdata}\\Programs\\Branch Agent Uninstall"), "the uninstaller survives a whole-app swap");
  assert.ok(lines.includes('Type: filesandordirs; Name: "{app}"'));
  assert.ok(lines.includes('Type: filesandordirs; Name: "{app}.previous"'));
  assert.ok(lines.includes("AppVersion=0.4.4-build-56aed4e6d99d"));
  assert.ok(lines.includes("VersionInfoVersion=0.4.4.0"));
  assert.ok(lines.includes("OutputBaseFilename=Branch-Agent-Setup-0.4.4-build-56aed4e6d99d-win32-x64"));
  assert.ok(lines.some((line) => line.startsWith('Source: "C:\\stage\\payload\\*"')));
  assert.doesNotMatch(script, /SignTool|signtool/i, "nothing signs here");
});

test("the macOS image wraps the signed app with an Applications link", () => {
  assert.deepEqual(dmgArgs({ stage: "/tmp/p", out: "/tmp/o.dmg" }), ["create", "-volname", "Branch Agent", "-srcfolder", "/tmp/p", "-fs", "HFS+", "-format", "UDZO", "-ov", "/tmp/o.dmg"]);
});

test("arguments are checked before anything is extracted", () => {
  assert.throws(() => parseArgs(["--assets", "a", "--version", "0.4.4", "--target", "win32-x64"]), /Missing --out/);
  assert.throws(() => parseArgs(["--assets", "a", "--version", "0.4.4", "--target", "win32-arm64", "--out", "o"]), /Unknown target/);
  assert.throws(() => numericVersion("latest"), /Not a release version/);
  assert.equal(main(["--assets", "a", "--version", "0.4.4", "--target", "linux-x64", "--out", "o"]), null);
  assert.match(LINUX_PENDING, /read-only/);
});

test("the Inno Setup compiler is found or named", () => {
  const env = { "ProgramFiles(x86)": "C:\\PF86" };
  assert.equal(innoCompiler(env, (file) => file.startsWith("C:\\PF86")), join("C:\\PF86", "Inno Setup 6", "ISCC.exe"));
  assert.throws(() => innoCompiler({}, () => false), /INNO_SETUP_COMPILER/);
});
