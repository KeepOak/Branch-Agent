// Runs by itself under plain Node (copied out of app.asar): only Node built-ins, no other desktop modules. The
// exceptions are windows-launcher.mjs (Windows layout) and install-folder-holders.js (in-place swap), which the
// app copies beside it.
// Waits for the desktop app to exit, swaps the staged copy in (or, on Windows, lands it in a fresh version folder
// and switches current.txt), relaunches it and waits for the new app to confirm its start (it removes the journal).
// No confirmation in time: stop the new app by its PID, put the previous copy back, remember the release as rejected
// and relaunch the previous app. Windows never renames or deletes a folder that is still in use.
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { cp, lstat, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

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
interface Journal {
  version: string;
  sha256: string;
  kind: "asar" | "runtime" | "appimage";
  staged: string;
  target: string;
  phase: string;
  heldUntil?: number;
  /** Windows side-by-side: user-writable root that holds version folders and current.txt. */
  installRoot?: string;
  /** Folder name under installRoot for this update. A single relative segment, never a path. */
  versionFolder?: string;
  /** Previous version folder name, or empty when the live app is the legacy root itself. */
  previousFolder?: string;
}
/**
 * After a swap that found the app in use, the helper's immediate relaunch leaves the update staged this long so it
 * does not loop. A later launch applies it before loading (Restart retries at once).
 */
const RETRY_AFTER_MS = 30_000;
/** Pointer the launcher, shortcut and stub read; switched by an atomic rename. */
export const WINDOWS_POINTER = "current.txt";
/** Previous version folder name, so prune can keep one rollback copy. */
export const WINDOWS_PREVIOUS = "previous.txt";
const VERSION_FOLDER = /^app-[A-Za-z0-9._-]+$/;

export function sanitizeWindowsVersion(version: string): string {
  return version.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "build";
}

/** Fresh folder for one Windows build under the install root. sha256 (when given) disambiguates same-version rebuilds. */
export function windowsVersionFolderName(version: string, sha256?: string): string {
  const safe = sanitizeWindowsVersion(version);
  return sha256 ? `app-${safe}-${sha256.slice(0, 6).toLowerCase()}` : `app-${safe}`;
}

export function isWindowsVersionFolder(name: string): boolean {
  return VERSION_FOLDER.test(name);
}

/** Legacy installs live at the root; a versioned install lives in app-* under that root. */
export function windowsInstallRoot(appDir: string): string {
  return isWindowsVersionFolder(basename(appDir)) ? dirname(appDir) : appDir;
}

export function usesWindowsVersionedLayout(platform: NodeJS.Platform | undefined, appImage?: string): boolean {
  return (platform ?? process.platform) === "win32" && !appImage;
}

type WindowsLauncher = typeof import("./windows-launcher.mjs");
type InstallHolders = typeof import("./install-folder-holders");
/**
 * The shared launcher module, copied beside this helper by the app (dist/ beside it in tests). Loaded only for the
 * Windows layout, and never required: without it the swap still lands and the shortcuts keep their old target.
 */
async function loadWindowsLauncher(log: (line: string) => void): Promise<WindowsLauncher | undefined> {
  try { return await import("./windows-launcher.mjs"); } catch (error) {
    log(`windows launcher module unavailable (${String(error)}); the cmd stub and shortcuts are left as they are`);
    return undefined;
  }
}
/**
 * Copied beside this helper. Without it the in-place swap still tries; leftover processes in the folder may
 * keep the rename from landing until the next start.
 */
async function loadHolders(log: (line: string) => void): Promise<InstallHolders | undefined> {
  try { return await import("./install-folder-holders.js"); } catch (error) {
    log(`install-folder holders unavailable (${String(error)}); the swap still tries`);
    return undefined;
  }
}

function versioned(journal: Journal): boolean {
  return Boolean(journal.kind === "runtime" && journal.installRoot && journal.versionFolder && isWindowsVersionFolder(journal.versionFolder)
    && dirname(join(journal.installRoot, journal.versionFolder)) === journal.installRoot);
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
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

/** The file operations a swap uses; tests pass their own to stand in for another volume or a failed copy. */
export interface HelperFs {
  rename(source: string, target: string): Promise<void>;
  /** A recursive copy that keeps symlinks as they are (a macOS bundle's frameworks link inside themselves). */
  copy(source: string, target: string): Promise<void>;
  remove(path: string): Promise<void>;
}
export const nodeHelperFs: HelperFs = {
  rename: (source, target) => rename(source, target),
  copy: (source, target) => cp(source, target, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false }),
  remove: path => rm(path, { recursive: true, force: true }),
};

/** Files can stay locked for a moment after a process exits (Windows); retry, then give up without changes. */
async function move(source: string, target: string, attempts = 120, fs: HelperFs = nodeHelperFs): Promise<void> {
  for (let attempt = 0;; attempt++) {
    try { await fs.rename(source, target); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(code) || attempt >= attempts) throw error;
      await sleep(250);
    }
  }
}

function pointedWindowsExe(journal: Journal): string | undefined {
  if (!journal.installRoot) return undefined;
  const pointer = join(journal.installRoot, WINDOWS_POINTER);
  if (existsSync(pointer)) {
    const folder = readFileSync(pointer, "utf8").trim();
    const exe = isWindowsVersionFolder(folder) ? join(journal.installRoot, folder, "Branch Agent.exe") : undefined;
    if (exe && existsSync(exe)) return exe;
  }
  const legacy = join(journal.installRoot, "Branch Agent.exe");
  return existsSync(legacy) ? legacy : undefined;
}

function launch(plan: HelperPlan, journal?: Journal): number | undefined {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // This relaunches the Branch GUI, whose first ShowWindow must remain visible.
  const pointed = journal ? pointedWindowsExe(journal) : undefined;
  const requested = existsSync(plan.relaunch.command) ? plan.relaunch.command : plan.relaunch.fallback ?? plan.relaunch.command;
  // Tests pass a Node script as the relaunch command; only a Branch Agent.exe follows current.txt.
  const command = pointed && basename(requested) === "Branch Agent.exe" ? pointed : requested;
  const child = spawn(command, plan.relaunch.args, { detached: true, stdio: "ignore", windowsHide: false, env });
  child.unref();
  return child.pid;
}

/**
 * Windows caches executable icons by shortcut. Re-save only links that already target this app, pointing them at the
 * stable launcher at the install root when it is there (a version folder can be pruned; the launcher stays).
 */
function refreshWindowsIcon(plan: HelperPlan, log: (line: string) => void, journal?: Journal, launcher?: WindowsLauncher): void {
  if (process.platform !== "win32" || process.env.BRANCH_DESKTOP_TEST_DIST) return;
  const stable = launcher && journal?.installRoot ? join(journal.installRoot, launcher.WINDOWS_LAUNCHER_EXE) : undefined;
  const exe = (stable && existsSync(stable) ? stable : undefined) || (journal && pointedWindowsExe(journal)) || plan.relaunch.command;
  const quoted = exe.replaceAll("'", "''");
  const root = (journal?.installRoot ?? "").replaceAll("'", "''");
  const script = `$exe='${quoted}'; $root='${root}'; $shell=New-Object -ComObject WScript.Shell; foreach($dir in @([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Startup'),(Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar'))) { if(!$dir) { continue }; $path=Join-Path $dir 'Branch Agent.lnk'; if(!(Test-Path -LiteralPath $path)) { continue }; $link=$shell.CreateShortcut($path); $target=$link.TargetPath; $ours=$target -ieq $exe; if($root -and $target) { try { $ours=$ours -or ([IO.Path]::GetFullPath($target).StartsWith([IO.Path]::GetFullPath($root).TrimEnd('\\')+'\\',[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($target) -ieq 'Branch Agent.exe') } catch {} }; if($ours) { $link.TargetPath=$exe; $link.WorkingDirectory=$env:USERPROFILE; $link.IconLocation="$exe,0"; $link.Save() } }`;
  const errors: string[] = [];
  try { execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: "ignore", timeout: 15_000 }); }
  catch (error) { errors.push(`shortcuts: ${String(error)}`); }
  try { execFileSync("ie4uinit.exe", ["-show"], { windowsHide: true, stdio: "ignore", timeout: 15_000 }); }
  catch (error) { errors.push(`cache: ${String(error)}`); }
  if (errors.length) log(`desktop icon refresh failed (${errors.join("; ")})`);
}

/** Launch Services learns the swapped bundle. Tests skip this; a failure must not stop the relaunch. */
function registerLaunchedMacApp(target: string, log: (line: string) => void): void {
  if (process.platform !== "darwin" || process.env.BRANCH_DESKTOP_TEST_DIST || !target.endsWith(".app")) return;
  try {
    execFileSync("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", target], { windowsHide: true, stdio: "ignore" });
  } catch (error) {
    log(`Launch Services registration failed (${String(error)})`);
  }
}

/** Stops the relaunched app and its own child processes, by its PID only. */
async function stop(pid: number): Promise<void> {
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

/** A sibling of the target, on the target's own volume, that no other update run uses. */
const siblingPath = (target: string, label: string): string => join(dirname(target), `.${basename(target)}.${label}-${process.pid}`);

/**
 * Brings the staged copy beside the target, on the target's volume, so the final step is a rename within one
 * volume. A rename is tried first; when the staged copy lives on another volume (EXDEV: the data folder on an
 * external disk, the app in /Applications) it is copied into a sibling temp path instead. A failed copy leaves
 * nothing behind. The installed app is not touched here.
 */
export async function bringBesideTarget(staged: string, target: string, fs: HelperFs = nodeHelperFs): Promise<{ path: string; copied: boolean }> {
  const incoming = siblingPath(target, "incoming");
  await fs.remove(incoming);
  try { await fs.rename(staged, incoming); return { path: incoming, copied: false }; } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  try { await fs.copy(staged, incoming); } catch (error) {
    await fs.remove(incoming).catch(() => undefined);
    throw error;
  }
  return { path: incoming, copied: true };
}

/**
 * New copy onto the target's volume first, then old copy aside and new copy in, both renames within that volume.
 * The installed app stays in place until the new one is ready beside it. On failure the old copy is put back, any
 * temp copy is removed, and the update stays staged.
 */
async function swap(plan: HelperPlan, journal: Journal, previous: string, log: (line: string) => void, fs: HelperFs): Promise<boolean> {
  await fs.remove(previous);
  // A staged copy that has gone missing fails at the move below, which leaves the installed copy in place.
  if (journal.kind === "runtime" && existsSync(journal.staged)) await restoreAsarNames(journal.staged);
  await writeJournal(plan.journal, { ...journal, phase: "applying" });
  const keep = async (line: string): Promise<false> => {
    await writeJournal(plan.journal, { ...journal, phase: "staged", heldUntil: Date.now() + RETRY_AFTER_MS });
    log(`desktop update ${journal.version}: ${line}`);
    return false;
  };
  let incoming: { path: string; copied: boolean };
  try { incoming = await bringBesideTarget(journal.staged, journal.target, fs); } catch (error) {
    return keep(`could not bring the new copy beside the app (${String(error)}); kept staged`);
  }
  if (incoming.copied) log(`desktop update ${journal.version}: the update and the app are on different volumes; copied the new copy beside the app`);
  // Put the staged copy back where the record names it (a rename on its own volume), or drop the temp copy.
  const undoIncoming = async (): Promise<void> => {
    if (incoming.copied) await fs.remove(incoming.path).catch(() => undefined);
    else await fs.rename(incoming.path, journal.staged).catch(() => undefined);
  };
  if (journal.kind === "asar" || journal.kind === "runtime") {
    const holders = await loadHolders(log);
    if (holders) {
      await holders.releaseInstallFolderHolders(
        holders.installDirFor(journal.kind, journal.target),
        [process.pid, plan.waitPid],
        holders.createHolderDeps(log),
      );
    }
  }
  try { await move(journal.target, previous, 120, fs); } catch (error) {
    await undoIncoming();
    return keep(`the app is still in use (${String(error)}); kept staged for the next start`);
  }
  try { await move(incoming.path, journal.target, 120, fs); } catch (error) {
    await move(previous, journal.target, 120, fs);
    await undoIncoming();
    return keep(`could not place the new copy (${String(error)}); kept staged`);
  }
  // The copy is in place; the staged original on the other volume is no longer needed.
  if (incoming.copied) await fs.remove(journal.staged).catch(() => undefined);
  const { heldUntil: _retry, ...applied } = journal;
  await writeJournal(plan.journal, { ...applied, phase: "applied" });
  return true;
}

async function writePointer(root: string, folder: string, fs: HelperFs): Promise<void> {
  const pointer = join(root, WINDOWS_POINTER);
  const temporary = `${pointer}.${process.pid}.tmp`;
  await writeFile(temporary, `${folder}\n`);
  await move(temporary, pointer, 120, fs);
}

async function writePrevious(root: string, folder: string, fs: HelperFs): Promise<void> {
  const file = join(root, WINDOWS_PREVIOUS);
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, folder ? `${folder}\n` : "\n");
  await move(temporary, file, 120, fs);
}

/**
 * Windows: land the update in a fresh version folder and switch current.txt. Never rename or delete the live
 * folder, which an orphan process can hold with Access denied.
 */
async function swapVersioned(plan: HelperPlan, journal: Journal, log: (line: string) => void, fs: HelperFs, launcher?: WindowsLauncher): Promise<boolean> {
  const root = journal.installRoot!;
  await writeJournal(plan.journal, { ...journal, phase: "applying" });
  const keep = async (line: string): Promise<false> => {
    await writeJournal(plan.journal, { ...journal, phase: "staged", heldUntil: Date.now() + RETRY_AFTER_MS });
    log(`desktop update ${journal.version}: ${line}`);
    return false;
  };
  let destName = journal.versionFolder!;
  let dest = join(root, destName);
  if (existsSync(dest)) {
    try { await fs.remove(dest); } catch {
      destName = `${journal.versionFolder}-${String(process.pid)}`;
      if (!isWindowsVersionFolder(destName)) return keep("could not pick a free version folder; kept staged");
      dest = join(root, destName);
    }
  }
  try {
    if (existsSync(journal.staged)) await restoreAsarNames(journal.staged);
    const incoming = await bringBesideTarget(journal.staged, dest, fs);
    try { await move(incoming.path, dest, 120, fs); }
    catch (error) {
      if (incoming.copied) await fs.remove(incoming.path).catch(() => undefined);
      else await fs.rename(incoming.path, journal.staged).catch(() => undefined);
      throw error;
    }
    if (incoming.copied) await fs.remove(journal.staged).catch(() => undefined);
  } catch (error) {
    await fs.remove(dest).catch(() => undefined);
    return keep(`could not place the new copy in a version folder (${String(error)}); kept staged`);
  }
  try {
    await writePointer(root, destName, fs);
    await writePrevious(root, journal.previousFolder ?? "", fs);
  } catch (error) {
    return keep(`could not switch the current-version pointer (${String(error)}); kept staged`);
  }
  // The cmd stub is a convenience for terminals; the new version is already in place, so a failure here only logs.
  if (launcher) await writeFile(join(root, launcher.WINDOWS_LAUNCHER), launcher.windowsLauncherScript())
    .catch((error: unknown) => log(`desktop update ${journal.version}: could not write ${launcher.WINDOWS_LAUNCHER} (${String(error)})`));
  log(`desktop update ${journal.version}: version folder ${destName}; left the live folder in place`);
  const { heldUntil: _retry, ...applied } = journal;
  await writeJournal(plan.journal, { ...applied, versionFolder: destName, phase: "applied" });
  return true;
}

/** Switch current.txt back to the previous folder. Never rename a folder that may still be locked. */
async function rollbackVersioned(plan: HelperPlan, journal: Journal, pid: number | undefined, fs: HelperFs): Promise<void> {
  if (pid !== undefined) await stop(pid);
  const root = journal.installRoot!;
  try {
    if (journal.previousFolder && isWindowsVersionFolder(journal.previousFolder)) await writePointer(root, journal.previousFolder, fs);
    else await fs.remove(join(root, WINDOWS_POINTER)).catch(() => undefined);
  } catch { /* pointer stays; prune will skip a locked folder */ }
  if (journal.versionFolder) await fs.remove(join(root, journal.versionFolder)).catch(() => undefined);
  await writeFile(plan.rejectedFile, JSON.stringify({ version: journal.version, sha256: journal.sha256 }));
  await rm(plan.journal, { force: true });
}

const LOCKED_PRUNE = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY", "EEXIST"]);

/**
 * Delete unused Windows version folders under the install root. A locked folder is skipped so prune never
 * fails the update and never needs admin rights.
 */
export async function pruneWindowsVersionFolders(
  root: string,
  keep: Iterable<string>,
  options: { remove?: (path: string) => Promise<void>; log?: (line: string) => void } = {},
): Promise<{ removed: number; skipped: number }> {
  const kept = new Set([...keep].filter(name => isWindowsVersionFolder(name)));
  let removed = 0, skipped = 0;
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try { entries = await readdir(root, { withFileTypes: true }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { removed, skipped };
    throw error;
  }
  const remove = options.remove ?? ((path: string) => rm(path, { recursive: true, force: true, maxRetries: 0 }));
  for (const entry of entries) {
    if (!isWindowsVersionFolder(entry.name) || kept.has(entry.name)) continue;
    const folder = join(root, entry.name);
    try {
      const info = await lstat(folder);
      if (info.isSymbolicLink() || !info.isDirectory()) continue;
    } catch { continue; }
    try {
      await remove(folder);
      removed++;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (LOCKED_PRUNE.has(code) || /access denied/i.test(String(error))) {
        options.log?.(`desktop update: left locked version folder ${entry.name}`);
        skipped++;
        continue;
      }
      options.log?.(`desktop update: could not prune ${entry.name} (${String(error)})`);
      skipped++;
    }
  }
  return { removed, skipped };
}

/** The failed copy is renamed aside beside the target (never across volumes), the previous copy returns, then the failed one goes. */
async function rollback(plan: HelperPlan, journal: Journal, previous: string, pid: number | undefined, fs: HelperFs): Promise<void> {
  if (pid !== undefined) await stop(pid);
  const failed = siblingPath(journal.target, "failed");
  await fs.remove(failed);
  await move(journal.target, failed, 120, fs);
  await move(previous, journal.target, 120, fs);
  await fs.remove(failed).catch(() => undefined);
  await writeFile(plan.rejectedFile, JSON.stringify({ version: journal.version, sha256: journal.sha256 }));
  await rm(plan.journal, { force: true });
}

// Branch's desktop log limits (BRANCH_LOG_LIMITS in src/log-rotation.ts), repeated here because this file runs alone:
// the live file rotates when the next line would pass 20 MB, and two numbered archives are kept as desktop.1.log and desktop.2.log.
const LOG_MAX_BYTES = 20 * 1024 * 1024;
const LOG_ROTATED_FILES = 2;
function rotatedLogPath(file: string, index: number): string {
  const ext = extname(file);
  return `${file.slice(0, file.length - ext.length)}.${index}${ext}`;
}
/** Never throws: a full disk drops the line, and the update swap carries on. */
function appendCappedLog(file: string, text: string): void {
  try {
    const size = existsSync(file) ? statSync(file).size : 0;
    if (size > 0 && size + Buffer.byteLength(text) > LOG_MAX_BYTES) {
      try {
        rmSync(rotatedLogPath(file, LOG_ROTATED_FILES), { force: true });
        for (let index = LOG_ROTATED_FILES - 1; index >= 1; index -= 1) {
          if (existsSync(rotatedLogPath(file, index))) renameSync(rotatedLogPath(file, index), rotatedLogPath(file, index + 1));
        }
        renameSync(file, rotatedLogPath(file, 1));
      } catch { /* keep appending: a log over its cap beats lost lines */ }
    }
    appendFileSync(file, text);
  } catch {
    // This line is dropped; the next write tries again.
  }
}

export async function runHelper(plan: HelperPlan, fs: HelperFs = nodeHelperFs): Promise<"applied" | "kept" | "rolled-back" | "none"> {
  const log = (line: string): void => { try { appendCappedLog(plan.log, `${new Date().toISOString()} ${line}\n`); } catch { /* never stops the swap */ } };
  for (let i = 0; i < 240 && alive(plan.waitPid); i++) await sleep(250);
  const journal = readJournal(plan.journal);
  if (journal?.phase !== "staged" || alive(plan.waitPid)) {
    log("desktop update helper: nothing staged or the app is still running; relaunching unchanged");
    launch(plan);
    return "none";
  }
  const previous = `${journal.target}.previous`;
  const launcher = versioned(journal) ? await loadWindowsLauncher(log) : undefined;
  const placed = versioned(journal) ? await swapVersioned(plan, journal, log, fs, launcher) : await swap(plan, journal, previous, log, fs);
  if (!placed) { launch(plan, journal); return "kept"; }
  log(`desktop update ${journal.version}: ${journal.kind} swapped in; relaunching`);
  registerLaunchedMacApp(journal.target, log);
  const pid = launch(plan, journal);
  for (const end = Date.now() + plan.confirmTimeoutMs; Date.now() < end; await sleep(250)) {
    if (!existsSync(plan.journal)) {
      if (journal.kind === "runtime" || versioned(journal)) refreshWindowsIcon(plan, log, journal, launcher);
      log(`desktop update ${journal.version}: confirmed by the new app`); return "applied";
    }
  }
  log(`desktop update ${journal.version}: the new app did not confirm its start; restoring the previous copy`);
  if (versioned(journal)) await rollbackVersioned(plan, journal, pid, fs);
  else await rollback(plan, journal, previous, pid, fs);
  registerLaunchedMacApp(journal.target, log);
  launch(plan, journal);
  return "rolled-back";
}

if (require.main === module && process.argv[2]) {
  const plan = JSON.parse(readFileSync(process.argv[2], "utf8")) as HelperPlan;
  void runHelper(plan).catch(error => {
    try { appendCappedLog(plan.log, `${new Date().toISOString()} desktop update helper failed: ${String(error)}\n`); } catch { /* ignore */ }
    process.exitCode = 1;
  });
}
