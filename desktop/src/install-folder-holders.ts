// Frees the packaged app folder before the shell swap. A process is a holder only when its executable
// (the Windows image path) lives inside this install. The process name is never enough, and nothing
// outside the folder is signaled. The helper copies this file beside itself; both use only Node built-ins.
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, cp, readdir, readFile, readlink, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

export const BESIDE_MARKER = "desktop-update-beside.json";
export const HOLDER_GRACE_MS = 1_500;
export const HOLDER_FORCE_WAIT_MS = 400;
const SWAP_ATTEMPTS = 8;
const SWAP_RETRY_MS = 250;
const LOCK_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
export interface ListedProcess {
  pid: number;
  executable: string;
  command: string;
  cwd: string;
  files: string[];
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
  const command = info.command.trim();
  return `pid ${info.pid}${command ? ` ${command}` : ""}${info.executable ? ` executable ${info.executable}` : ""}`;
}

/** A holder is a process whose executable (Windows image path) lives inside this install. The process name is not used. */
export function holdersInInstall(installDir: string, processes: readonly ListedProcess[], exclude: ReadonlySet<number>): ListedProcess[] {
  return processes.filter(info => {
    if (!Number.isInteger(info.pid) || info.pid <= 0 || exclude.has(info.pid)) return false;
    return pathInsideInstall(installDir, info.executable);
  });
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

async function tryInPlace(request: PlaceRequest, attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await request.deps.move(request.target, request.previous);
      try {
        await request.deps.move(request.staged, request.target);
        return true;
      } catch (error) {
        try { await request.deps.move(request.previous, request.target); } catch { /* the old copy stays where the failed swap left it */ }
        if (!isLockError(error)) throw error;
      }
    } catch (error) {
      if (!isLockError(error)) throw error;
    }
    if (attempt + 1 < attempts) await request.deps.wait(SWAP_RETRY_MS);
  }
  return false;
}

/**
 * Asks Branch processes inside the install to leave, force-stops the ones that stay, then renames the
 * staged shell into place. A folder that is still locked is left alone and the staged shell is installed
 * beside it. A non-lock failure is rethrown so the caller can keep the update staged.
 */
export async function placeAppShell(request: PlaceRequest): Promise<PlaceResult> {
  const exclude = new Set(request.excludePids);
  let listed: ListedProcess[] = [];
  try { listed = await request.deps.list(); }
  catch (error) { request.deps.log(`desktop update: could not list processes in the install folder (${String(error)})`); }
  const holders = holdersInInstall(request.installDir, listed, exclude);
  for (const holder of holders) {
    request.deps.log(`desktop update: asking ${describeHolder(holder)} to exit so the install folder can be replaced`);
    try { await request.deps.askExit(holder.pid); } catch { /* already gone */ }
  }
  if (holders.length) await request.deps.wait(HOLDER_GRACE_MS);
  const lingering = holders.filter(holder => request.deps.alive(holder.pid));
  for (const holder of lingering) {
    request.deps.log(`desktop update: stopping ${describeHolder(holder)} after it stayed in the install folder`);
    try { await request.deps.forceStop(holder.pid); } catch { /* already gone */ }
  }
  if (lingering.length) await request.deps.wait(HOLDER_FORCE_WAIT_MS);
  const blockers = holders.filter(holder => request.deps.alive(holder.pid)).map(describeHolder);
  const attempts = request.attempts ?? SWAP_ATTEMPTS;
  if (await tryInPlace(request, attempts)) return { result: "swapped", relaunch: request.relaunchCommand, blockers };

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
    const item = row as { ProcessId?: unknown; ExecutablePath?: unknown; CommandLine?: unknown };
    const pid = typeof item.ProcessId === "number" ? item.ProcessId : Number(item.ProcessId);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    result.push({
      pid,
      executable: typeof item.ExecutablePath === "string" ? item.ExecutablePath : "",
      command: typeof item.CommandLine === "string" ? item.CommandLine : "",
      cwd: "",
      files: [],
    });
  }
  return result;
}

async function listWindowsProcesses(): Promise<ListedProcess[]> {
  const script = "Get-CimInstance Win32_Process | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";
  const { stdout } = await runFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
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
      result.push({ pid, executable: executable.replace(/ \(deleted\)$/, ""), command, cwd, files: [] });
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
    result.push({ pid: Number(match[1]), executable, command, cwd: "", files: [] });
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
