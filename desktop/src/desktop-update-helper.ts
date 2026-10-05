// Runs by itself under plain Node (copied out of app.asar): only Node built-ins, no other desktop modules.
// Waits for the desktop app to exit, swaps the staged copy in, relaunches it and waits for the new app to confirm
// its start (it removes the journal). No confirmation in time: stop the new app by its PID, put the previous copy
// back, remember the release as rejected and relaunch the previous app.
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface HelperPlan {
  journal: string;
  versionFile: string;
  rejectedFile: string;
  log: string;
  /** The desktop app that handed off; nothing is touched until it has exited. */
  waitPid: number;
  relaunch: { command: string; args: string[] };
  confirmTimeoutMs: number;
}
interface Journal { version: string; sha256: string; kind: "asar" | "runtime"; staged: string; target: string; phase: string; heldUntil?: number }
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

/** Files can stay locked for a moment after a process exits (Windows); retry, then give up without changes. */
async function move(source: string, target: string, attempts = 120): Promise<void> {
  for (let attempt = 0;; attempt++) {
    try { await rename(source, target); return; } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(code) || attempt >= attempts) throw error;
      await sleep(250);
    }
  }
}

function launch(plan: HelperPlan): number | undefined {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(plan.relaunch.command, plan.relaunch.args, { detached: true, stdio: "ignore", windowsHide: true, env });
  child.unref();
  return child.pid;
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

/** Old copy aside, new copy in. On failure the old copy is put back and the update stays staged. */
async function swap(plan: HelperPlan, journal: Journal, previous: string, log: (line: string) => void): Promise<boolean> {
  await rm(previous, { recursive: true, force: true });
  if (journal.kind === "runtime") await restoreAsarNames(journal.staged);
  await writeJournal(plan.journal, { ...journal, phase: "applying" });
  try { await move(journal.target, previous); } catch (error) {
    await writeJournal(plan.journal, { ...journal, phase: "staged", heldUntil: Date.now() + RETRY_AFTER_MS });
    log(`desktop update ${journal.version}: the app is still in use (${String(error)}); kept staged for the next start`);
    return false;
  }
  try { await move(journal.staged, journal.target); } catch (error) {
    await move(previous, journal.target);
    await writeJournal(plan.journal, { ...journal, phase: "staged", heldUntil: Date.now() + RETRY_AFTER_MS });
    log(`desktop update ${journal.version}: could not place the new copy (${String(error)}); kept staged`);
    return false;
  }
  const { heldUntil: _retry, ...applied } = journal;
  await writeJournal(plan.journal, { ...applied, phase: "applied" });
  return true;
}

async function rollback(plan: HelperPlan, journal: Journal, previous: string, pid: number | undefined): Promise<void> {
  if (pid !== undefined) await stop(pid);
  await move(journal.target, `${journal.staged}-failed`);
  await move(previous, journal.target);
  await writeFile(plan.rejectedFile, JSON.stringify({ version: journal.version, sha256: journal.sha256 }));
  await rm(plan.journal, { force: true });
}

export async function runHelper(plan: HelperPlan): Promise<"applied" | "kept" | "rolled-back" | "none"> {
  const log = (line: string): void => { try { appendFileSync(plan.log, `${new Date().toISOString()} ${line}\n`); } catch { /* never stops the swap */ } };
  for (let i = 0; i < 240 && alive(plan.waitPid); i++) await sleep(250);
  const journal = readJournal(plan.journal);
  if (journal?.phase !== "staged" || alive(plan.waitPid)) {
    log("desktop update helper: nothing staged or the app is still running; relaunching unchanged");
    launch(plan);
    return "none";
  }
  const previous = `${journal.target}.previous`;
  if (!await swap(plan, journal, previous, log)) { launch(plan); return "kept"; }
  log(`desktop update ${journal.version}: ${journal.kind} swapped in; relaunching`);
  const pid = launch(plan);
  for (const end = Date.now() + plan.confirmTimeoutMs; Date.now() < end; await sleep(250)) {
    if (!existsSync(plan.journal)) { log(`desktop update ${journal.version}: confirmed by the new app`); return "applied"; }
  }
  log(`desktop update ${journal.version}: the new app did not confirm its start; restoring the previous copy`);
  await rollback(plan, journal, previous, pid);
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
