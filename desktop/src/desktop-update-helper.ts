// Runs by itself under plain Node (copied out of app.asar): only Node built-ins, no other desktop modules.
// Waits for the desktop app to exit, swaps the staged copy in, relaunches it and waits for the new app to confirm
// its start (it removes the journal). No confirmation in time: stop the new app by its PID, put the previous copy
// back, remember the release as rejected and relaunch the previous app.
// A whole-folder (runtime) swap first stops processes still running from the install folder — the device-link
// node host keeps the bundled node.exe open after the app quits, and Windows then fails the rename with EBUSY.
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
}
/** Tests inject these; production uses the real rename, sleep and process tools. */
export interface HelperIo {
  rename?: (source: string, target: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  listFolderProcesses?: (folder: string) => Promise<FolderProcess[]>;
  stopProcess?: (pid: number) => void;
  spawnRestart?: (executable: string, args: string[]) => { pid?: number; unref(): void };
  /** Override of BUSY_RETRY_ATTEMPTS; production keeps the existing 120-attempt budget. */
  busyAttempts?: number;
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

function describeProcess(proc: FolderProcess): string {
  const node = /^(node|node\.exe)$/i.test(proc.name);
  const host = node && proc.args.includes("run") ? " (node host)" : node ? " (node)" : "";
  return `${proc.name} pid ${proc.pid}${host}`;
}

function describeHolders(holders: FolderProcess[]): string {
  return holders.length ? holders.map(describeProcess).join(", ") : "unknown process";
}

function isNodeChild(proc: FolderProcess): boolean {
  const name = basename(proc.executable).toLowerCase();
  return name === "node" || name === "node.exe" || proc.args.some(arg => arg.endsWith("branch.mjs"));
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
    const script = `$root=[System.IO.Path]::GetFullPath(${JSON.stringify(root)}); Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;name=$_.Name;executable=$_.ExecutablePath;commandLine=$_.CommandLine} } | ConvertTo-Json -Compress`;
    try {
      const output = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64")], { encoding: "utf8", windowsHide: true, timeout: 20_000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 }).trim();
      if (!output) return [];
      const rows = JSON.parse(output) as unknown;
      for (const row of (Array.isArray(rows) ? rows : [rows]) as Array<{ pid?: number; name?: string; executable?: string; commandLine?: string }>) {
        if (!Number.isInteger(row.pid) || row.pid === process.pid || !row.executable) continue;
        found.push({
          pid: row.pid!, name: row.name || basename(row.executable), executable: row.executable,
          args: argsFromCommandLine(row.executable, row.commandLine),
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

function stopPid(pid: number): void {
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 10_000 });
    else process.kill(pid, "SIGTERM");
  } catch { /* already gone */ }
}

/** Stops processes whose executable lives in `folder`. Returns the ones that should be restarted after the swap. */
export async function stopFolderProcesses(folder: string, log: (line: string) => void, io: HelperIo = {}, keepPids: Iterable<number> = []): Promise<FolderProcess[]> {
  const keep = new Set<number>([process.pid, ...keepPids]);
  const listed = await (io.listFolderProcesses ?? listFolderProcesses)(folder);
  const victims = listed.filter(proc => !keep.has(proc.pid));
  const stop = io.stopProcess ?? stopPid;
  const sleep = io.sleep ?? defaultSleep;
  const restartable: FolderProcess[] = [];
  for (const proc of victims) {
    log(`desktop update: stopping ${describeProcess(proc)} so the install folder can be swapped`);
    stop(proc.pid);
    if (isNodeChild(proc)) restartable.push(proc);
  }
  for (const end = Date.now() + 5_000; Date.now() < end; await sleep(100)) {
    if (victims.every(proc => !alive(proc.pid))) break;
  }
  for (const proc of victims) {
    if (!alive(proc.pid)) continue;
    try {
      if (process.platform === "win32") (io.stopProcess ?? stopPid)(proc.pid);
      else process.kill(proc.pid, "SIGKILL");
    } catch { /* already gone */ }
  }
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
  const list = io.listFolderProcesses ?? listFolderProcesses;
  for (let attempt = 0;; attempt++) {
    try { await doRename(source, target); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!BUSY_CODES.includes(code) || attempt >= attempts) throw error;
      if (log && (attempt === 0 || attempt % 20 === 0)) {
        const folder = existsSync(source) ? source : target;
        let holders = "unknown process";
        try { holders = describeHolders(await list(folder)); } catch { /* listing is best effort */ }
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
  try { return describeHolders(await (io.listFolderProcesses ?? listFolderProcesses)(folder)); }
  catch { return "unknown process"; }
}

/** Old copy aside, new copy in. On failure the old copy is put back and the update stays staged. */
async function swap(plan: HelperPlan, journal: Journal, previous: string, log: (line: string) => void, io: HelperIo): Promise<boolean> {
  await rm(previous, { recursive: true, force: true });
  if (journal.kind === "runtime") await restoreAsarNames(journal.staged);
  const stopped = journal.kind === "runtime"
    ? await stopFolderProcesses(journal.target, log, io, [plan.waitPid])
    : [];
  const restart = (): void => restartFolderProcesses(stopped.filter(proc => !isAppImage(proc, plan)), log, io);
  await writeJournal(plan.journal, { ...journal, phase: "applying" });
  try { await move(journal.target, previous, io, log); } catch (error) {
    restart();
    await writeJournal(plan.journal, { ...journal, phase: "staged", heldUntil: Date.now() + RETRY_AFTER_MS });
    log(`desktop update ${journal.version}: the app is still in use (${String(error)}; held by ${await busyHolders(journal.target, io)}); kept staged for the next start`);
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
