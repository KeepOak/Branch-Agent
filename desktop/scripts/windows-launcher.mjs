// The one source for the Windows stable launcher. Shortcuts point at a small launcher exe at the install root; it reads
// current.txt and starts that version folder's Branch Agent.exe, so a shortcut never names a version folder that prune
// can remove. The release build compiles the launcher (resources/branch-launcher.exe in each Windows package); the
// installer and the desktop app place it at the root; the installer and the update helper write the cmd stub below.
// Node built-ins only: build.mjs copies this file into dist, and the update helper loads it from beside itself.
import { dirname, join, win32 } from "node:path";

/** Pointer the launcher, the cmd stub and the update helper read; switched by an atomic rename. */
export const WINDOWS_POINTER = "current.txt";
/** Cmd stub for a terminal or a script. Shortcuts never use it: a .cmd always opens a console window. */
export const WINDOWS_LAUNCHER = "Branch Agent.cmd";
/** The stable launcher at the install root that every shortcut points at. */
export const WINDOWS_LAUNCHER_EXE = "Branch Agent Launcher.exe";
/** Where each Windows package carries its copy of the launcher, under resources/. */
export const WINDOWS_LAUNCHER_RESOURCE = "branch-launcher.exe";
/** Beside the root launcher: the revision it was placed from. A newer revision replaces it; the same one never does. */
export const WINDOWS_LAUNCHER_REVISION_FILE = "launcher-revision.txt";
export const WINDOWS_LAUNCHER_REVISION = "launcher-v1";
/** The app's AppUserModelID (main.ts); a shortcut that carries it is the one Windows pins for a running window. */
export const WINDOWS_APP_USER_MODEL_ID = "dev.branch.agent.desktop";
const APP_EXE = "Branch Agent.exe";
const VERSION_FOLDER = /^app-[A-Za-z0-9._-]+$/;

export function windowsLauncherScript() {
  return [
    "@echo off",
    "setlocal EnableDelayedExpansion",
    'set "ROOT=%~dp0"',
    'set "VER="',
    'if exist "%ROOT%' + WINDOWS_POINTER + '" set /p VER=<"%ROOT%' + WINDOWS_POINTER + '"',
    'if defined VER if exist "%ROOT%!VER!\\Branch Agent.exe" (',
    '  start "" "%ROOT%!VER!\\Branch Agent.exe" %*',
    "  exit /b 0",
    ")",
    'if exist "%ROOT%Branch Agent.exe" start "" "%ROOT%Branch Agent.exe" %*',
    "",
  ].join("\r\n");
}

/**
 * The executable the launcher at root starts: the version folder current.txt names when it holds Branch Agent.exe,
 * else a legacy Branch Agent.exe at the root itself, else none. The compiled launcher (windowsLauncherSource) follows
 * the same rules. fs: { readText(path) -> string | undefined, exists(path) -> boolean }.
 */
export function windowsLaunchTarget(root, fs) {
  const folder = (fs.readText(join(root, WINDOWS_POINTER)) ?? "").replace(/^\uFEFF/, "").split(/\r?\n/)[0].trim();
  if (VERSION_FOLDER.test(folder)) {
    const exe = join(root, folder, APP_EXE);
    if (fs.exists(exe)) return exe;
  }
  const legacy = join(root, APP_EXE);
  return fs.exists(legacy) ? legacy : undefined;
}

/** What the launcher does when a shortcut opens it: start the target with the shortcut's arguments, from its folder. */
export function runWindowsLauncher({ root, args = [], fs, spawn }) {
  const exe = windowsLaunchTarget(root, fs);
  if (!exe) return undefined;
  spawn(exe, args, { cwd: dirname(exe), detached: true, stdio: "ignore", windowsHide: false });
  return exe;
}

/**
 * A shortcut target the launcher replaces: Branch Agent.exe in a version folder under root, or a legacy one at root.
 * Anything else (the launcher itself, another app, a folder outside root) is left alone.
 */
export function windowsShortcutNeedsLauncher(target, root) {
  if (!target || !root) return false;
  const full = win32.resolve(target).toLowerCase();
  const base = win32.resolve(root).replace(/\\+$/, "").toLowerCase();
  if (!full.startsWith(base + "\\")) return false;
  const parts = full.slice(base.length + 1).split("\\");
  if (parts.length === 1) return parts[0] === APP_EXE.toLowerCase();
  return parts.length === 2 && VERSION_FOLDER.test(parts[0]) && parts[1] === APP_EXE.toLowerCase();
}

/**
 * C# source of the launcher. A windowed (winexe) program, so opening it shows no console; it starts the target with
 * CreateProcess, passes its own arguments through and exits. Built with the C# compiler that ships with the .NET
 * Framework 4 in Windows (windowsLauncherCompiler), so the release needs no extra toolchain.
 */
export function windowsLauncherSource() {
  return [
    "using System;",
    "using System.Diagnostics;",
    "using System.IO;",
    "using System.Text;",
    "using System.Text.RegularExpressions;",
    '[assembly: System.Reflection.AssemblyTitle("Branch Agent")]',
    '[assembly: System.Reflection.AssemblyProduct("Branch Agent")]',
    "static class BranchAgentLauncher {",
    "  static int Main(string[] args) {",
    "    string root = AppDomain.CurrentDomain.BaseDirectory;",
    "    string exe = Target(root);",
    "    if (exe == null) return 2;",
    "    ProcessStartInfo start = new ProcessStartInfo(exe, Join(args));",
    "    start.UseShellExecute = false;",
    "    start.WorkingDirectory = Path.GetDirectoryName(exe);",
    "    using (Process.Start(start)) { }",
    "    return 0;",
    "  }",
    "  static string Target(string root) {",
    "    try {",
    '      string pointer = Path.Combine(root, "' + WINDOWS_POINTER + '");',
    "      if (File.Exists(pointer)) {",
    "        string[] lines = File.ReadAllLines(pointer);",
    '        string folder = lines.Length > 0 ? lines[0].Trim() : "";',
    '        if (Regex.IsMatch(folder, "' + VERSION_FOLDER.source + '")) {',
    '          string exe = Path.Combine(Path.Combine(root, folder), "' + APP_EXE + '");',
    "          if (File.Exists(exe)) return exe;",
    "        }",
    "      }",
    "    } catch (Exception) { }",
    '    string legacy = Path.Combine(root, "' + APP_EXE + '");',
    "    return File.Exists(legacy) ? legacy : null;",
    "  }",
    "  static string Join(string[] args) {",
    "    StringBuilder line = new StringBuilder();",
    "    foreach (string arg in args) {",
    "      if (line.Length > 0) line.Append(' ');",
    "      line.Append(Quote(arg));",
    "    }",
    "    return line.ToString();",
    "  }",
    "  static string Quote(string arg) {",
    "    if (arg.Length > 0 && arg.IndexOfAny(new char[] { ' ', '\\t', '\\n', '\\v', '\"' }) < 0) return arg;",
    '    StringBuilder quoted = new StringBuilder("\\"");',
    "    int slashes = 0;",
    "    foreach (char c in arg) {",
    "      if (c == '\\\\') { slashes++; continue; }",
    "      quoted.Append('\\\\', c == '\"' ? slashes * 2 + 1 : slashes);",
    "      quoted.Append(c);",
    "      slashes = 0;",
    "    }",
    "    quoted.Append('\\\\', slashes * 2);",
    "    quoted.Append('\"');",
    "    return quoted.ToString();",
    "  }",
    "}",
    "",
  ].join("\r\n");
}

/** The .NET Framework 4 C# compiler that ships with Windows 10 and 11 (and the hosted Windows runners). */
export function windowsLauncherCompiler(env, exists) {
  const windows = env.SystemRoot || env.SYSTEMROOT || env.windir || "C:\\Windows";
  const candidates = [env.BRANCH_WINDOWS_CSC,
    win32.join(windows, "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    win32.join(windows, "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe")].filter(Boolean);
  const found = candidates.find(file => exists(file));
  if (!found) throw new Error("The .NET Framework 4 C# compiler (csc.exe) was not found; it builds the Windows launcher");
  return found;
}

/**
 * csc arguments: a windowed exe (no console). Never /win32icon: the .NET Framework csc reads the .ico itself and
 * fails the build on assets/branch.ico, whose images are all PNG-compressed. The release build stamps the icon on
 * afterwards (windows-launcher-icon.mjs), the same way the packager stamps it on Branch Agent.exe.
 */
export function windowsLauncherCompileArgs({ source, out }) {
  return ["/nologo", "/target:winexe", "/optimize+", "/platform:anycpu", "/out:" + out, source];
}
