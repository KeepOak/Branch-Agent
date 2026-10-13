#!/usr/bin/env node
// Wraps a target's verified desktop package (branch-desktop-<version>-<target>.tar.gz) in an installer a person can
// double-click. Nothing here signs: Windows signing is the owner's last step (see desktop/INSTALLERS.md).
//   node desktop/scripts/release-installers.mjs --assets <release-assets> --version <version> --target <target> --out <dir>
// win32-x64: a per-user Inno Setup installer (no admin prompt; the desktop updater must be able to swap its own folder).
// darwin-arm64: a .dmg holding the already-signed Branch Agent.app and an Applications link.
// linux-x64: none yet; a .deb or AppImage installs read-only, which the desktop self-update cannot swap.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Stable across releases so an installer upgrades the same per-user install. Never change it. */
export const WINDOWS_APP_ID = "{{6F0B6A43-3C1E-4D8B-9A57-2E4B1C9D7F10}";
export const TARGETS = ["win32-x64", "darwin-arm64", "linux-x64"];
export const LINUX_PENDING = "No Linux installer yet: a .deb or AppImage installs read-only, and the desktop updater swaps its own folder. Ship the tar.gz until the install location is decided.";

export function installerName(version, target) {
  if (target === "win32-x64") return `Branch-Agent-Setup-${version}-win32-x64.exe`;
  if (target === "darwin-arm64") return `Branch-Agent-${version}-darwin-arm64.dmg`;
  return null;
}

/** Inno Setup wants a numeric a.b.c.d version for the file metadata; the build id stays in AppVersion. */
export function numericVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) throw new Error(`Not a release version: ${version}`);
  return `${match[1]}.${match[2]}.${match[3]}.0`;
}

const iss = (value) => String(value).replace(/"/g, '""');

/**
 * Per-user install under %LOCALAPPDATA%\Programs, like the portable folder the desktop updater already swaps. The
 * uninstaller lives outside {app} because a whole-app update renames {app}; uninstall removes {app} and its .previous.
 */
export function innoSetupScript({ version, source, out }) {
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
    "ArchitecturesAllowed=x64compatible",
    "ArchitecturesInstallIn64BitMode=x64compatible",
    "UninstallDisplayIcon={app}\\Branch Agent.exe",
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
    'Name: "{autoprograms}\\Branch Agent"; Filename: "{app}\\Branch Agent.exe"',
    'Name: "{autodesktop}\\Branch Agent"; Filename: "{app}\\Branch Agent.exe"; Tasks: desktopicon',
    "",
    "[Run]",
    'Filename: "{app}\\Branch Agent.exe"; Description: "Open Branch Agent"; Flags: nowait postinstall skipifsilent',
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

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

export function main(argv = process.argv.slice(2)) {
  const { assets, version, target, out } = parseArgs(argv);
  if (target === "linux-x64") { console.log(LINUX_PENDING); return null; }
  const archive = resolve(assets, `branch-desktop-${version}-${target}.tar.gz`);
  if (!existsSync(archive)) throw new Error(`Missing desktop package ${archive}`);
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "branch-installer-"));
  try {
    const payload = join(work, "payload");
    mkdirSync(payload);
    run(process.platform === "win32" ? join(process.env.SYSTEMROOT ?? "C:\\Windows", "System32", "tar.exe") : "tar", ["-xzf", archive, "-C", payload]);
    const file = resolve(out, installerName(version, target));
    if (target === "win32-x64") {
      if (!existsSync(join(payload, "Branch Agent.exe"))) throw new Error("The Windows package has no Branch Agent.exe at its root");
      const script = join(work, "branch-agent.iss");
      writeFileSync(script, "\ufeff" + innoSetupScript({ version, source: payload, out: resolve(out) }));
      run(innoCompiler(), ["/Qp", script]);
    } else {
      if (!existsSync(join(payload, "Branch Agent.app"))) throw new Error("The macOS package has no Branch Agent.app at its root");
      symlinkSync("/Applications", join(payload, "Applications"));
      run("hdiutil", dmgArgs({ stage: payload, out: file }));
    }
    if (!existsSync(file)) throw new Error(`The installer was not written: ${file}`);
    console.log(`unsigned installer: ${file}`);
    return file;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); }
}
