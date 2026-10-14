// Runs by itself under plain Node (copied out of app.asar): only Node built-ins, no other desktop modules.
// Waits for the desktop app to exit, swaps the staged copy in, relaunches it and waits for the new app to confirm
// its start (it removes the journal). No confirmation in time: stop the new app by its PID, put the previous copy
// back, remember the release as rejected and relaunch the previous app.
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { cp, readdir, rename, rm, writeFile } from "node:fs/promises";
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
interface Journal { version: string; sha256: string; kind: "asar" | "runtime" | "appimage"; staged: string; target: string; phase: string; heldUntil?: number }
/** After a swap that found the app in use, starts leave the update staged this long (Restart retries at once). */
const RETRY_AFTER_MS = 60 * 60 * 1000;

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
  if (!await swap(plan, journal, previous, log, fs)) { launch(plan); return "kept"; }
  log(`desktop update ${journal.version}: ${journal.kind} swapped in; relaunching`);
  registerLaunchedMacApp(journal.target, log);
  const pid = launch(plan);
  for (const end = Date.now() + plan.confirmTimeoutMs; Date.now() < end; await sleep(250)) {
    if (!existsSync(plan.journal)) {
      if (journal.kind === "runtime") refreshWindowsIcon(plan, log);
      log(`desktop update ${journal.version}: confirmed by the new app`); return "applied";
    }
  }
  log(`desktop update ${journal.version}: the new app did not confirm its start; restoring the previous copy`);
  await rollback(plan, journal, previous, pid, fs);
  registerLaunchedMacApp(journal.target, log);
  launch(plan);
  return "rolled-back";
}

if (require.main === module && process.argv[2]) {
  const plan = JSON.parse(readFileSync(process.argv[2], "utf8")) as HelperPlan;
  void runHelper(plan).catch(error => {
    try { appendCappedLog(plan.log, `${new Date().toISOString()} desktop update helper failed: ${String(error)}\n`); } catch { /* ignore */ }
    process.exitCode = 1;
  });
}
