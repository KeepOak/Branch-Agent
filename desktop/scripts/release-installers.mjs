#!/usr/bin/env node
// Wraps a target's verified desktop package (branch-desktop-<version>-<target>.tar.gz) in an installer a person can
// double-click. Signing goes through release-signing.mjs and stays off until the owner adds its secrets
// (desktop/INSTALLERS.md, "Left for the owner"); until then the installers are built unsigned and the log says so.
//   node desktop/scripts/release-installers.mjs --assets <release-assets> --version <version> --target <target> --out <dir>
// win32-x64: a per-user Inno Setup installer (no admin prompt; each update lands in a version folder under that root).
// darwin-arm64: a .dmg holding the already-signed Branch Agent.app and an Applications link.
// linux-x64: a per-user AppImage (install.sh puts it at ~/.local/bin/branch-agent), built with a pinned appimagetool.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { installerAssetName, recordInstaller } from "./release-inventory.mjs";
import { createSigner, statusLine } from "./release-signing.mjs";
import { WINDOWS_APP_USER_MODEL_ID, WINDOWS_LAUNCHER, WINDOWS_LAUNCHER_EXE, WINDOWS_LAUNCHER_RESOURCE, WINDOWS_LAUNCHER_REVISION,
  WINDOWS_LAUNCHER_REVISION_FILE, WINDOWS_POINTER, windowsLauncherScript } from "./windows-launcher.mjs";

export { windowsLauncherScript };

/** Stable across releases so an installer upgrades the same per-user install. Never change it. */
export const WINDOWS_APP_ID = "{{6F0B6A43-3C1E-4D8B-9A57-2E4B1C9D7F10}";
/** The bundled Electron's floor (Electron 23 dropped Windows 7, 8 and 8.1). */
export const WINDOWS_MIN_VERSION = "10.0";
export const TARGETS = ["win32-x64", "darwin-arm64", "linux-x64"];

/**
 * appimagetool and the AppImage runtime it embeds, pinned by release, size and SHA-256. Each download is checked before
 * it is written executable or run; a mismatch stops the build. Bump both together and re-pin from the release assets.
 */
export const APPIMAGE_TOOLS = Object.freeze({
  appimagetool: Object.freeze({ name: "appimagetool-x86_64.AppImage", bytes: 15092216,
    url: "https://github.com/AppImage/appimagetool/releases/download/1.9.1/appimagetool-x86_64.AppImage",
    sha256: "ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0" }),
  runtime: Object.freeze({ name: "runtime-x86_64", bytes: 944632,
    url: "https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64",
    sha256: "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d" }),
});
const APPRUN_SOURCE = fileURLToPath(new URL("./branch-agent-appimage.sh", import.meta.url));
const LINUX_ICON = fileURLToPath(new URL("../assets/brand/linux/branch-512.png", import.meta.url));
export const APPIMAGE_DESKTOP_ENTRY = ["[Desktop Entry]", "Type=Application", "Name=Branch Agent", "Exec=branch-agent %U",
  "Icon=branch-agent", "Categories=Utility;", "Terminal=false", ""].join("\n");

/** Downloads a pinned tool and verifies its size and SHA-256 before it is written executable. */
export async function fetchPinned(tool, directory, request = fetch) {
  const response = await request(tool.url);
  if (!response.ok) throw new Error(`Could not download ${tool.name}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== tool.sha256 || bytes.length !== tool.bytes) {
    throw new Error(`${tool.name} SHA-256 mismatch: expected ${tool.sha256}, got ${actual}; refusing to run it`);
  }
  const file = join(directory, tool.name);
  writeFileSync(file, bytes);
  chmodSync(file, 0o755);
  return file;
}

/**
 * Turns the extracted Linux desktop package into an AppDir: the package at the root, an AppRun that sets up the
 * Chromium sandbox (branch-agent-appimage.sh, bound to this package's chrome-sandbox hash), a desktop entry and icon.
 */
export function assembleAppDir(payload, appDir, icon = LINUX_ICON) {
  for (const name of ["Branch Agent.bin", "chrome-sandbox"]) {
    if (!existsSync(join(payload, name))) throw new Error(`The Linux package has no ${name} at its root`);
  }
  renameSync(payload, appDir);
  const sandbox = createHash("sha256").update(readFileSync(join(appDir, "chrome-sandbox"))).digest("hex");
  writeFileSync(join(appDir, "AppRun"), readFileSync(APPRUN_SOURCE, "utf8").replaceAll("__BRANCH_SANDBOX_SHA256__", sandbox));
  chmodSync(join(appDir, "AppRun"), 0o755);
  writeFileSync(join(appDir, "branch-agent.desktop"), APPIMAGE_DESKTOP_ENTRY);
  copyFileSync(icon, join(appDir, "branch-agent.png"));
  return appDir;
}

/** appimagetool with the pinned runtime: nothing is fetched at build time and no AppStream check runs. */
export function appImageToolArgs({ appDir, runtime, out }) {
  return ["--no-appstream", "--runtime-file", runtime, appDir, out];
}

/** appimagetool is itself an AppImage; extract-and-run avoids needing FUSE on the build runner. */
export function appImageToolEnv(version, env = process.env) {
  return { ...env, ARCH: "x86_64", VERSION: version, APPIMAGE_EXTRACT_AND_RUN: "1" };
}

export function installerName(version, target) {
  return installerAssetName(version, target);
}

/** Inno Setup wants a numeric a.b.c.d version for the file metadata; the build id stays in AppVersion. */
export function numericVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Not a release version: ${version}`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

const iss = (value) => String(value).replace(/"/g, '""');

/** Same naming as desktop-update-helper: a version folder under the user-writable install root. */
export function windowsInstallerFolderName(version) {
  const safe = String(version).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "build";
  return `app-${safe}`;
}

/**
 * The install root the Inno Setup package copies into {app}: the package in its version folder, current.txt naming it,
 * the stable launcher every shortcut opens (from the package's resources/, so updates carry the same one) and the
 * cmd stub, both from windows-launcher.mjs. signApp signs the launcher at the root.
 */
export function layoutWindowsInstallRoot({ payload, root, version, signApp = () => undefined }) {
  const folder = windowsInstallerFolderName(version);
  const app = join(root, folder);
  mkdirSync(app, { recursive: true });
  for (const name of readdirSync(payload)) renameSync(join(payload, name), join(app, name));
  const bundled = join(app, "resources", WINDOWS_LAUNCHER_RESOURCE);
  if (!existsSync(bundled)) throw new Error(`The Windows package has no resources/${WINDOWS_LAUNCHER_RESOURCE} (the Start-menu launcher)`);
  copyFileSync(bundled, join(root, WINDOWS_LAUNCHER_EXE));
  signApp(join(root, WINDOWS_LAUNCHER_EXE));
  writeFileSync(join(root, WINDOWS_LAUNCHER_REVISION_FILE), `${WINDOWS_LAUNCHER_REVISION}\n`);
  writeFileSync(join(root, WINDOWS_POINTER), `${folder}\n`);
  writeFileSync(join(root, WINDOWS_LAUNCHER), windowsLauncherScript());
  return folder;
}

/**
 * Per-user install under %LOCALAPPDATA%\Programs. Each build lives in a version folder; current.txt is the pointer
 * the launcher reads. Shortcuts open the launcher at the root, which outlives every version folder, and carry the
 * app's AppUserModelID so a pinned window opens it too. Start in is the user folder, not {app}: a process
 * whose working folder is the install directory blocks a later swap (#1777, #787). The uninstaller lives
 * outside {app} so leftover {app}.previous from older swaps still goes.
 */
export function innoSetupScript({ version, source, out }) {
  const exe = `{app}\\${WINDOWS_LAUNCHER_EXE}`;
  const shortcut = `Filename: "${exe}"; WorkingDir: "{%USERPROFILE}"; AppUserModelID: "${WINDOWS_APP_USER_MODEL_ID}"`;
  return [
    "[Setup]",
    `AppId=${WINDOWS_APP_ID}`,
    "AppName=Branch Agent",
    `AppVersion=${version}`,
    "AppPublisher=KeepOak",
    `VersionInfoVersion=${numericVersion(version)}`,
    "DefaultDirName={localappdata}\\Programs\\Branch Agent",
    "UninstallFilesDir={localappdata}\\Programs\\Branch Agent Uninstall",
    "DisableProgramGroupPage=yes",
    "DisableDirPage=yes",
    "PrivilegesRequired=lowest",
    // Electron 23 and later need Windows 10; Setup refuses older Windows before installing anything.
    `MinVersion=${WINDOWS_MIN_VERSION}`,
    "ArchitecturesAllowed=x64compatible",
    "ArchitecturesInstallIn64BitMode=x64compatible",
    `UninstallDisplayIcon=${exe}`,
    "UninstallDisplayName=Branch Agent",
    "CloseApplications=yes",
    "WizardStyle=modern",
    "Compression=lzma2/max",
    "SolidCompression=yes",
    `OutputDir=${out}`,
    `OutputBaseFilename=${installerName(version, "win32-x64").replace(/\.exe$/, "")}`,
    "",
    "[Tasks]",
    'Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked',
    "",
    "[Files]",
    `Source: "${iss(source)}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs`,
    "",
    "[Icons]",
    `Name: "{autoprograms}\\Branch Agent"; ${shortcut}`,
    `Name: "{autodesktop}\\Branch Agent"; ${shortcut}; Tasks: desktopicon`,
    "",
    "[Run]",
    `Filename: "${exe}"; Description: "Open Branch Agent"; WorkingDir: "{%USERPROFILE}"; Flags: nowait postinstall skipifsilent`,
    "",
    "[UninstallDelete]",
    'Type: filesandordirs; Name: "{app}"',
    'Type: filesandordirs; Name: "{app}.previous"',
    "",
  ].join("\r\n");
}

export function dmgArgs({ stage, out }) {
  return ["create", "-volname", "Branch Agent", "-srcfolder", stage, "-fs", "HFS+", "-format", "UDZO", "-ov", out];
}

export function parseArgs(argv) {
  const value = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1]; };
  const args = { assets: value("--assets"), version: value("--version"), target: value("--target"), out: value("--out") };
  for (const [key, given] of Object.entries(args)) if (!given) throw new Error(`Missing --${key}`);
  if (!TARGETS.includes(args.target)) throw new Error(`Unknown target ${args.target}`);
  numericVersion(args.version);
  return args;
}

/** The Inno Setup compiler preinstalled on hosted Windows runners, or the one INNO_SETUP_COMPILER names. */
export function innoCompiler(env = process.env, exists = existsSync) {
  const candidates = [env.INNO_SETUP_COMPILER, env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe"), env.ProgramFiles && join(env.ProgramFiles, "Inno Setup 6", "ISCC.exe")].filter(Boolean);
  const found = candidates.find((file) => exists(file));
  if (!found) throw new Error("Inno Setup 6 (ISCC.exe) was not found; set INNO_SETUP_COMPILER");
  return found;
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: "inherit", env });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

export async function main(argv = process.argv.slice(2), request = fetch) {
  const { assets, version, target, out } = parseArgs(argv);
  const archive = resolve(assets, `branch-desktop-${version}-${target}.tar.gz`);
  if (!existsSync(archive)) throw new Error(`Missing desktop package ${archive}`);
  mkdirSync(out, { recursive: true });
  const signer = createSigner({ target });
  console.log(statusLine(signer.status));
  const work = mkdtempSync(join(tmpdir(), "branch-installer-"));
  try {
    const payload = join(work, "payload");
    mkdirSync(payload);
    run(process.platform === "win32" ? join(process.env.SYSTEMROOT ?? "C:\\Windows", "System32", "tar.exe") : "tar", ["-xzf", archive, "-C", payload]);
    const file = resolve(out, installerName(version, target));
    if (target === "win32-x64") {
      if (!existsSync(join(payload, "Branch Agent.exe"))) throw new Error("The Windows package has no Branch Agent.exe at its root");
      signer.signApp(join(payload, "Branch Agent.exe"));
      const root = join(work, "install-root");
      layoutWindowsInstallRoot({ payload, root, version, signApp: file => signer.signApp(file) });
      const script = join(work, "branch-agent.iss");
      writeFileSync(script, "\ufeff" + innoSetupScript({ version, source: root, out: resolve(out) }));
      run(innoCompiler(), ["/Qp", script]);
    } else if (target === "linux-x64") {
      const appDir = assembleAppDir(payload, join(work, "Branch-Agent.AppDir"));
      const tool = await fetchPinned(APPIMAGE_TOOLS.appimagetool, work, request);
      const runtime = await fetchPinned(APPIMAGE_TOOLS.runtime, work, request);
      run(tool, appImageToolArgs({ appDir, runtime, out: file }), appImageToolEnv(version));
      chmodSync(file, 0o755);
    } else {
      if (!existsSync(join(payload, "Branch Agent.app"))) throw new Error("The macOS package has no Branch Agent.app at its root");
      signer.signApp(join(payload, "Branch Agent.app"));
      symlinkSync("/Applications", join(payload, "Applications"));
      run("hdiutil", dmgArgs({ stage: payload, out: file }));
    }
    if (!existsSync(file)) throw new Error(`The installer was not written: ${file}`);
    const signed = signer.signInstaller(file);
    console.log(`${signed ? "signed" : "unsigned"} installer: ${file}`);
    return file;
  } finally {
    signer.dispose();
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const file = await main();
    // The target's release proof lists the installer, so publish attaches it and checks its bytes.
    if (file) { const { assets, target } = parseArgs(process.argv.slice(2)); await recordInstaller(assets, target, file); }
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
