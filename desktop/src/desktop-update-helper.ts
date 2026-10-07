// Runs by itself under plain Node (copied out of app.asar): only Node built-ins, no other desktop modules.
// Waits for the desktop app to exit, swaps the staged copy in, relaunches it and waits for the new app to confirm
// its start (it removes the journal). No confirmation in time: stop the new app by its PID, put the previous copy
// back, remember the release as rejected and relaunch the previous app.
// A whole-folder (runtime) swap first asks Windows Restart Manager who holds the install folder (including
// session 0). It stops only bundled node.exe lockers this user can stop, plus their children. Node from
// outside the folder, and this helper, are left alone. A locker we cannot stop leaves the update staged.
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export interface HelperPlan {
  journal: string;
  versionFile: string;
  rejectedFile: string;
  log: string;
  /** The desktop app that handed off; nothing is touched until it has exited. */
  waitPid: number;
  relaunch: { command: string; fallback?: string; args: string[] };
  confirmTimeoutMs: number;
}
export interface FolderProcess {
  pid: number;
  name: string;
  executable: string;
  args: string[];
  /** Windows terminal-services session; 0 is the service/background session. */
  sessionId?: number;
}
export type FolderLocker = FolderProcess;
/** Tests inject these; production uses the real rename, sleep and process tools. */
export interface HelperIo {
  rename?: (source: string, target: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  listFolderProcesses?: (folder: string) => Promise<FolderProcess[]>;
  listLockers?: (folder: string) => Promise<FolderLocker[]>;
  stopProcess?: (pid: number) => void;
  spawnRestart?: (executable: string, args: string[]) => { pid?: number; unref(): void };
  /** Override of BUSY_RETRY_ATTEMPTS; production keeps the existing 120-attempt budget. */
  busyAttempts?: number;
}
/** A locker of the install-folder node.exe that this user cannot stop (session 0, access denied). */
export class UnstoppableLockersError extends Error {
  readonly lockers: FolderLocker[];
  readonly folder: string;
  constructor(lockers: FolderLocker[], folder: string) {
    super("install-folder node.exe is still held");
    this.name = "UnstoppableLockersError";
    this.lockers = lockers;
    this.folder = folder;
  }
}
interface Journal { version: string; sha256: string; kind: "asar" | "runtime"; staged: string; target: string; phase: string; heldUntil?: number }
/** After a swap that found the app in use, starts leave the update staged this long (Restart retries at once). */
const RETRY_AFTER_MS = 60 * 60 * 1000;
/** Same bound as the original helper: 120 retries at 250ms (about 30s), then fail and leave the old copy. */
export const BUSY_RETRY_ATTEMPTS = 120;
export const BUSY_RETRY_DELAY_MS = 250;
const BUSY_CODES = ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"];

const defaultSleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
function readJournal(file: string): Journal | undefined {
  try { return JSON.parse(readFileSync(file, "utf8")) as Journal; } catch { return undefined; }
}
async function writeJournal(file: string, journal: Journal): Promise<void> {
  await writeFile(`${file}.helper.tmp`, JSON.stringify(journal));
  await rename(`${file}.helper.tmp`, file);
}

function underFolder(file: string, folder: string): boolean {
  const resolvedFile = resolve(file);
  const resolvedFolder = resolve(folder);
  if (process.platform === "win32") {
    const left = resolvedFile.toLowerCase();
    const right = resolvedFolder.toLowerCase();
    return left === right || left.startsWith(right.endsWith("\\") ? right : `${right}\\`);
  }
  return resolvedFile === resolvedFolder || resolvedFile.startsWith(resolvedFolder.endsWith("/") ? resolvedFolder : `${resolvedFolder}/`);
}

function tokenizeCommandLine(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote = "";
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
    } else if (ch === "\"" || ch === "'") quote = ch;
    else if (/\s/.test(ch)) {
      if (current) { args.push(current); current = ""; }
    } else current += ch;
  }
  if (current) args.push(current);
  return args;
}

function argsFromCommandLine(executable: string, commandLine: string | undefined): string[] {
  if (!commandLine) return [];
  const tokens = tokenizeCommandLine(commandLine.trim());
  if (!tokens.length) return [];
  const first = tokens[0] ?? "";
  if (first.toLowerCase() === executable.toLowerCase() || first.toLowerCase() === basename(executable).toLowerCase()) {
    return tokens.slice(1);
  }
  return tokens.slice(1);
}

/** Kind only — never a path, host, or account. */
export function processKind(proc: FolderProcess): string {
  const name = (proc.name || basename(proc.executable)).toLowerCase().replace(/\.exe$/i, "");
  const args = proc.args.map(arg => arg.toLowerCase());
  if (name.includes("chrome") || name.includes("chromium") || args.some(arg => arg.includes("playwright"))) return "chrome";
  if (args.some(arg => arg.includes("mcporter"))) return "mcporter";
  if (args.includes("mcp") && args.includes("serve")) return "mcp serve";
  if (args.includes("run") && (name === "node" || args.includes("node"))) return "node host";
  if (name === "node") return "node";
  return name || "process";
}

function describeProcess(proc: FolderProcess): string {
  return `${processKind(proc)} pid ${proc.pid}`;
}

/** Image path relative to the install folder, or the basename — never a user or machine prefix. */
export function lockerImageLabel(executable: string, folder: string): string {
  if (underFolder(executable, folder)) {
    const root = resolve(folder);
    const full = resolve(executable);
    const slice = process.platform === "win32"
      ? full.slice(root.length).replace(/^[\\/]/, "")
      : full.slice(root.length).replace(/^\//, "");
    return slice || basename(executable);
  }
  return basename(executable);
}

export function describeLocker(locker: FolderLocker, folder: string): string {
  const session = locker.sessionId === undefined ? "" : ` session ${locker.sessionId}`;
  return `${processKind(locker)} pid ${locker.pid} image ${lockerImageLabel(locker.executable, folder)}${session}`;
}

function describeHolders(holders: FolderProcess[], folder?: string): string {
  if (!holders.length) return "unknown process";
  return holders.map(proc => folder ? describeLocker(proc, folder) : describeProcess(proc)).join(", ");
}

function isAccessDenied(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code ?? "";
  if (code === "EACCES" || code === "EPERM") return true;
  return /access is denied/i.test(String(error));
}

/** True only when the process image is node/node.exe whose resolved path is under `folder`. */
export function isInstallFolderNode(proc: FolderProcess, folder: string): boolean {
  const base = basename(proc.executable).toLowerCase();
  if (base !== "node" && base !== "node.exe") return false;
  return underFolder(proc.executable, folder);
}

function listDescendants(pid: number): number[] {
  const found: number[] = [];
  const seen = new Set<number>([pid, process.pid]);
  const walk = (parent: number): void => {
    let kids: number[] = [];
    try {
      if (process.platform === "linux") {
        try {
          const text = readFileSync(`/proc/${parent}/task/${parent}/children`, "utf8").trim();
          kids = text ? text.split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
        } catch {
          for (const entry of readdirSync("/proc")) {
            if (!/^\d+$/.test(entry)) continue;
            const child = Number(entry);
            try {
              const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
              const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
              if (Number(fields[1]) === parent) kids.push(child);
            } catch { /* process exited */ }
          }
        }
      } else if (process.platform === "darwin") {
        const output = execFileSync("pgrep", ["-P", String(parent)], { encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: ["ignore", "pipe", "pipe"] }).trim();
        kids = output ? output.split(/\s+/).map(Number).filter(n => Number.isInteger(n) && n > 0) : [];
      }
      // Windows: taskkill /T walks the tree. A CIM parent-id walk here hung the desktop job.
    } catch { /* no children, or the parent is already gone */ }
    for (const kid of kids) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      found.push(kid);
      walk(kid);
    }
  };
  walk(pid);
  return found;
}

function isAppImage(proc: FolderProcess, plan: HelperPlan): boolean {
  const name = basename(proc.executable).toLowerCase();
  if (name === "branch agent.exe" || name === "branch agent") return true;
  try { return resolve(proc.executable).toLowerCase() === resolve(plan.relaunch.command).toLowerCase(); }
  catch { return false; }
}

export async function listFolderProcesses(folder: string): Promise<FolderProcess[]> {
  const root = resolve(folder);
  const found: FolderProcess[] = [];
  if (process.platform === "linux") {
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pid === process.pid) continue;
      try {
        const executable = readlinkSync(`/proc/${pid}/exe`);
        if (!underFolder(executable, root)) continue;
        const parts = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
        found.push({ pid, name: basename(executable), executable, args: parts.slice(1) });
      } catch { /* process exited or the exe link is unreadable */ }
    }
    return found;
  }
  if (process.platform === "win32") {
    // Get-Process by Path (same idea as engine-records' per-PID CIM probe). A full
    // Win32_Process scan is too slow on Windows CI and missed the node host entirely.
    const quoted = root.replaceAll("'", "''");
    const script = `$root='${quoted}'; $matches=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $PID -and $(try { $_.Path -and $_.Path.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } catch { $false }) }); if(-not $matches){ '' } else { $matches | ForEach-Object { $p=Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue; [pscustomobject]@{pid=$_.Id;name=$_.ProcessName;executable=$_.Path;commandLine=$p.CommandLine;session=$_.SessionId} } | ConvertTo-Json -Compress }`;
    try {
      const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
        encoding: "utf8", windowsHide: true, timeout: 15_000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
      }).replace(/^\uFEFF/, "").trim();
      if (!output) return [];
      const rows = JSON.parse(output) as unknown;
      for (const row of (Array.isArray(rows) ? rows : [rows]) as Array<{ pid?: number; name?: string; executable?: string; commandLine?: string; session?: number }>) {
        if (!Number.isInteger(row.pid) || row.pid === process.pid || !row.executable) continue;
        found.push({
          pid: row.pid!, name: row.name || basename(row.executable), executable: row.executable,
          args: argsFromCommandLine(row.executable, row.commandLine),
          sessionId: Number.isInteger(row.session) ? row.session : undefined,
        });
      }
    } catch { /* listing is best effort: the rename still retries */ }
    return found;
  }
  try {
    const output = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    for (const line of output.split("\n")) {
      const match = /^\s*(\d+)\s+(.*)$/.exec(line);
      if (!match) continue;
      const pid = Number(match[1]);
      if (pid === process.pid) continue;
      const tokens = tokenizeCommandLine(match[2] ?? "");
      const executable = tokens[0] ?? "";
      if (!executable || !underFolder(executable, root)) continue;
      found.push({ pid, name: basename(executable), executable, args: tokens.slice(1) });
    }
  } catch { /* listing is best effort */ }
  return found;
}

/** Every process Restart Manager reports as locking `folder`, including other sessions (session 0). */
export function listRestartManagerLockers(folder: string): FolderLocker[] {
  if (process.platform !== "win32") return [];
  const root = resolve(folder);
  const node = join(root, "resources", "node", "node.exe");
  const files = [node, join(root, "Branch Agent.exe")].filter(file => existsSync(file));
  if (!files.length) return [];
  const fileList = files.map(file => `'${file.replaceAll("'", "''")}'`).join(",");
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class BranchRm {
  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS { public int dwProcessId; public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string strServiceShortName;
    public uint ApplicationType; public uint AppStatus; public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)] public bool bRestartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
  public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, StringBuilder strSessionKey);
  [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint pSessionHandle);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)]
  public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, System.IntPtr rgApplications, uint nServices, string[] rgsServiceNames);
  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
}
'@
$session = [uint32]0
$key = New-Object System.Text.StringBuilder 32
if ([BranchRm]::RmStartSession([ref]$session, 0, $key) -ne 0) { '' ; return }
try {
  $files = @(${fileList})
  [void][BranchRm]::RmRegisterResources($session, [uint32]$files.Count, $files, 0, [IntPtr]::Zero, 0, $null)
  $needed = [uint32]0; $count = [uint32]0; $reason = [uint32]0
  [void][BranchRm]::RmGetList($session, [ref]$needed, [ref]$count, $null, [ref]$reason)
  if ($needed -eq 0) { '' ; return }
  $count = $needed
  $infos = New-Object BranchRm+RM_PROCESS_INFO[] $needed
  [void][BranchRm]::RmGetList($session, [ref]$needed, [ref]$count, $infos, [ref]$reason)
  $node = '${node.replaceAll("'", "''")}'
  $infos | ForEach-Object {
    $id = $_.Process.dwProcessId
    if ($id -eq $PID) { return }
    $path = $(try { (Get-Process -Id $id -ErrorAction SilentlyContinue).Path } catch { $null })
    [pscustomobject]@{pid=$id;name=$_.strAppName;executable=$(if($path){$path}else{$node});session=$_.TSSessionId}
  } | ConvertTo-Json -Compress
} finally { [void][BranchRm]::RmEndSession($session) }
`;
  try {
    const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64")], {
      encoding: "utf8", windowsHide: true, timeout: 15_000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024,
    }).replace(/^\uFEFF/, "").trim();
    if (!output) return [];
    const rows = JSON.parse(output) as unknown;
    const found: FolderLocker[] = [];
    for (const row of (Array.isArray(rows) ? rows : [rows]) as Array<{ pid?: number; name?: string; executable?: string; session?: number }>) {
      if (!Number.isInteger(row.pid) || row.pid === process.pid || !row.executable) continue;
      found.push({
        pid: row.pid!, name: row.name || basename(row.executable), executable: row.executable,
        args: [], sessionId: Number.isInteger(row.session) ? row.session : undefined,
      });
    }
    return found;
  } catch { return []; }
}

export async function listFolderLockers(folder: string): Promise<FolderLocker[]> {
  const listed = await listFolderProcesses(folder);
  if (process.platform !== "win32") return listed;
  const byPid = new Map<number, FolderLocker>();
  for (const proc of listed) byPid.set(proc.pid, proc);
  for (const locker of listRestartManagerLockers(folder)) {
    const existing = byPid.get(locker.pid);
    byPid.set(locker.pid, existing
      ? { ...existing, sessionId: locker.sessionId ?? existing.sessionId }
      : locker);
  }
  return [...byPid.values()];
}

function stopPid(pid: number): void {
  if (pid === process.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 });
    else process.kill(pid, "SIGTERM");
  } catch (error) {
    if (isAccessDenied(error)) throw Object.assign(error instanceof Error ? error : new Error(String(error)), { code: "EACCES" });
    /* already gone */
  }
}

/** Stops install-folder node.exe lockers and their children. Throws if a locker cannot be stopped. */
export async function stopFolderProcesses(folder: string, log: (line: string) => void, io: HelperIo = {}, keepPids: Iterable<number> = []): Promise<FolderProcess[]> {
  const keep = new Set<number>([process.pid, ...keepPids]);
  const listed = await (io.listLockers ?? io.listFolderProcesses ?? listFolderLockers)(folder);
  const victims = listed.filter(proc => !keep.has(proc.pid) && isInstallFolderNode(proc, folder));
  const stop = io.stopProcess ?? stopPid;
  const sleep = io.sleep ?? defaultSleep;
  const restartable: FolderProcess[] = [];
  const blocked: FolderLocker[] = [];
  const trees: number[] = [];
  for (const proc of victims) {
    const children = io.stopProcess ? [] : listDescendants(proc.pid).filter(pid => !keep.has(pid) && pid !== process.pid);
    const extra = children.length || process.platform === "win32" ? " and child processes" : "";
    log(`desktop update: stopping ${describeLocker(proc, folder)}${extra} so the install folder can be swapped`);
    try {
      stop(proc.pid);
      if (process.platform !== "win32") for (const kid of children) stop(kid);
      trees.push(proc.pid, ...children);
      if (processKind(proc) === "node host") restartable.push(proc);
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
      blocked.push(proc);
    }
  }
  if (!io.stopProcess) {
    for (const end = Date.now() + 5_000; Date.now() < end; await sleep(100)) {
      if (trees.every(pid => !alive(pid))) break;
    }
    for (const pid of trees) {
      if (!alive(pid) || keep.has(pid) || pid === process.pid) continue;
      try {
        if (process.platform === "win32") stop(pid);
        else process.kill(pid, "SIGKILL");
      } catch (error) {
        if (isAccessDenied(error)) {
          const proc = victims.find(victim => victim.pid === pid);
          if (proc && !blocked.includes(proc)) blocked.push(proc);
        }
      }
    }
    for (const proc of victims) {
      if (blocked.includes(proc) || keep.has(proc.pid) || proc.pid === process.pid) continue;
      if (alive(proc.pid)) blocked.push(proc);
    }
  }
  if (blocked.length) throw new UnstoppableLockersError(blocked, folder);
  return restartable;
}

export function restartFolderProcesses(stopped: FolderProcess[], log: (line: string) => void, io: HelperIo = {}): void {
  const spawnRestart = io.spawnRestart ?? ((executable: string, args: string[]) => {
    const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return child;
  });
  for (const proc of stopped) {
    if (!existsSync(proc.executable)) {
      log(`desktop update: not restarting ${proc.name}; ${basename(proc.executable)} is gone after the swap`);
      continue;
    }
    try {
      const child = spawnRestart(proc.executable, proc.args);
      log(`desktop update: restarted ${proc.name}${child.pid !== undefined ? ` as pid ${child.pid}` : ""} from the new install folder`);
    } catch (error) {
      log(`desktop update: could not restart ${proc.name}: ${String(error)}`);
    }
  }
}

/** Files can stay locked for a moment after a process exits (Windows); retry, then give up without changes. */
export async function move(source: string, target: string, io: HelperIo = {}, log?: (line: string) => void): Promise<void> {
  const attempts = io.busyAttempts ?? BUSY_RETRY_ATTEMPTS;
  const doRename = io.rename ?? rename;
  const sleep = io.sleep ?? defaultSleep;
  const list = io.listLockers ?? io.listFolderProcesses ?? listFolderLockers;
  for (let attempt = 0;; attempt++) {
    try { await doRename(source, target); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!BUSY_CODES.includes(code) || attempt >= attempts) throw error;
      if (log && (attempt === 0 || attempt % 20 === 0)) {
        const folder = existsSync(source) ? source : target;
        let holders = "unknown process";
        try { holders = describeHolders(await list(folder), folder); } catch { /* listing is best effort */ }
        log(`desktop update: ${code} renaming (attempt ${attempt + 1}/${attempts + 1}); held by ${holders}`);
      }
      await sleep(BUSY_RETRY_DELAY_MS);
    }
  }
}

function launch(plan: HelperPlan): number | undefined {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // This relaunches the Branch GUI, whose first ShowWindow must remain visible.
  const command = existsSync(plan.relaunch.command) ? plan.relaunch.command : plan.relaunch.fallback ?? plan.relaunch.command;
  const child = spawn(command, plan.relaunch.args, { detached: true, stdio: "ignore", windowsHide: false, env });
  child.unref();
  return child.pid;
}

/** Windows caches executable icons by shortcut. Re-save only links that already target this app. */
function refreshWindowsIcon(plan: HelperPlan, log: (line: string) => void): void {
  if (process.platform !== "win32" || process.env.BRANCH_DESKTOP_TEST_DIST) return;
  const exe = plan.relaunch.command;
  const quoted = exe.replaceAll("'", "''");
  const script = `$exe='${quoted}'; $shell=New-Object -ComObject WScript.Shell; foreach($dir in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'))) { if(!$dir) { continue }; $path=Join-Path $dir 'Branch Agent.lnk'; if(!(Test-Path -LiteralPath $path)) { continue }; $link=$shell.CreateShortcut($path); if($link.TargetPath -ieq $exe) { $link.IconLocation="$exe,0"; $link.Save() } }`;
  const errors: string[] = [];
  try { execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: "ignore", timeout: 15_000 }); }
  catch (error) { errors.push(`shortcuts: ${String(error)}`); }
  try { execFileSync("ie4uinit.exe", ["-show"], { windowsHide: true, stdio: "ignore", timeout: 15_000 }); }
  catch (error) { errors.push(`cache: ${String(error)}`); }
  if (errors.length) log(`desktop icon refresh failed (${errors.join("; ")})`);
}

/** Stops the relaunched app and its own child processes, by its PID only. */
async function stop(pid: number, io: HelperIo = {}): Promise<void> {
  const sleep = io.sleep ?? defaultSleep;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(pid, "SIGTERM");
  } catch { /* already gone */ }
  for (let i = 0; i < 80 && alive(pid); i++) await sleep(250);
}

/** Staged app folders carry their .asar files as .asar.staged (see desktop-update.ts); restore the real names. */
async function restoreAsarNames(folder: string): Promise<void> {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await restoreAsarNames(path);
    else if (entry.name.endsWith(".asar.staged")) await rename(path, path.slice(0, -".staged".length));
  }
}

async function busyHolders(folder: string, io: HelperIo): Promise<string> {
  try { return describeHolders(await (io.listLockers ?? io.listFolderProcesses ?? listFolderLockers)(folder), folder); }
  catch { return "unknown process"; }
}

function keepStaged(plan: HelperPlan, journal: Journal, log: (line: string) => void, detail: string): Promise<void> {
  return writeJournal(plan.journal, { ...journal, phase: "staged", heldUntil: Date.now() + RETRY_AFTER_MS }).then(() => {
    log(`desktop update ${journal.version}: the app is still in use (${detail}); kept staged for the next scheduled check`);
  });
}

/** Old copy aside, new copy in. On failure the old copy is put back and the update stays staged. */
async function swap(plan: HelperPlan, journal: Journal, previous: string, log: (line: string) => void, io: HelperIo): Promise<boolean> {
  await rm(previous, { recursive: true, force: true });
  if (journal.kind === "runtime") await restoreAsarNames(journal.staged);
  let stopped: FolderProcess[] = [];
  if (journal.kind === "runtime") {
    try {
      stopped = await stopFolderProcesses(journal.target, log, io, [plan.waitPid]);
    } catch (error) {
      if (!(error instanceof UnstoppableLockersError)) throw error;
      const detail = error.lockers.map(locker => describeLocker(locker, journal.target)).join("; ");
      await keepStaged(plan, journal, log, `could not stop locker(s): ${detail}`);
      return false;
    }
  }
  const restart = (): void => restartFolderProcesses(stopped.filter(proc => !isAppImage(proc, plan)), log, io);
  await writeJournal(plan.journal, { ...journal, phase: "applying" });
  try { await move(journal.target, previous, io, log); } catch (error) {
    restart();
    await writeJournal(plan.journal, { ...journal, phase: "staged", heldUntil: Date.now() + RETRY_AFTER_MS });
    log(`desktop update ${journal.version}: the app is still in use (${String(error)}; held by ${await busyHolders(journal.target, io)}); kept staged for the next scheduled check`);
    return false;
  }
  try { await move(journal.staged, journal.target, io, log); } catch (error) {
    await move(previous, journal.target, io, log);
    restart();
    await writeJournal(plan.journal, { ...journal, phase: "staged", heldUntil: Date.now() + RETRY_AFTER_MS });
    log(`desktop update ${journal.version}: could not place the new copy (${String(error)}; held by ${await busyHolders(journal.target, io)}); kept staged`);
    return false;
  }
  restart();
  const { heldUntil: _retry, ...applied } = journal;
  await writeJournal(plan.journal, { ...applied, phase: "applied" });
  return true;
}

async function rollback(plan: HelperPlan, journal: Journal, previous: string, pid: number | undefined, io: HelperIo): Promise<void> {
  if (pid !== undefined) await stop(pid, io);
  await move(journal.target, `${journal.staged}-failed`, io);
  await move(previous, journal.target, io);
  await writeFile(plan.rejectedFile, JSON.stringify({ version: journal.version, sha256: journal.sha256 }));
  await rm(plan.journal, { force: true });
}

export async function runHelper(plan: HelperPlan, io: HelperIo = {}): Promise<"applied" | "kept" | "rolled-back" | "none"> {
  const sleep = io.sleep ?? defaultSleep;
  const log = (line: string): void => { try { appendFileSync(plan.log, `${new Date().toISOString()} ${line}\n`); } catch { /* never stops the swap */ } };
  for (let i = 0; i < 240 && alive(plan.waitPid); i++) await sleep(250);
  const journal = readJournal(plan.journal);
  if (journal?.phase !== "staged" || alive(plan.waitPid)) {
    log("desktop update helper: nothing staged or the app is still running; relaunching unchanged");
    launch(plan);
    return "none";
  }
  const previous = `${journal.target}.previous`;
  if (!await swap(plan, journal, previous, log, io)) { launch(plan); return "kept"; }
  log(`desktop update ${journal.version}: ${journal.kind} swapped in; relaunching`);
  const pid = launch(plan);
  for (const end = Date.now() + plan.confirmTimeoutMs; Date.now() < end; await sleep(250)) {
    if (!existsSync(plan.journal)) {
      if (journal.kind === "runtime") refreshWindowsIcon(plan, log);
      log(`desktop update ${journal.version}: confirmed by the new app`); return "applied";
    }
  }
  log(`desktop update ${journal.version}: the new app did not confirm its start; restoring the previous copy`);
  await rollback(plan, journal, previous, pid, io);
  launch(plan);
  return "rolled-back";
}

if (require.main === module && process.argv[2]) {
  const plan = JSON.parse(readFileSync(process.argv[2], "utf8")) as HelperPlan;
  void runHelper(plan).catch(error => {
    try { appendFileSync(plan.log, `${new Date().toISOString()} desktop update helper failed: ${String(error)}\n`); } catch { /* ignore */ }
    process.exitCode = 1;
  });
}
