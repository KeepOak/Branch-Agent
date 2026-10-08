// Frees the packaged app folder before the shell swap. A process is a holder when its executable
// (the Windows image path) or its current directory is inside the folder being replaced. The process
// name is never enough, and nothing outside that folder is signaled. The helper copies this file
// beside itself; both use only Node built-ins.
import { execFile } from "node:child_process";
import { constants, copyFileSync, mkdirSync, statSync } from "node:fs";
import { access, cp, readdir, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

export const BESIDE_MARKER = "desktop-update-beside.json";
const SWAP_ATTEMPTS = 8;
const SWAP_RETRY_MS = 250;
const LOCK_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
export interface ListedProcess {
  pid: number;
  executable: string;
  command: string;
  cwd: string;
}

export interface PlaceDeps {
  list(): Promise<ListedProcess[]>;
  askExit(pid: number): Promise<void>;
  forceStop(pid: number): Promise<void>;
  alive(pid: number): boolean;
  wait(ms: number): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copyTree?(from: string, to: string): Promise<void>;
  remove?(path: string): Promise<void>;
  exists?(path: string): Promise<boolean>;
  log(line: string): void;
}

export interface PlaceRequest {
  installDir: string;
  target: string;
  staged: string;
  previous: string;
  besideDir: string;
  kind: "asar" | "runtime";
  /** asar target relative to the install folder; unused for a whole-app swap. */
  targetRelative: string;
  relaunchCommand: string;
  excludePids: number[];
  attempts?: number;
  deps: PlaceDeps;
}

export interface PlaceResult {
  result: "swapped" | "beside";
  relaunch: string;
  blockers: string[];
}

const runFile = promisify(execFile);

function baseName(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function pathStyle(installDir: string): "win32" | "posix" {
  return /^[A-Za-z]:[\\/]/.test(installDir) || installDir.includes("\\") ? "win32" : "posix";
}

/** Compare install-relative paths without asking the host to reinterpret another OS's separators. */
export function normalizeInstallPath(input: string, platform: "win32" | "posix"): string {
  const slash = input.replaceAll("\\", "/");
  const absolute = slash.startsWith("/");
  const parts: string[] = [];
  for (const part of slash.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { parts.pop(); continue; }
    parts.push(platform === "win32" ? part.toLowerCase() : part);
  }
  const joined = parts.join("/");
  return absolute && platform === "posix" ? `/${joined}` : joined;
}

export function pathInsideInstall(installDir: string, candidate: string): boolean {
  if (!candidate || candidate === ".") return false;
  const platform = pathStyle(installDir);
  const base = normalizeInstallPath(installDir, platform);
  const child = normalizeInstallPath(candidate, platform);
  if (!base || !child) return false;
  if (child === base) return true;
  return child.startsWith(`${base}/`);
}

export function describeHolder(info: ListedProcess): string {
  const cwd = info.cwd ? ` cwd ${info.cwd}` : "";
  const executable = info.executable ? ` executable ${info.executable}` : "";
  return `pid ${info.pid}${cwd}${executable}`;
}

/** A holder is a process whose executable or current directory is inside this install. The process name is not used. */
export function holdersInInstall(installDir: string, processes: readonly ListedProcess[], exclude: ReadonlySet<number>): ListedProcess[] {
  return processes.filter(info => {
    if (!Number.isInteger(info.pid) || info.pid <= 0 || exclude.has(info.pid)) return false;
    return pathInsideInstall(installDir, info.executable) || pathInsideInstall(installDir, info.cwd);
  });
}

export interface ShortcutLink {
  path: string;
  target: string;
  workingDirectory: string;
}

function parentOf(input: string): string {
  const platform = pathStyle(input);
  const slash = input.replaceAll("\\", "/").replace(/\/+$/, "");
  const cut = slash.lastIndexOf("/");
  if (cut <= 0) return input;
  const parent = slash.slice(0, cut);
  return platform === "win32" ? parent.replaceAll("/", "\\") : parent;
}

/** Where a shortcut should start: the data folder, when that folder is not the shell being replaced. */
export function stableShortcutDirectory(shellDir: string, dataDir: string): string {
  if (dataDir && !pathInsideInstall(shellDir, dataDir)) return dataDir;
  return parentOf(shellDir);
}

/** The new Start-in directory when this link's target lives in the shell and its working directory does too. */
export function repairedWorkingDirectory(link: ShortcutLink, shellDir: string, dataDir: string): string | undefined {
  if (!pathInsideInstall(shellDir, link.target)) return undefined;
  if (link.workingDirectory && !pathInsideInstall(shellDir, link.workingDirectory)) return undefined;
  return stableShortcutDirectory(shellDir, dataDir);
}

/** Re-saves Branch shortcuts that already target this executable, and points Start in outside the shell folder. */
export function shortcutRepairScript(exe: string, workingDirectory: string): string {
  const quotedExe = exe.replaceAll("'", "''");
  const quotedDir = workingDirectory.replaceAll("'", "''");
  return `$exe='${quotedExe}'; $work='${quotedDir}'; $shell=New-Object -ComObject WScript.Shell; foreach($dir in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Startup'))) { if(!$dir) { continue }; $path=Join-Path $dir 'Branch Agent.lnk'; if(!(Test-Path -LiteralPath $path)) { continue }; $link=$shell.CreateShortcut($path); if($link.TargetPath -ieq $exe) { $link.WorkingDirectory=$work; $link.IconLocation="$exe,0"; $link.Save() } }`;
}

/** The shell folder that contains a bundled resources/node runtime, or undefined for any other Node. */
export function shellOfBundledNode(nodePath: string): string | undefined {
  const platform = pathStyle(nodePath);
  const slash = nodePath.replaceAll("\\", "/");
  const probe = platform === "win32" ? slash.toLowerCase() : slash;
  const match = /^(.*)\/resources\/node\/node(?:\.exe)?$/.exec(probe);
  if (!match?.[1]) return undefined;
  const prefix = slash.slice(0, match[1].length);
  if (!prefix) return undefined;
  return platform === "win32" ? prefix.replaceAll("/", "\\") : prefix;
}

function portableJoin(dir: string, ...parts: string[]): string {
  const sep = pathStyle(dir) === "win32" ? "\\" : "/";
  return [dir.replace(/[\\/]+$/, ""), ...parts].join(sep);
}

/**
 * Copies a bundled resources/node runtime into the data folder so the engine is not running from the
 * shell the updater renames. Any other Node path is returned unchanged.
 */
export function nodeOutsideSwappedFolder(nodePath: string, dataDir: string): string {
  const shell = shellOfBundledNode(nodePath);
  if (!shell || !dataDir) return nodePath;
  const dest = portableJoin(dataDir, "runtime-node", baseName(nodePath));
  if (pathInsideInstall(shell, dest)) return nodePath;
  try {
    mkdirSync(portableJoin(dataDir, "runtime-node"), { recursive: true });
    const source = statSync(nodePath);
    let same = false;
    try {
      const current = statSync(dest);
      same = current.size === source.size && current.mtimeMs >= source.mtimeMs;
    } catch { /* not copied yet */ }
    if (!same) copyFileSync(nodePath, dest);
    return dest;
  } catch (error) {
    try {
      statSync(dest);
      if (LOCK_CODES.has((error as NodeJS.ErrnoException).code ?? "")) return dest;
    } catch { /* no copy to keep running */ }
    return nodePath;
  }
}

export function installDirFor(kind: "asar" | "runtime", target: string): string {
  return kind === "runtime" ? target : dirname(dirname(target));
}

export function besideInstallDir(installDir: string): string {
  return join(dirname(installDir), `${baseName(installDir)} (updated)`);
}

export function relaunchBeside(command: string, installDir: string, besideDir: string): string {
  if (!pathInsideInstall(installDir, command)) return command;
  const platform = pathStyle(installDir);
  const base = normalizeInstallPath(installDir, platform);
  const child = normalizeInstallPath(command, platform);
  const relativeNorm = child.slice(base.length).replace(/^\//, "");
  const commandSlash = command.replaceAll("\\", "/");
  const tail = commandSlash.slice(commandSlash.length - relativeNorm.length);
  return tail ? join(besideDir, ...tail.split("/")) : besideDir;
}

function isLockError(error: unknown): boolean {
  return LOCK_CODES.has((error as NodeJS.ErrnoException)?.code ?? "");
}

function backoff(attempt: number): number {
  return Math.min(SWAP_RETRY_MS * 2 ** attempt, 2_000);
}

/** Carries a verified old executable when restoring the live folder fails. */
export class RestoreLiveFolderError extends Error {
  readonly relaunch: string | undefined;
  constructor(message: string, relaunch: string | undefined) { super(message); this.relaunch = relaunch; }
}

/** Puts the live folder back. A failed second rename must not leave the install missing. */
async function restoreLiveFolder(request: PlaceRequest, attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (request.deps.exists) {
      const previousThere = await request.deps.exists(request.previous);
      const targetThere = await request.deps.exists(request.target);
      if (!previousThere && targetThere) return Boolean(await request.deps.exists(request.relaunchCommand));
    }
    try {
      await request.deps.move(request.previous, request.target);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (code === "ENOENT") return Boolean(request.deps.exists && await request.deps.exists(request.target) && await request.deps.exists(request.relaunchCommand));
      if (!isLockError(error) || attempt + 1 >= attempts) return false;
      await request.deps.wait(backoff(attempt));
    }
  }
  return false;
}

async function tryInPlace(request: PlaceRequest, attempts: number, held: string[]): Promise<boolean> {
  const who = held.join("; ") || "a file lock";
  for (let attempt = 0; attempt < attempts; attempt++) {
    let movedAside = false;
    try {
      await request.deps.move(request.target, request.previous);
      movedAside = true;
      await request.deps.move(request.staged, request.target);
      return true;
    } catch (error) {
      if (movedAside) {
        const restored = await restoreLiveFolder(request, attempts);
        if (!restored) {
          const previousCommand = request.kind === "runtime" && pathInsideInstall(request.target, request.relaunchCommand)
            ? relaunchBeside(request.relaunchCommand, request.target, request.previous) : undefined;
          const relaunch = previousCommand && request.deps.exists && await request.deps.exists(previousCommand) ? previousCommand : undefined;
          request.deps.log(relaunch
            ? `desktop update: restore failed; relaunching previous copy from ${relaunch}`
            : `desktop update: restore failed; no verified executable; refusing to launch ${request.relaunchCommand}`);
          throw new RestoreLiveFolderError(`desktop update: could not restore ${request.target}; held by ${who}`, relaunch);
        }
        request.deps.log(`desktop update: put ${request.target} back; the new copy could not take its place (${who})`);
      }
      if (!isLockError(error)) throw error;
      request.deps.log(`desktop update: ${request.target} is held by ${who}; retrying the move`);
    }
    if (attempt + 1 < attempts) await request.deps.wait(backoff(attempt));
  }
  return false;
}

async function waitUntilExit(holders: readonly ListedProcess[], deps: PlaceDeps, attempts: number): Promise<ListedProcess[]> {
  let left = holders.filter(holder => deps.alive(holder.pid));
  for (let attempt = 0; attempt < attempts && left.length; attempt++) {
    await deps.wait(backoff(attempt));
    left = holders.filter(holder => deps.alive(holder.pid));
  }
  return left;
}

/**
 * Asks processes whose executable or current directory is inside the install to leave, force-stops only
 * those that stay, waits for them to exit, then renames the staged shell into place. A folder that is
 * still locked is left intact and the staged shell is installed beside it. A half-finished rename is
 * put back. A non-lock failure is rethrown so the caller can keep the update staged.
 */
export async function placeAppShell(request: PlaceRequest): Promise<PlaceResult> {
  const exclude = new Set(request.excludePids);
  let listed: ListedProcess[] = [];
  try { listed = await request.deps.list(); }
  catch (error) { request.deps.log(`desktop update: could not list processes in the install folder (${String(error)})`); }
  const holders = holdersInInstall(request.installDir, listed, exclude);
  const attempts = request.attempts ?? SWAP_ATTEMPTS;
  for (const holder of holders) {
    request.deps.log(`desktop update: asking ${describeHolder(holder)} to exit so the install folder can be replaced`);
    try { await request.deps.askExit(holder.pid); } catch { /* already gone */ }
  }
  let lingering = holders.length ? await waitUntilExit(holders, request.deps, attempts) : [];
  for (const holder of lingering) {
    request.deps.log(`desktop update: stopping ${describeHolder(holder)} after it stayed in the install folder`);
    try { await request.deps.forceStop(holder.pid); } catch { /* already gone */ }
  }
  lingering = lingering.length ? await waitUntilExit(lingering, request.deps, attempts) : [];
  const blockers = lingering.map(describeHolder);
  if (await tryInPlace(request, attempts, blockers)) return { result: "swapped", relaunch: request.relaunchCommand, blockers };

  const blockedBy = blockers.join("; ") || "a file lock";
  request.deps.log(`desktop update: install folder stayed in use (${blockedBy}); installing side by side at ${request.besideDir}`);
  try {
    await request.deps.remove?.(request.besideDir);
    if (request.kind === "runtime") await request.deps.move(request.staged, request.besideDir);
    else {
      if (!request.deps.copyTree) throw new Error("side-by-side install needs a copy of the current app");
      await request.deps.copyTree(request.installDir, request.besideDir);
      const dest = join(request.besideDir, request.targetRelative);
      await request.deps.remove?.(dest);
      await request.deps.move(request.staged, dest);
    }
  } catch (error) {
    request.deps.log(`desktop update: side-by-side install failed (${String(error)}); still blocked by ${blockedBy}`);
    throw error;
  }
  return { result: "beside", relaunch: relaunchBeside(request.relaunchCommand, request.installDir, request.besideDir), blockers };
}

export function parseWindowsProcessList(text: string): ListedProcess[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  let value: unknown;
  try { value = JSON.parse(trimmed); } catch { return []; }
  const rows = Array.isArray(value) ? value : [value];
  const result: ListedProcess[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as { ProcessId?: unknown; ExecutablePath?: unknown; CommandLine?: unknown; CurrentDirectory?: unknown };
    const pid = typeof item.ProcessId === "number" ? item.ProcessId : Number(item.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    result.push({
      pid,
      executable: typeof item.ExecutablePath === "string" ? item.ExecutablePath : "",
      command: typeof item.CommandLine === "string" ? item.CommandLine : "",
      cwd: typeof item.CurrentDirectory === "string" ? item.CurrentDirectory : "",
    });
  }
  return result;
}

function windowsProcessScript(): string {
  // Win32_Process has no working directory. Read it from the process parameters; a failure leaves cwd empty.
  return `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class BranchProcCwd {
  const int Access = 0x0410;
  [StructLayout(LayoutKind.Sequential)] struct PBI {
    public IntPtr Reserved1; public IntPtr PebBaseAddress; public IntPtr Reserved2_0; public IntPtr Reserved2_1; public IntPtr UniqueProcessId; public IntPtr Reserved3;
  }
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr h, IntPtr baseAddr, byte[] buf, int size, out IntPtr read);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr p, int cls, ref PBI info, int len, out int ret);
  public static string Directory(int pid) {
    IntPtr h = OpenProcess(Access, false, pid);
    if (h == IntPtr.Zero) return "";
    try {
      PBI info = new PBI(); int ret;
      if (NtQueryInformationProcess(h, 0, ref info, Marshal.SizeOf(typeof(PBI)), out ret) != 0 || info.PebBaseAddress == IntPtr.Zero) return "";
      byte[] pointer = new byte[8]; IntPtr got;
      if (!ReadProcessMemory(h, info.PebBaseAddress + 0x20, pointer, 8, out got)) return "";
      long parameters = BitConverter.ToInt64(pointer, 0);
      if (parameters == 0) return "";
      byte[] text = new byte[16];
      if (!ReadProcessMemory(h, new IntPtr(parameters + 0x38), text, 16, out got)) return "";
      int length = BitConverter.ToUInt16(text, 0);
      long buffer = BitConverter.ToInt64(text, 8);
      if (length <= 0 || length > 2048 || buffer == 0) return "";
      byte[] chars = new byte[length];
      if (!ReadProcessMemory(h, new IntPtr(buffer), chars, length, out got)) return "";
      return Encoding.Unicode.GetString(chars).TrimEnd('\\\\');
    } catch { return ""; }
    finally { CloseHandle(h); }
  }
}
"@
Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine,@{Name='CurrentDirectory';Expression={ try { [BranchProcCwd]::Directory([int]$_.ProcessId) } catch { '' } }} | ConvertTo-Json -Compress
`;
}

async function listWindowsProcesses(): Promise<ListedProcess[]> {
  const { stdout } = await runFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(windowsProcessScript(), "utf16le").toString("base64")], {
    windowsHide: true, timeout: 8_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8",
  });
  return parseWindowsProcessList(stdout);
}

async function listLinuxProcesses(): Promise<ListedProcess[]> {
  const result: ListedProcess[] = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const executable = await readlink(`/proc/${pid}/exe`).catch(() => "");
      const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => "");
      const command = (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).replaceAll("\0", " ").trim();
      result.push({ pid, executable: executable.replace(/ \(deleted\)$/, ""), command, cwd });
    } catch { /* the process left while it was being read */ }
  }
  return result;
}

async function listDarwinProcesses(): Promise<ListedProcess[]> {
  const { stdout } = await runFile("ps", ["-axo", "pid=,command="], { windowsHide: true, timeout: 5_000, encoding: "utf8" });
  const result: ListedProcess[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match?.[1] || !match[2]) continue;
    const command = match[2].trim();
    const executable = command.startsWith("/") ? (command.split(/\s+/)[0] ?? "") : "";
    result.push({ pid: Number(match[1]), executable, command, cwd: "" });
  }
  return result;
}

export async function listInstallProcesses(): Promise<ListedProcess[]> {
  try {
    if (process.platform === "win32") return await listWindowsProcesses();
    if (process.platform === "linux") return await listLinuxProcesses();
    if (process.platform === "darwin") return await listDarwinProcesses();
  } catch { /* a process list is a hint; the swap still tries */ }
  return [];
}

async function signalPid(pid: number, force: boolean): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
  if (process.platform === "win32") {
    const args = force ? ["/PID", String(pid), "/F"] : ["/PID", String(pid)];
    await runFile("taskkill", args, { windowsHide: true, timeout: 8_000 });
    return;
  }
  process.kill(pid, force ? "SIGKILL" : "SIGTERM");
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

export function createHolderDeps(log: (line: string) => void, wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms))): PlaceDeps {
  return {
    list: listInstallProcesses,
    askExit: pid => signalPid(pid, false),
    forceStop: pid => signalPid(pid, true),
    alive: pidAlive,
    wait,
    move: (from, to) => rename(from, to),
    copyTree: (from, to) => cp(from, to, { recursive: true, verbatimSymlinks: true }),
    remove: path => rm(path, { recursive: true, force: true }),
    exists: async path => { try { await access(path); return true; } catch { return false; } },
    log,
  };
}

export async function writeBesideMarker(dataDir: string, exe: string, blockers: string[]): Promise<void> {
  await writeFile(join(dataDir, BESIDE_MARKER), JSON.stringify({ exe, blockers }));
}

/** The executable to open when this process is still the copy that could not be replaced. */
export async function readBesideLaunch(dataDir: string, currentExe: string): Promise<string | undefined> {
  const file = join(dataDir, BESIDE_MARKER);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as { exe?: unknown };
    if (typeof parsed.exe !== "string" || !parsed.exe) return undefined;
    if (pathInsideInstall(parsed.exe, currentExe) && pathInsideInstall(currentExe, parsed.exe)) return undefined;
    await access(parsed.exe, constants.F_OK);
    return parsed.exe;
  } catch {
    return undefined;
  }
}
