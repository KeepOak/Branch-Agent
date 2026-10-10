// Branch Agent desktop app: starts the engine gateway, serves the built window on 127.0.0.1 and shows it.
import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, session, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { appendFileSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { engineSignature, loadConfig, resolveEngineDir, type DesktopConfig } from "./config";
import { deactivateGateway, drainStopGateway, gatewayActivity, GatewayReadinessTimeoutError, killGatewayAndWait, portIsFree, prepareStandbyGateway, readToken, rollbackGateway, sendStandbyTakeOver, setEnginePriority, startGateway, stopFailedEngine, stopGateway, stopGatewayCleanly, stopWarmingStandby, takeOverStandby, waitForReady, type PreparedGateway } from "./gateway";
import { HANDOFF_RETIRE_KILL_AFTER_MS, HANDOFF_ROLLBACK_TIMEOUT_MS, HANDOFF_STANDBY_READY_TIMEOUT_MS, HANDOFF_STEP_DOWN_TIMEOUT_MS, HANDOFF_TAKE_OVER_TIMEOUT_MS } from "./handoff-timeouts";
import { readPreparedNormalProfile } from "./profile-migration";
import { createGatewayCrashSupervisor } from "./gateway-supervisor";
import { serveWindow } from "./static-server";
import { watchEngineBuild, watchWindowBuild } from "./updates";
import { keepWindowResident } from "./resident-window";
import { canUndoComponentUpdate, confirmComponentUpdate, confirmComponentUpdateUndo, prepareComponentUpdateUndo, readComponentUpdateStatus, recordComponentUpdateTimeout, recoverComponentUpdate, refreshComponentUpdate, rejectFailedComponentUpdate, rollbackComponentUpdate, rollbackComponentUpdateUndo, watchComponentUpdates } from "./component-update";
import { bootSelectedEngineWithRollback } from "./boot-selected-engine";
import { createComponentUpdateController, isOwnedComponentWindow, registerComponentUpdateIpc } from "./component-update-ipc";
import { createDesktopControls, readSettings, registerDesktopControlsIpc } from "./desktop-controls";
import { desktopOs, START_IN_TRAY } from "./desktop-os";
import { parseTitleBarOverlay, registerTitleBarIpc, titleBarOptions } from "./title-bar";
import { registerClipboardIpc } from "./clipboard-ipc";
import { keepWindowsOnScreen, placeWindow, readWindowState, trackWindowState } from "./window-state";
import { confirmDesktopUpdate, handOffDesktopUpdate, type DesktopInstall } from "./desktop-update";
import { createAutoApplyUpdate } from "./auto-apply-update";
import { availableMemory, candidateCheckSkippedLine, candidateMinFreeBytes } from "./available-memory";
import { RotatingLog, uiEventLine } from "./diagnostics-log";
import { readTail, recentLines, reportReadme } from "./diagnostics-report";
import { zipStored } from "./diagnostics-zip";

/** How much of each log the report reads from the end. The time window then keeps only recent lines. */
const REPORT_TAIL_BYTES = 4 * 1024 * 1024;
import { checkCandidateBeside, stopCandidate } from "./candidate-check";
import { clearEngineRecords, retireRecordedEngines } from "./engine-records";
import { createUpdateLock, type UpdateLockHandle } from "./update-lock";
import { createHash } from "node:crypto";
import type { Tray } from "electron";
import { MacComputerDriver, describeDriverError, macScreenControlEnabled } from "./mac-computer-driver";

const HIDDEN = process.env.BRANCH_DESKTOP_HIDDEN === "1";
/** Scratch test copies: never grouped with, or mistaken for, the owner's app (they also start hidden). */
const TEST_COPY = process.env.BRANCH_DESKTOP_TEST === "1";
/** Started with Windows: open quietly in the tray (only where the tray exists). */
const QUIET = process.platform === "win32" && process.argv.includes(START_IN_TRAY);
const ICON = process.platform === "win32"
  ? join(__dirname, "..", "assets", "branch.ico")
  : join(__dirname, "..", "assets", "brand", "linux", "branch-48.png");
// Menu bar template: black leaf on a transparent background. Electron loads branchTemplate@2x.png for Retina.
const TRAY_ICON = process.platform === "darwin"
  ? join(__dirname, "..", "assets", "brand", "linux", "branchTemplate.png")
  : ICON;
/** A positive whole number of milliseconds from the environment, else `fallback` (a typo never means "0 ms"). */
function envMs(value: string | undefined, fallback: number): number {
  const ms = Number(value);
  return value && Number.isInteger(ms) && ms > 0 ? ms : fallback;
}
/** Tests shorten it with BRANCH_DESKTOP_READY_TIMEOUT_MS. */
const READY_TIMEOUT_MS = envMs(process.env.BRANCH_DESKTOP_READY_TIMEOUT_MS, 600_000);
/** The handoff deadlines (handoff-timeouts.ts, shared with the engine); tests shorten them through the environment. */
const STEP_DOWN_TIMEOUT_MS = envMs(process.env.BRANCH_DESKTOP_STEP_DOWN_TIMEOUT_MS, HANDOFF_STEP_DOWN_TIMEOUT_MS);
const TAKE_OVER_TIMEOUT_MS = envMs(process.env.BRANCH_DESKTOP_TAKE_OVER_TIMEOUT_MS, HANDOFF_TAKE_OVER_TIMEOUT_MS);
const STANDBY_READY_TIMEOUT_MS = envMs(process.env.BRANCH_DESKTOP_STANDBY_READY_TIMEOUT_MS, HANDOFF_STANDBY_READY_TIMEOUT_MS);
const ROLLBACK_TIMEOUT_MS = envMs(process.env.BRANCH_DESKTOP_ROLLBACK_TIMEOUT_MS, HANDOFF_ROLLBACK_TIMEOUT_MS);
const RETIRE_KILL_AFTER_MS = envMs(process.env.BRANCH_DESKTOP_RETIRE_KILL_AFTER_MS, HANDOFF_RETIRE_KILL_AFTER_MS);
/** How long an old engine that says it still serves gets to prove it on /readyz. */
const PRIOR_READY_CHECK_MS = 10_000;
/** A standby only loads code before it reports warm; one that takes longer is stopped and the old engine keeps serving. */
const STANDBY_WARM_TIMEOUT_MS = 120_000;
/** Failed standbys per update before the guarded stop/start swap takes over, so an update never becomes impossible. */
const STANDBY_ATTEMPTS = 2;
/** Free memory a candidate check needs (6 GB, or a quarter of RAM); tests lower it with BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB. */
const cfg: DesktopConfig = loadConfig();
/** The packaged app this process runs from; development runs (`electron .`) never update themselves. */
const install: DesktopInstall | undefined = app.isPackaged ? {
  appDir: process.platform === "darwin" ? resolve(process.resourcesPath, "..", "..") : dirname(process.execPath),
  resourcesDir: process.resourcesPath, executable: process.execPath,
  electronVersion: process.versions.electron, nodePath: cfg.nodePath,
} : undefined;

/** Appends one line to the app's own data directory log. */
function log(line: string): void {
  try {
    appendFileSync(join(cfg.dataDir, "desktop.log"), `${new Date().toISOString()} ${line}
`);
  } catch {
    // logging must never stop the app
  }
}
const launchStarted = Date.now();
log(`launch v${app.getVersion()} pid ${process.pid}`);

// Own profile and lock, apart from the old installed Branch Agent app.
app.setPath("userData", join(cfg.dataDir, "electron"));
app.setAppUserModelId(TEST_COPY ? "dev.branch.agent.desktop.test" : "dev.branch.agent.desktop");
// "Let agents use this window": Chromium remote debugging on a random loopback port, written to
// <userData>/DevToolsActivePort for `branch mcp serve` ui_* tools. Off unless the owner turned it on.
if (readSettings(join(cfg.dataDir, "desktop-settings.json")).agentControl) {
  app.commandLine.appendSwitch("remote-debugging-port", "0");
  log("agent control is on: remote debugging on a loopback port");
}

let gateway: ChildProcess | undefined;
/** The engine that last answered /readyz; a live engine that never did is a failed one, not a serving one. */
let readyGateway: ChildProcess | undefined;
/**
 * The loopback port the serving engine listens on. It starts as the configured port; an update's standby comes up on
 * its own spare port, and once it is ready this follows it (in memory only) until the next launch.
 */
let gatewayPort = cfg.gatewayPort;
const gatewayUrl = (): string => `ws://127.0.0.1:${gatewayPort}`;
/** The port the window was last given (by the info IPC or a handoff). */
let windowPort = cfg.gatewayPort;
/** An update's warmed standby until it is promoted or stopped; quitting never leaves it behind. */
let standby: PreparedGateway | undefined;
/** Failed standbys per update label: automatic updates fall back to the guarded swap after one, the owner's clicks after STANDBY_ATTEMPTS. */
const standbyFailures = new Map<string, number>();
/** The engine build that last became ready: crash recovery and failed updates bring this one back. */
let lastGoodEngineDir: string | undefined;
/** `branch mcp serve` and the `branch` command read the live port from here (desktop.json keeps the configured one). */
function writeGatewayPortFile(port: number): void {
  const file = join(cfg.dataDir, "gateway-port");
  try { writeFileSync(`${file}.tmp`, String(port)); renameSync(`${file}.tmp`, file); }
  catch (error) { log(`gateway-port could not be recorded: ${String(error)}`); }
}
function adoptGatewayPort(port: number): void {
  gatewayPort = port;
  writeGatewayPortFile(port);
}
/** Points the window at the serving engine when its port moved (or always, after a successful update). */
function handWindowToGateway(always = false): void {
  if (!win || (!always && windowPort === gatewayPort)) return;
  windowPort = gatewayPort;
  sendToBranchWindows("branch-desktop:engine-handoff", gatewayUrl());
}
const macComputerDriver = process.platform === "darwin" ? new MacComputerDriver(log) : undefined;
const screenControlEnabled = () => macScreenControlEnabled(join(cfg.dataDir, "home", ".branch", "branch.json"));
let server: Server | undefined;
let win: BrowserWindow | undefined;
const conversationWindows = new Map<string, BrowserWindow>();
const branchWindows = (): BrowserWindow[] => [win, ...conversationWindows.values()].filter((w): w is BrowserWindow => Boolean(w && !w.isDestroyed()));
// Brings windows back inside the visible screen when shown and after display changes; set once the app is ready.
let fitWindowsOnScreen: ReturnType<typeof keepWindowsOnScreen> | undefined;
const sendToBranchWindows = (channel: string, ...args: unknown[]): void => {
  for (const w of branchWindows()) w.webContents.send(channel, ...args);
};
const ownedWebContents = (sender: unknown) => {
  const owner = BrowserWindow.fromWebContents(sender as Electron.WebContents);
  return owner && branchWindows().includes(owner) ? owner.webContents : undefined;
};
let quitting = false;
const conversationWindowFile = join(cfg.dataDir, "conversation-windows.json");
const conversationStateFile = (key: string): string => `conversation-window-${createHash("sha256").update(key).digest("hex").slice(0, 20)}.json`;
let pendingSavedConversationKeys = savedConversationKeys();
function saveConversationWindows(): void {
  try { writeFileSync(conversationWindowFile, JSON.stringify([...new Set([...pendingSavedConversationKeys, ...conversationWindows.keys()])])); } catch { /* a window remains usable without persistence */ }
  if (win && !win.isDestroyed()) win.webContents.send("branch-desktop:conversation-windows", [...conversationWindows.keys()]);
}
function savedConversationKeys(): string[] {
  try {
    const value: unknown = JSON.parse(readFileSync(conversationWindowFile, "utf8"));
    return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string" && Boolean(key.trim())) : [];
  } catch { return []; }
}
let token = "";
let engineUpdateReady = false;
let stopEngineWatch: (() => void) | undefined;
let stopComponentWatch: (() => void) | undefined;
let stopWindowWatch: (() => void) | undefined;
let componentsReady = false;
let pendingReleasePrune: (() => Promise<void>) | undefined;
function runConfirmedReleasePrune(): void {
  const prune = pendingReleasePrune;
  pendingReleasePrune = undefined;
  if (prune) void prune().catch(error => log(`Confirmed update cleanup: ${String(error)}`));
}
/** The window build the static server serves: the staged one only once its engine runs. */
let servedWindowDir = cfg.windowDir;
/**
 * The one update lock: an in-place update, crash recovery, a staged-update replacement and #380's Undo each hold it
 * for their whole run. Undo holds it across its prepare and passes the handle to swapEngineInPlace.
 */
const updateLock = createUpdateLock(released => afterUpdateLockRelease(released));
const RECOVERY = "crash recovery", REPLACING = "replace the staged update";
/** An Update click that arrived while a newer release replaced the staged one: it runs once the replacement ends. */
let updateClickQueued = false;
let withdrawnUpdateVersion: string | undefined;
/** The engine exited while an update ran: the update's end decides, then recovery runs once with a full budget. */
let recoveryDeferred = false;
/** A failed update left nothing serving: once recovery brings the previous build back, the bar says it was kept. */
let keptNoticeAfterRecovery = false;
let updateNotice: { version: string; canUndo: boolean; expiresAt: number } | undefined;
let lastNotifiedVersion: string | undefined;
let lastPostponedVersion: string | undefined;
let gatewayRecoveryError: string | undefined;
const gatewaySupervisor = createGatewayCrashSupervisor({
  current: () => gateway,
  log,
  onExhausted: error => {
    gatewayRecoveryError = `Branch couldn't restart the engine after repeated attempts. Restart Branch Agent to try again. ${error.message}`;
    log(`gateway recovery stopped: ${error.message}`);
    sendToBranchWindows("branch-desktop:gateway-recovery-failed", gatewayRecoveryError);
    if (!HIDDEN && win?.isVisible()) dialog.showErrorBox("Branch couldn't restart the engine", error.message);
  },
  restart: async () => {
    // An update in progress owns the engine; spending restart attempts against it would exhaust the budget.
    if (updateLock.held) { recoveryDeferred = true; log(`gateway exit during an update (${updateLock.purpose}); recovery waits for it`); return; }
    if (quitting || engineServing()) return;
    const lock = updateLock.acquire(RECOVERY)!;
    try {
      // A live engine that never became ready (a failed update's new engine slow to exit) is not serving: stop it.
      if (gateway && engineRunning()) await stopFailedEngine(gateway);
      await waitForGatewayPort();
      if (quitting) return;
      // The selected pointer may already name a staged update. Recover the build that exited;
      // only the normal update path may validate and confirm the staged engine/window pair.
      const engineDir = lastGoodEngineDir ?? readFileSync(join(cfg.dataDir, "engine-running.txt"), "utf8").trim();
      await bootEngine(engineDir, false, undefined, await recoveryPort());
      handWindowToGateway();
      log("gateway recovered after unexpected exit");
      if (keptNoticeAfterRecovery) {
        keptNoticeAfterRecovery = false;
        sendToBranchWindows("branch-desktop:engine-update", "kept");
      }
    } catch (error) {
      if (gateway) await stopFailedEngine(gateway);
      throw error;
    } finally {
      await updateLock.release(lock);
    }
  },
});
const componentUpdates = createComponentUpdateController(cfg, { stage: stageComponentUpdate });
let tray: Tray | undefined;
const controls = createDesktopControls({ ...desktopOs(app, cfg, () => tray, TRAY_ICON), onChange: settings => {
  if (engineUpdateReady) sendToBranchWindows("branch-desktop:engine-update", settings.autoApplyUpdates ? "auto-wait" : "ready");
  void autoApply.tick();
} });
let nextProbeId = 0;

async function probeOneWindow(owner: Electron.WebContents): Promise<{ pendingApprovals: number; streaming: boolean; unsavedDraftFiles: boolean }> {
  if (!owner || owner.isDestroyed()) throw new Error("The window is not ready to report approvals and drafts");
  const id = ++nextProbeId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error("The window activity check timed out")); }, 5_000);
    const cleanup = () => { clearTimeout(timer); ipcMain.off("branch-desktop:auto-apply:result", receive); };
    const receive = (event: Electron.IpcMainEvent, replyId: unknown, value: unknown) => {
      if (replyId !== id || !isOwnedComponentWindow(event, owner, windowUrl())) return;
      cleanup();
      const result = value as { pendingApprovals?: unknown; streaming?: unknown; unsavedDraftFiles?: unknown; error?: unknown };
      if (typeof result?.pendingApprovals !== "number" || typeof result.streaming !== "boolean" || typeof result.unsavedDraftFiles !== "boolean") {
        reject(new Error(String(result?.error ?? "Invalid window activity snapshot"))); return;
      }
      resolve({ pendingApprovals: result.pendingApprovals, streaming: result.streaming, unsavedDraftFiles: result.unsavedDraftFiles });
    };
    ipcMain.on("branch-desktop:auto-apply:result", receive);
    owner.send("branch-desktop:auto-apply:probe", id);
  });
}
async function probeWindowState(): Promise<{ pendingApprovals: number; streaming: boolean; unsavedDraftFiles: boolean }> {
  const states = await Promise.all(branchWindows().map(w => probeOneWindow(w.webContents)));
  if (!states.length) throw new Error("The window is not ready to report approvals and drafts");
  return { pendingApprovals: Math.max(...states.map(s => s.pendingApprovals)), streaming: states.some(s => s.streaming),
    unsavedDraftFiles: states.some(s => s.unsavedDraftFiles) };
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const windowBuild = (dir: string): string => { try { return readFileSync(join(dir, "branch-build.txt"), "utf8").trim(); } catch { return ""; } };
const engineRunning = (): boolean => Boolean(gateway && gateway.exitCode === null && gateway.signalCode === null);
/** Running and ready: the engine the window can use. */
const engineServing = (): boolean => engineRunning() && gateway === readyGateway;

/**
 * Applies a staged engine/window update, or a rebuilt engine, inside the running app: the app and its window stay
 * open. The old engine stops cleanly (auto-apply: only while idle; the owner's click: it drains, and the new
 * engine's restart recovery resumes interrupted runs), the new one starts with the readiness rollback, and the window
 * either is handed the new engine's address (engine-only) or swaps in its new build keeping route, scroll and drafts.
 * With room for it, the new engine first warms as a standby on its own spare port while the old one still serves;
 * only a standby that warmed is promoted, and the window follows it once it answers /readyz on that port. The
 * engine's state lock means the standby can only bind and become ready after the old engine has released state.
 * A staged desktop app is never applied here; it waits for the next natural launch.
 */
async function swapEngineInPlace(label: string, explicit: boolean, held?: UpdateLockHandle, handoffOnly = false): Promise<void> {
  // `held`: the caller (Undo) already holds the update lock and keeps it; otherwise the swap takes it.
  if (!gateway || !win || (held ? !updateLock.holds(held) : updateLock.held)) throw new Error("The desktop is not ready to update");
  // A crash restart always runs first: an update never cancels it, and never starts with no engine serving.
  if (!engineServing()) throw new Error("The engine is restarting after an exit; the update waits for it");
  const lock = held ?? updateLock.acquire(`update ${label}`)!;
  const windowBefore = windowBuild(servedWindowDir);
  const priorGateway = gateway;
  const attempt = { stepDownSent: false };
  const stillOpen = () => { if (quitting) throw new Error("Branch Agent is quitting"); };
  const preparation = new AbortController();
  const priorExited = () => {
    preparation.abort();
    stopCandidate();
    stopWarmingStandby();
  };
  priorGateway.once("exit", priorExited);
  try {
    if (!await candidatePassed(label, explicit, preparation.signal)) return;
    if (preparation.signal.aborted || !engineServing()) throw new Error("The serving engine exited during update preparation");
    await prepareUpdateStandby(label, explicit);
    if (preparation.signal.aborted || !engineServing()) throw new Error("The serving engine exited during standby warmup");
    if (handoffOnly && (!standby || retiring.size > 0)) {
      throw new Error("A standby is needed to hand off without interrupting running work");
    }
    priorGateway.off("exit", priorExited);
    stillOpen();
    const started = Date.now();
    if (explicit) sendToBranchWindows("branch-desktop:engine-update", "updating");
    const resumeSupervision = gatewaySupervisor.expectExit(priorGateway);
    // One handoff at a time: while an old engine still finishes its sessions, the guarded swap runs instead.
    if (standby && seamlessHandoff() && retiring.size > 0) log(`update ${label}: an old engine is still finishing its sessions; using the guarded swap`);
    const handoff = standby && seamlessHandoff() && retiring.size === 0
      ? await handOffToStandby(label, priorGateway, standby, resumeSupervision, attempt) : "drain";
    if (handoffOnly && handoff === "drain") {
      resumeSupervision();
      throw new Error("The previous engine could not hand off; it keeps serving until a retry");
    }
    let rolledBack = handoff === "kept";
    const stopped = Date.now();
    if (handoff === "drain") {
      try {
        if (explicit) log(`update ${label}: old engine ${await drainStopGateway(priorGateway)}`);
        else await stopGatewayCleanly(priorGateway);
      } catch (error) {
        resumeSupervision();
        throw error;
      }
      stillOpen();
      servedWindowDir = cfg.windowDir;
      await waitForGatewayPort();
      stillOpen();
      const selectedStandby = standby;
      standby = undefined;
      rolledBack = await bootSelectedEngine(selectedStandby);
    }
    log(`update ${label}: engine ${rolledBack ? "rolled back" : "swapped"} in place${handoff === "drain" ? "" : " by handoff"}; stop ${stopped - started} ms, start ${Date.now() - stopped} ms, app and window kept open`);
    engineUpdateReady = false;
    if (rolledBack) {
      if (explicit) sendToBranchWindows("branch-desktop:engine-update", "kept");
      handWindowToGateway();
    } else {
      // The engine may now serve on the standby's port: hand the window the address it answered /readyz on first,
      // also before a new window build swaps in, so the window can still send attachments while it waits.
      handWindowToGateway(true);
      if (windowBuild(cfg.windowDir) !== windowBefore) void hotSwapWindow();
      else sendToBranchWindows("branch-desktop:engine-update", "updated");
    }
  } catch (error) {
    if (standby) stopGateway(standby.child);
    standby = undefined;
    if (quitting) throw error;
    const message = error instanceof Error ? error.message : String(error);
    if (explicit) sendToBranchWindows("branch-desktop:engine-update-failed", message);
    // Still serving only if the engine from before the update is the one running and ready (and not retiring): a new
    // engine that failed may not have exited yet, and it never became ready. After a step-down was asked for, the old
    // engine must also prove it on /readyz.
    const priorServing = gateway === priorGateway && engineServing() && !retiring.has(priorGateway) &&
      (!attempt.stepDownSent || await priorServes(priorGateway));
    if (!priorServing && gateway === priorGateway) notServing(priorGateway);
    if (priorServing) {
      recoveryDeferred = false;
      if (explicit) sendToBranchWindows("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
    } else {
      // A new engine that failed may still be alive: stop it (SIGKILL after a grace) before recovery starts another.
      const failed = gateway;
      if (failed && failed !== priorGateway) await stopFailedEngine(failed);
      keptNoticeAfterRecovery = true;
    }
    throw error;
  } finally {
    priorGateway.off("exit", priorExited);
    // A held lock stays with its holder, whose release runs the same recovery check.
    if (!held) await updateLock.release(lock);
  }
}

/**
 * After an update, a replacement or Undo releases the lock: never leave zero engines. Whatever the holder did, the
 * crash supervisor brings back the build that last ran, with a fresh budget, when nothing serves now. Crash recovery
 * itself retries within its own budget. A queued Update click runs next.
 */
async function afterUpdateLockRelease(released: UpdateLockHandle): Promise<void> {
  if (released.purpose === RECOVERY) return;
  const queuedClick = updateClickQueued;
  updateClickQueued = false;
  const exitedDuring = recoveryDeferred;
  recoveryDeferred = false;
  if (quitting) return;
  if (!engineServing()) {
    if (gateway && engineRunning()) await stopFailedEngine(gateway);
    gatewaySupervisor.recover(new Error(exitedDuring ? `the engine exited during "${released.purpose}"` : `nothing served after "${released.purpose}"`));
  } else if (queuedClick) {
    const staged = (await readComponentUpdateStatus(cfg)).componentsPendingVersion;
    if (engineUpdateReady && staged) void restartEngine();
    else sendToBranchWindows("branch-desktop:engine-update", "kept");
  }
}

/** Seamless handoff is on by default; desktop.json can set seamlessHandoff to false for drain-first updates. */
const seamlessHandoff = (): boolean => cfg.seamlessHandoff !== false;

/**
 * Old engines from the moment step-down is sent: quitting stops them (shutdown), a crash leaves their
 * record for the next launch to retire, and one still alive at HANDOFF_RETIRE_KILL_AFTER_MS is killed.
 */
const retiring = new Map<ChildProcess, ReturnType<typeof setTimeout>>();
function keepRetiring(label: string, child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || retiring.has(child)) return;
  const timer = setTimeout(() => {
    log(`update ${label}: old engine ${child.pid} is still alive past its lease deadline; stopping it`);
    stopGateway(child, "SIGKILL");
  }, RETIRE_KILL_AFTER_MS);
  timer.unref?.();
  retiring.set(child, timer);
  child.once("exit", () => {
    clearTimeout(timer);
    if (retiring.delete(child)) log(`update ${label}: old engine ${child.pid} finished its kept sessions and stopped`);
  });
}
/** The old engine took control back: it serves again and is no longer retiring. */
function stopRetiring(child: ChildProcess): void {
  clearTimeout(retiring.get(child));
  retiring.delete(child);
}

/** Never trust "kept serving" without /readyz; rollback restarts in place and needs the full warmup budget. */
async function priorServes(prior: ChildProcess, timeoutMs = PRIOR_READY_CHECK_MS): Promise<boolean> {
  return waitForReady({ ...cfg, gatewayPort }, prior, timeoutMs).then(() => true, () => false);
}
/** The old engine is not serving (fenced for good, or dead): the update's end stops it and recovery takes over. */
function notServing(prior: ChildProcess): void {
  if (readyGateway === prior) readyGateway = undefined;
  stopRetiring(prior);
}

/**
 * The seamless path (desktop.json "seamlessHandoff"). The old engine steps down without exiting: it refuses new work,
 * stops channels and cron, keeps every session with a run in flight until that run finishes, and releases the state.
 * Only then is the warm standby told to take over (#411); once it answers /readyz on its own port the window is
 * handed to it and the old engine finishes its kept sessions and stops. A standby that fails is killed before the
 * old engine is asked to take control back, so the state lock is free and never has two owners.
 * "drain": the old engine cannot step down (a build from before the handoff); the guarded swap runs instead.
 */
async function handOffToStandby(label: string, prior: ChildProcess, selected: PreparedGateway, resumeSupervision: () => void,
  attempt: { stepDownSent: boolean }): Promise<"swapped" | "kept" | "drain"> {
  attempt.stepDownSent = true;
  keepRetiring(label, prior);
  const stepped = await deactivateGateway(prior, STEP_DOWN_TIMEOUT_MS);
  if (quitting) throw new Error("Branch Agent is quitting");
  if (stepped !== "ok") {
    // A warm child is not enough: an incompatible predecessor must not trigger another warmup every retry.
    standbyFailures.set(label, STANDBY_ATTEMPTS);
    // Never told to take over, the standby never takes the state: stop it.
    standby = undefined;
    await killGatewayAndWait(selected.child);
    if (stepped === "unanswered") {
      // Unknown: a build from before the handoff, or a step-down still running. Taking control back is harmless if
      // it never stepped down; an engine that answers neither but serves is an old build and is drained instead.
      const back = await rollbackGateway(prior, ROLLBACK_TIMEOUT_MS);
      if ((back === "ok" || back === "unanswered") &&
        await priorServes(prior, back === "ok" ? STANDBY_READY_TIMEOUT_MS : PRIOR_READY_CHECK_MS)) {
        stopRetiring(prior);
        log(`update ${label}: the old engine did not step down in time; it kept serving; draining it instead`);
        return "drain";
      }
    } else if (stepped === "refused" && await priorServes(prior)) {
      stopRetiring(prior);
      resumeSupervision();
      throw new Error("the running engine could not step down for the update and kept serving");
    }
    notServing(prior);
    resumeSupervision();
    throw new Error(`the running engine could not step down (${stepped}) and is not serving; Branch restarts it`);
  }
  standby = undefined;
  log(`update ${label}: old engine ${prior.pid} stepped down; telling standby ${selected.child.pid} to take over on port ${selected.port}`);
  const tookOver = await takeOverStandby(selected.child, TAKE_OVER_TIMEOUT_MS);
  if (quitting) throw new Error("Branch Agent is quitting");
  if (!tookOver) {
    await takeControlBack(label, prior, selected, resumeSupervision, new Error("the standby did not take over in time"));
    return "kept";
  }
  servedWindowDir = cfg.windowDir;
  try {
    // Well under the lease deadline, so the old engine can still take control back.
    await bootEngine(resolveEngineDir(cfg), true, selected, selected.port, { readyTimeoutMs: STANDBY_READY_TIMEOUT_MS, keepOnConfirmFailure: true });
  } catch (error) {
    // Quitting: shutdown stops both engines; nothing is rolled back or recorded against the release.
    if (quitting) throw error;
    await takeControlBack(label, prior, selected, resumeSupervision, error);
    return "kept";
  }
  // The window moves to the new engine next; the old one finishes its kept sessions and stops by itself.
  gatewayActivity(prior, "drain", 30_000).catch(error => log(`update ${label}: old engine retire request: ${String(error)}`));
  return "swapped";
}

/** A standby that failed after the old engine stepped down: kill it, then let the old engine reclaim the state. */
async function takeControlBack(label: string, prior: ChildProcess, selected: PreparedGateway, resumeSupervision: () => void, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  log(`update ${label}: the standby failed (${message}); giving control back to the old engine`);
  // Something else took the standby's spare port before it could bind: not the release's fault.
  const portClash = selected.child.exitCode !== null && !await portIsFree(selected.port);
  // Gone for good (its state lock released) before the old engine is asked to reclaim the state.
  await killGatewayAndWait(selected.child);
  const failedEngine = resolveEngineDir(cfg);
  try {
    if (portClash) log(`update ${label}: standby port ${selected.port} was taken before the standby could bind it; the release stays eligible`);
    else if (error instanceof GatewayReadinessTimeoutError) {
      standbyFailures.set(label, STANDBY_ATTEMPTS);
      log(`update ${label}: handoff readiness budget expired; the next attempt uses the guarded swap`);
    }
    else await rejectFailedComponentUpdate(cfg, failedEngine);
  } catch (recordError) { log(`update ${label}: failure could not be recorded: ${String(recordError)}`); }
  await rollbackComponentUpdate(cfg).catch(rollbackError => log(`update ${label}: component rollback: ${String(rollbackError)}`));
  servedWindowDir = cfg.windowDir;
  gateway = prior;
  // The branch command and the next launch name the engine that runs again, not the failed standby.
  if (lastGoodEngineDir) writeFileSync(join(cfg.dataDir, "engine-running.txt"), `${lastGoodEngineDir}\n`);
  if (prior.pid !== undefined) writeFileSync(join(cfg.dataDir, "gateway.pid"), String(prior.pid));
  const back = await rollbackGateway(prior, ROLLBACK_TIMEOUT_MS);
  // Rollback has reclaimed the state. The old engine must keep its full readiness budget without the retire timer.
  if (back === "ok") stopRetiring(prior);
  if (back !== "ok" || !await priorServes(prior, STANDBY_READY_TIMEOUT_MS)) {
    notServing(prior);
    resumeSupervision();
    throw new Error(`the update failed and the old engine could not take control back (${back}): ${message}`);
  }
  resumeSupervision();
  log(`update ${label}: the old engine took control back on port ${gatewayPort}`);
}

/**
 * Warms the update's standby on a spare port while the current engine keeps serving. With no room for it, an
 * unmigrated profile, or after STANDBY_ATTEMPTS failures for this update, the guarded stop/start swap runs instead.
 * A failed standby is already stopped and nothing else is: the current engine keeps serving.
 */
async function prepareUpdateStandby(label: string, explicit: boolean): Promise<void> {
  // A warmed child cannot be given a fresh Electron-owned driver lease on promotion.
  // Preserve computer control by using the guarded stop/start path for this case.
  if (macComputerDriver && screenControlEnabled()) return;
  if (availableMemory().bytes < candidateMinFreeBytes() || !standbyProfileReady()) return;
  const failures = standbyFailures.get(label) ?? 0;
  // Automatic updates never wait for a click that may not be offered: one failed standby is enough to fall back.
  if (failures >= STANDBY_ATTEMPTS || (!explicit && failures > 0)) {
    log(`update ${label}: the standby failed ${failures} time(s); using the guarded stop/start swap`);
    return;
  }
  try {
    standby = await prepareStandbyGateway(cfg, resolveEngineDir(cfg), token, STANDBY_WARM_TIMEOUT_MS);
    standbyFailures.delete(label);
    log(`update ${label}: standby engine ${standby.child.pid} prepared on port ${standby.port} while the current engine kept serving`);
  } catch (error) {
    standbyFailures.set(label, (standbyFailures.get(label) ?? 0) + 1);
    if (String(error).includes("standby exited before warming")) {
      log(`update ${label}: the standby exited before warming; using the guarded stop/start swap`);
      return;
    }
    throw new Error(`the new engine could not be prepared beside the running one, which kept serving: ${String(error)}`);
  }
}

function standbyProfileReady(): boolean {
  try { readPreparedNormalProfile(join(cfg.dataDir, "home")); return true; }
  catch { log("standby skipped: the profile is not migrated yet; using the guarded stop/start swap"); return false; }
}

/** Crash recovery restarts on the live port, or on the configured one if something else took the moved port. */
async function recoveryPort(): Promise<number> {
  if (gatewayPort === cfg.gatewayPort || await portIsFree(gatewayPort)) return gatewayPort;
  log(`port ${gatewayPort} was taken while the engine was down; recovering on the configured port ${cfg.gatewayPort}`);
  return cfg.gatewayPort;
}

/**
 * Runs `work` holding the swap guard, so no update, rollback, crash restart or window swap starts meanwhile; resolves
 * undefined when an update or recovery already holds it. Used to replace a staged update with a newer release.
 */
async function underSwapGuard(work: () => Promise<boolean>): Promise<boolean | undefined> {
  const lock = updateLock.acquire(REPLACING);
  if (!lock) return undefined;
  try { return await work(); }
  finally {
    // Replaced, withdrawn, put back or rolled back: serve the window of the build that runs, and offer only what is
    // still staged. The window the desktop serves never points at a folder that moved.
    await followStagedUpdate().catch(error => log(`Component update status: ${String(error)}`));
    await updateLock.release(lock);
  }
}

async function followStagedUpdate(): Promise<void> {
  const { componentsPendingVersion, previousWindowDir } = await readComponentUpdateStatus(cfg);
  servedWindowDir = previousWindowDir ?? cfg.windowDir;
  if (!componentsPendingVersion && engineUpdateReady) {
    engineUpdateReady = false;
    watchEngine();
  }
}

/**
 * A staged engine first starts beside the running one (spare port, scratch state). One that exits is rejected and its
 * publication rolled back with nothing stopped; a slow one still gets the normal swap and its readiness rollback.
 */
let candidateCheckedFor: string | undefined;
async function candidatePassed(label: string, explicit: boolean, signal?: AbortSignal): Promise<boolean> {
  const version = (await readComponentUpdateStatus(cfg)).componentsPendingVersion;
  if (!version || candidateCheckedFor === version) return true;
  // The machine-load rule: a second engine only when there is room for it; otherwise the plain swap with its rollback.
  const { bytes: available, measure } = availableMemory();
  if (available < candidateMinFreeBytes()) { log(`update ${label}: ${candidateCheckSkippedLine(available, measure)}`); return true; }
  const candidate = resolveEngineDir(cfg);
  if (explicit) sendToBranchWindows("branch-desktop:engine-update", "preparing");
  const started = Date.now();
  const result = await checkCandidateBeside(cfg, candidate, token, READY_TIMEOUT_MS);
  if (signal?.aborted) throw new Error("The serving engine exited during candidate check");
  log(`update ${label}: candidate check beside the running engine ${result} after ${Date.now() - started} ms`);
  if (result !== "exited") { candidateCheckedFor = version; return true; }
  await rejectFailedComponentUpdate(cfg, candidate);
  await rollbackComponentUpdate(cfg);
  servedWindowDir = cfg.windowDir;
  engineUpdateReady = false;
  watchEngine();
  log(`update ${label}: kept the running engine; nothing was stopped`);
  sendToBranchWindows("branch-desktop:engine-update", "kept");
  return false;
}

const autoApply = createAutoApplyUpdate({
  pendingVersion: async () => {
    const version = (await readComponentUpdateStatus(cfg)).componentsPendingVersion;
    return version === withdrawnUpdateVersion ? null : version;
  },
  enabled: () => controls.settings().autoApplyUpdates && !updateLock.held,
  seamlessHandoff,
  activity: async () => {
    if (!gateway) throw new Error("The gateway is not running");
    // The approval RPCs themselves count as gateway work; sample after they settle.
    const window = await probeWindowState();
    const engine = await gatewayActivity(gateway);
    return { activeRuns: Math.max(engine.activeRuns, engine.totalActive), pendingApprovals: window.pendingApprovals,
      streaming: engine.pendingReplies > 0 || window.streaming, unsavedDraftFiles: window.unsavedDraftFiles };
  },
  restart: async (version, handoffOnly) => {
    await swapEngineInPlace(version, false, undefined, handoffOnly);
    if ((await readComponentUpdateStatus(cfg)).currentVersion !== version) throw new Error("The new release was not confirmed");
  },
  onApplied: async version => {
    if (lastNotifiedVersion === version) return;
    const canUndo = await canUndoComponentUpdate(cfg);
    lastNotifiedVersion = version;
    updateNotice = { version, canUndo, expiresAt: Date.now() + 10 * 60_000 };
    sendToBranchWindows("branch-desktop:update-applied", updateNotice);
  },
  onFailure: version => {
    if (!engineServing() || lastPostponedVersion === version) return;
    lastPostponedVersion = version;
    sendToBranchWindows("branch-desktop:engine-update", "kept");
  },
  log,
});

/**
 * A staged engine/window pair waits for the in-place swap; until then the window server keeps serving the build
 * the running engine started with. A staged desktop app only waits for the next launch, so it offers nothing.
 */
async function offerStagedUpdate(): Promise<void> {
  if (updateLock.purpose === "undo update") return;
  const { componentsPendingVersion, previousWindowDir } = await readComponentUpdateStatus(cfg);
  if (updateLock.purpose === "undo update") return;
  if (!componentsPendingVersion) return;
  if (componentsPendingVersion === withdrawnUpdateVersion) return;
  withdrawnUpdateVersion = undefined;
  if (previousWindowDir && !updateLock.held) servedWindowDir = previousWindowDir;
  engineUpdateReady = true;
  sendToBranchWindows("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
  void autoApply.tick();
}

/** Staging never invokes the gateway's generic updater. */
async function stageComponentUpdate(): Promise<boolean> {
  if (!componentsReady) throw new Error("The desktop is still starting; check again when the engine is ready");
  const staged = await refreshComponentUpdate(cfg, fetch, { desktop: install, underSwapGuard, log });
  await offerStagedUpdate();
  return staged;
}

/** Swaps in a new window build: route and drafts are already kept by the window; the preload keeps scroll. */
async function hotSwapWindow(): Promise<void> {
  const windows = branchWindows().filter(w => w.webContents.getURL().startsWith(windowUrl()));
  if (!windows.length) return;
  // Attached files live only in memory; the swap waits until they are sent or removed.
  const deadline = Date.now() + 10 * 60_000;
  while (branchWindows().length && (await probeWindowState().catch(() => undefined))?.unsavedDraftFiles) {
    if (Date.now() >= deadline) { log("window swap postponed: unsent attachments remain"); return; }
    await pause(5_000);
  }
  await Promise.all(windows.filter(w => !w.isDestroyed()).map(async w => {
    const id = ++nextProbeId;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); ipcMain.off("branch-desktop:swap-ready", receive); resolve(); };
      const receive = (event: Electron.IpcMainEvent, replyId: unknown) => {
        if (replyId === id && event.sender === w.webContents) done();
      };
      const timer = setTimeout(done, 2_000);
      ipcMain.on("branch-desktop:swap-ready", receive);
      w.webContents.send("branch-desktop:prepare-swap", id);
    });
    if (!w.isDestroyed()) w.webContents.reload();
  }));
  log("window updated in place");
}

const STARTING = `data:text/html;charset=utf-8,${encodeURIComponent(
  "<!doctype html><title>Branch Agent</title><body style=\"-webkit-app-region:drag;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f6f7f8;color:#333\">Starting Branch…</body>",
)}`;

function createWindow(): BrowserWindow {
  // First launch opens maximized; later launches restore the last state, size, position and display.
  const place = placeWindow(readWindowState(cfg.dataDir), screen.getAllDisplays());
  const w = new BrowserWindow({
    title: TEST_COPY ? "Test — Branch Agent" : "Branch Agent",
    width: 1280,
    height: 840,
    ...place.bounds,
    show: false,
    icon: ICON,
    // Windows: no native title bar; the window's header carries the minimise, maximise and close buttons.
    ...titleBarOptions(),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Idle CPU: keep Chromium's throttling, except in the hidden test run where the page counts as hidden.
      backgroundThrottling: !HIDDEN,
    },
  });
  w.setMenuBarVisibility(false);
  if (place.maximized) w.once("show", () => w.maximize());
  w.on("show", () => fitWindowsOnScreen?.());
  if (TEST_COPY) w.on("page-title-updated", (event, title) => { event.preventDefault(); w.setTitle(`Test — ${title}`); });
  if (!HIDDEN && !QUIET && !TEST_COPY) w.once("ready-to-show", () => (place.maximized ? w.maximize() : w.show()));
  trackWindowState(w, cfg.dataDir, (bounds) => screen.getDisplayMatching(bounds).bounds);
  lockDown(w);
  w.on("closed", () => {
    if (win === w) win = undefined;
    if (!quitting && !controls.settings().keepWorking) {
      for (const child of conversationWindows.values()) if (!child.isDestroyed()) child.close();
      app.quit();
    }
  });
  tray = keepWindowResident(app, w, TRAY_ICON, {
    hidden: HIDDEN,
    keepRunning: () => controls.settings().keepWorking,
    // With the usage ring in the tray, a click opens the same list (Settings › Usage).
    onTrayClick: () => { if (controls.settings().trayUsage) w.webContents.send("branch-desktop:open-usage"); },
  });
  return w;
}

/** A conversation gets its own frame and URL, while sharing the running engine with the main window. */
function openConversationWindow(key: string): void {
  const existing = conversationWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    if (!HIDDEN) { existing.show(); existing.focus(); }
    return;
  }
  const url = new URL(windowUrl());
  url.searchParams.set("conversation", key);
  const saved = readWindowState(cfg.dataDir, conversationStateFile(key));
  const place = saved ? placeWindow(saved, screen.getAllDisplays()) : undefined;
  const mainWidth = win && !win.isDestroyed() ? win.getBounds().width : 1280;
  const child = new BrowserWindow({
    title: TEST_COPY ? "Test — Branch Agent" : "Branch Agent",
    width: Math.max(560, mainWidth - 292),
    height: win && !win.isDestroyed() ? win.getBounds().height : 760,
    ...(place?.bounds ?? {}),
    show: false,
    icon: ICON,
    ...titleBarOptions(),
    webPreferences: {
      preload: join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: !HIDDEN,
    },
  });
  pendingSavedConversationKeys = pendingSavedConversationKeys.filter((saved) => saved !== key);
  conversationWindows.set(key, child);
  saveConversationWindows();
  child.on("closed", () => {
    const current = [...conversationWindows].find(([, window]) => window === child)?.[0];
    if (current) { conversationWindows.delete(current); if (!quitting) saveConversationWindows(); }
  });
  child.webContents.on("did-finish-load", () => offerWindowStatus(child));
  if (place?.maximized) child.once("show", () => child.maximize());
  child.on("show", () => fitWindowsOnScreen?.());
  trackWindowState(child, cfg.dataDir, (bounds) => screen.getDisplayMatching(bounds).bounds,
    () => conversationStateFile([...conversationWindows].find(([, window]) => window === child)?.[0] ?? key));
  child.setMenuBarVisibility(false);
  lockDown(child);
  if (!HIDDEN) child.once("ready-to-show", () => child.show());
  void child.loadURL(url.toString()).catch((error: unknown) => {
    log(`conversation window failed to load: ${String(error)}`);
    child.destroy();
  });
}

/** The window may only show the served window's origin; links open in the default browser. */
function lockDown(w: BrowserWindow): void {
  const origin = `http://127.0.0.1:${cfg.windowPort}`;
  w.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== origin) e.preventDefault();
  });
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

const windowUrl = (): string => `http://127.0.0.1:${cfg.windowPort}/`;

/**
 * At a natural launch only: the helper swaps a staged desktop app in once this process has exited, then relaunches
 * it. A running app never restarts itself for a desktop update.
 */
async function handOffDesktop(): Promise<boolean> {
  if (!install || !await handOffDesktopUpdate(cfg, install, join(__dirname, "desktop-update-helper.js"), process.argv.slice(1), false)) return false;
  log("desktop update staged; handing off to the update helper and quitting");
  return true;
}

async function start(): Promise<void> {
  // A desktop update staged during the last run applies before anything starts.
  if (await handOffDesktop()) { app.exit(0); return; }
  token = readToken(cfg);
  // Registered before any page loads: the preload asks for it synchronously.
  ipcMain.on("branch-desktop:info", (e) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    const served = Boolean(owner && branchWindows().includes(owner) && e.senderFrame === e.sender.mainFrame && e.sender.getURL().startsWith(windowUrl()));
    if (served) windowPort = gatewayPort;
    e.returnValue = served ? { gatewayUrl: gatewayUrl(), gatewayToken: token } : null;
  });
  // Diagnostics: the window's UI events go to ui-events.log, and a report bundles the recent logs.
  const uiLog = new RotatingLog(join(cfg.dataDir, "ui-events.log"));
  const fromServedWindow = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    return Boolean(owner && branchWindows().includes(owner) && e.senderFrame === e.sender.mainFrame && e.sender.getURL().startsWith(windowUrl()));
  };
  ipcMain.on("branch-desktop:ui-event", (e, raw: unknown) => {
    if (!fromServedWindow(e)) return;
    try {
      const line = uiEventLine(raw, new Date().toISOString());
      if (line) uiLog.append(line);
    } catch {
      // Diagnostics must never stop the app.
    }
  });
  ipcMain.handle("branch-desktop:report-problem", async (e, minutes: unknown) => {
    if (!fromServedWindow(e)) return { saved: false };
    const span = typeof minutes === "number" && Number.isFinite(minutes) ? Math.min(240, Math.max(1, Math.round(minutes))) : 30;
    const now = new Date();
    const cutoff = now.getTime() - span * 60_000;
    const ui = uiLog.paths().reverse().map((file) => readTail(file, REPORT_TAIL_BYTES)).join("\n");
    const entries = [
      { name: "desktop.log", text: readTail(join(cfg.dataDir, "desktop.log"), REPORT_TAIL_BYTES) },
      { name: "gateway.log", text: readTail(join(cfg.dataDir, "gateway.log"), REPORT_TAIL_BYTES) },
      { name: "ui-events.log", text: ui },
    ].map((source) => ({ name: source.name, data: Buffer.from(`${recentLines(source.text, cutoff).join("\n")}\n`, "utf8") }));
    entries.push({ name: "README.txt", data: Buffer.from(reportReadme(span, now.toISOString()), "utf8") });
    const archive = zipStored(entries, now);
    const owner = BrowserWindow.fromWebContents(e.sender);
    const options = {
      defaultPath: `branch-problem-report-${now.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.zip`,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    };
    const picked = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    if (picked.canceled || !picked.filePath) return { saved: false };
    writeFileSync(picked.filePath, archive);
    return { saved: true, bytes: archive.length };
  });
  ipcMain.handle("branch-desktop:open-conversation", (e, key: unknown) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    if (!owner || (owner !== win && ![...conversationWindows.values()].includes(owner)) || !isOwnedComponentWindow(e, owner.webContents, windowUrl())) {
      throw new Error("Only a Branch window can open a conversation window");
    }
    if (typeof key !== "string" || !key.trim()) throw new Error("A conversation key is required");
    openConversationWindow(key);
  });
  ipcMain.handle("branch-desktop:conversation-windows", (e) => {
    if (!isOwnedComponentWindow(e, win?.webContents, windowUrl())) throw new Error("Only the main Branch window can list conversation windows");
    return [...conversationWindows.keys()];
  });
  ipcMain.handle("branch-desktop:saved-conversation-windows", (e) => {
    if (!isOwnedComponentWindow(e, win?.webContents, windowUrl())) throw new Error("Only the main Branch window can restore conversation windows");
    return [...pendingSavedConversationKeys];
  });
  ipcMain.handle("branch-desktop:restore-conversation-windows", (e, valid: unknown, deferred: unknown = []) => {
    if (!isOwnedComponentWindow(e, win?.webContents, windowUrl())) throw new Error("Only the main Branch window can restore conversation windows");
    if (!Array.isArray(valid) || !valid.every((key) => typeof key === "string") || !Array.isArray(deferred) || !deferred.every((key) => typeof key === "string")) throw new Error("Invalid saved conversations");
    const pending = new Set(pendingSavedConversationKeys);
    const restore = valid.filter((key: string) => pending.has(key) && !conversationWindows.has(key));
    const retry = deferred.filter((key: string) => pending.has(key) && !valid.includes(key));
    const keep = new Set<string>([...restore, ...retry]);
    for (const key of pendingSavedConversationKeys) {
      if (!keep.has(key)) {
        try { unlinkSync(join(cfg.dataDir, conversationStateFile(key))); } catch { /* no saved bounds */ }
      }
    }
    pendingSavedConversationKeys = retry;
    for (const key of restore) openConversationWindow(key);
    saveConversationWindows();
  });
  ipcMain.handle("branch-desktop:forget-conversation-window", (e, key: unknown) => {
    const contents = ownedWebContents(e.sender);
    if (!contents || !isOwnedComponentWindow(e, contents, windowUrl())) throw new Error("Only a Branch window can forget a conversation window");
    if (typeof key !== "string" || !key.trim()) throw new Error("A conversation key is required");
    pendingSavedConversationKeys = pendingSavedConversationKeys.filter((saved) => saved !== key);
    const child = conversationWindows.get(key);
    if (child) {
      conversationWindows.delete(key);
      // Let a deleting pop-out receive its IPC answer before its renderer goes away.
      setTimeout(() => { if (!child.isDestroyed()) child.destroy(); }, 0);
    }
    try { unlinkSync(join(cfg.dataDir, conversationStateFile(key))); } catch { /* no saved bounds */ }
    saveConversationWindows();
  });
  ipcMain.handle("branch-desktop:open-main-route", (e, route: unknown) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    if (!owner || ![...conversationWindows.values()].includes(owner) || !isOwnedComponentWindow(e, owner.webContents, windowUrl())) {
      throw new Error("Only a conversation window can open the main window");
    }
    if (!route || typeof route !== "object" || !["chat", "place", "settings"].includes(String((route as { kind?: unknown }).kind))) {
      throw new Error("Invalid destination");
    }
    if (!win || win.isDestroyed()) throw new Error("The main window is not available");
    if (win.isMinimized()) win.restore();
    win.show(); win.focus();
    win.webContents.send("branch-desktop:open-main-route", route);
  });
  ipcMain.handle("branch-desktop:close-conversation-window", (e) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    if (!owner || ![...conversationWindows.values()].includes(owner) || !isOwnedComponentWindow(e, owner.webContents, windowUrl())) {
      throw new Error("Only a conversation window can close itself");
    }
    owner.close();
  });
  ipcMain.handle("branch-desktop:retarget-conversation-window", (e, key: unknown) => {
    const owner = BrowserWindow.fromWebContents(e.sender);
    if (!owner || ![...conversationWindows.values()].includes(owner) || !isOwnedComponentWindow(e, owner.webContents, windowUrl())) {
      throw new Error("Only a conversation window can change its conversation");
    }
    if (typeof key !== "string" || !key.trim()) throw new Error("A conversation key is required");
    const previous = [...conversationWindows].find(([, child]) => child === owner)?.[0];
    if (!previous || previous === key) return;
    const other = conversationWindows.get(key);
    if (other && other !== owner && !other.isDestroyed()) throw new Error("That conversation already has a window");
    conversationWindows.delete(previous);
    conversationWindows.set(key, owner);
    try { unlinkSync(join(cfg.dataDir, conversationStateFile(previous))); } catch { /* no saved bounds */ }
    saveConversationWindows();
  });
  ipcMain.on("branch-desktop:restart-engine", e => { if (isOwnedComponentWindow(e, ownedWebContents(e.sender), windowUrl())) void restartEngine(); });
  ipcMain.on("branch-desktop:dismiss-update-notice", e => {
    if (isOwnedComponentWindow(e, ownedWebContents(e.sender), windowUrl())) updateNotice = undefined;
  });
  ipcMain.on("branch-desktop:update-notice", (e, event: unknown, notice: unknown) => {
    if (!isOwnedComponentWindow(e, ownedWebContents(e.sender), windowUrl())) return;
    if (event !== "shown" && event !== "dismissed" && event !== "expired" && event !== "undo") return;
    const rec = notice && typeof notice === "object" ? notice as { version?: unknown; canUndo?: unknown } : {};
    const version = typeof rec.version === "string" ? rec.version : "";
    if (event === "shown") log(`update notice shown version=${version} canUndo=${rec.canUndo === true}`);
    else log(`update notice ${event}`);
    if (event === "dismissed" || event === "expired") updateNotice = undefined;
  });
  ipcMain.on("branch-desktop:undo-update", e => {
    if (isOwnedComponentWindow(e, ownedWebContents(e.sender), windowUrl())) void undoLastUpdate();
  });
  registerComponentUpdateIpc(ipcMain, e => ownedWebContents(e.sender), windowUrl(), componentUpdates);
  registerDesktopControlsIpc(ipcMain, e => ownedWebContents(e.sender), windowUrl(), controls);
  registerTitleBarIpc(ipcMain, () => win?.webContents, windowUrl(), (overlay) => win?.setTitleBarOverlay(overlay));
  ipcMain.on("branch-desktop:title-bar", (event, value) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || ![...conversationWindows.values()].includes(owner) || !isOwnedComponentWindow(event, owner.webContents, windowUrl())) return;
    const overlay = parseTitleBarOverlay(value);
    if (overlay) owner.setTitleBarOverlay(overlay);
  });
  registerClipboardIpc(ipcMain, e => ownedWebContents(e.sender), windowUrl(), clipboard);
  controls.apply();
  fitWindowsOnScreen = keepWindowsOnScreen(screen, branchWindows);
  win = createWindow();
  await win.loadURL(STARTING);
  log(`starting page shown after ${Date.now() - launchStarted} ms`);
  const desktopVersion = await confirmDesktopUpdate(cfg);
  if (desktopVersion) log(`desktop update ${desktopVersion} started; confirmed`);
  // Engines the last session started and left running (a crash mid-update): retire them before starting our own.
  await retireRecordedEngines(cfg.dataDir, log);
  for (const port of [cfg.gatewayPort, cfg.windowPort]) {
    if (!(await portIsFree(port))) throw new Error(`port ${port} is already in use; is Branch Agent already running?`);
  }
  await refuseOrphanedEngine();
  adoptGatewayPort(cfg.gatewayPort);
  await recoverComponentUpdate(cfg);
  if (!existsSync(join(cfg.windowDir, "index.html")) || !existsSync(join(cfg.dataDir, "engine-current.txt")) && !existsSync(join(cfg.engineDir, "branch.mjs"))) {
    log("Installing verified GitHub components for first launch");
    await refreshComponentUpdate(cfg, fetch, { desktop: install, underSwapGuard, log });
  }
  servedWindowDir = cfg.windowDir;
  server = await serveWindow(() => servedWindowDir, cfg.windowPort);
  await win.loadURL(windowUrl());
  log(`window loaded after ${Date.now() - launchStarted} ms`);
  if (await bootSelectedEngine()) {
    await win.loadURL(windowUrl());
    log("Reloaded retained window after component rollback");
  }
  // Quit can run after the gateway becomes ready but before this startup continuation resumes.
  if (quitting) return;
  watchUpdates(win);
  componentsReady = true;
  runConfirmedReleasePrune();
  autoApply.start();
  stopComponentWatch = watchComponentUpdates(cfg, log, { desktop: install, underSwapGuard, log,
    onWithdrawal: version => {
      withdrawnUpdateVersion = version;
      engineUpdateReady = false;
      sendToBranchWindows("branch-desktop:engine-update", "kept");
    }, onStaged: () => {
    offerStagedUpdate().catch(error => log(`Component update status: ${String(error)}`));
  } });
  if (macComputerDriver) {
    let enabled = screenControlEnabled();
    let granted = enabled && macComputerDriver.permissionsGranted(resolveEngineDir(cfg));
    const timer = setInterval(() => {
      if (updateLock.held) return;
      const nextEnabled = screenControlEnabled();
      const nextGranted = nextEnabled && macComputerDriver.permissionsGranted(resolveEngineDir(cfg));
      if (nextEnabled !== enabled || nextGranted && !granted) {
        enabled = nextEnabled;
        granted = nextGranted;
        void restartEngine();
      } else { enabled = nextEnabled; granted = nextGranted; }
    }, 3_000);
    timer.unref();
    app.once("will-quit", () => clearInterval(timer));
  }
}

/**
 * After an in-place update the engine can serve on a moved port. If the desktop crashed then, that engine is still
 * running and holds the state: starting another one would wait on its lock, so say so plainly instead.
 */
async function refuseOrphanedEngine(): Promise<void> {
  const read = (name: string) => { try { return Number(readFileSync(join(cfg.dataDir, name), "utf8").trim()); } catch { return 0; } };
  const port = read("gateway-port"), pid = read("gateway.pid");
  if (!Number.isInteger(port) || port <= 0 || port === cfg.gatewayPort || !Number.isInteger(pid) || pid <= 0) return;
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (error) { alive = (error as NodeJS.ErrnoException).code === "EPERM"; }
  if (!alive || await portIsFree(port)) return;
  throw new Error(`Branch Agent's engine from the last session is still running (process ${pid} on port ${port}). End that process in Task Manager or Activity Monitor, or restart the computer, then open Branch Agent again.`);
}

async function waitForGatewayPort(): Promise<void> {
  for (let i = 0; i < 40 && !(await portIsFree(gatewayPort)); i++) await pause(250);
}

/** Starts the gateway, waits until it is ready, and watches its build for a newer one. */
async function bootEngine(engineDir = resolveEngineDir(cfg), confirmUpdate = true, prepared?: PreparedGateway, port = prepared?.port ?? gatewayPort,
  options: { readyTimeoutMs?: number; keepOnConfirmFailure?: boolean } = {}): Promise<void> {
  const started = Date.now();
  if (macComputerDriver && !screenControlEnabled()) await macComputerDriver.stop();
  const macComputerEndpoint = await (!prepared && screenControlEnabled() ? macComputerDriver?.start(engineDir) : undefined)?.catch(error => {
    log(`Mac computer driver unavailable: ${describeDriverError(error)}`);
    return undefined;
  });
  const child = prepared?.child ?? startGateway(cfg, engineDir, token, false, port, macComputerEndpoint);
  if (prepared?.child.pid !== undefined) writeFileSync(join(cfg.dataDir, "gateway.pid"), String(prepared.child.pid));
  if (prepared) {
    setEnginePriority(prepared.child, false);
    // The old engine has released the state: the standby takes over only on this word (#411).
    sendStandbyTakeOver(prepared.child);
  }
  gateway = child;
  const observed = gatewaySupervisor.observe(child);
  log(`gateway started from ${engineDir}, pid ${child.pid}, port ${port}`);
  // publish-engine.sh never removes the folder named here.
  writeFileSync(join(cfg.dataDir, "engine-running.txt"), `${engineDir}
`);
  // Ready means listening on its own port and answering /readyz there; only then does the window follow it.
  await waitForReady({ ...cfg, gatewayPort: port }, child, options.readyTimeoutMs ?? READY_TIMEOUT_MS);
  // Only a confirmed engine moves the live port: a rollback reboots on the port the window already uses.
  // A handoff's standby that is ready owns the state, channels and cron: a failed confirmation never rolls it back.
  if (confirmUpdate) {
    try {
      pendingReleasePrune = await confirmComponentUpdate(cfg, error => log(`Confirmed update cleanup: ${String(error)}`), true);
    } catch (error) {
      if (!options.keepOnConfirmFailure) throw error;
      log(`the new engine serves but its update could not be confirmed (${String(error)}); keeping it`);
    }
  }
  adoptGatewayPort(port);
  lastGoodEngineDir = engineDir;
  readyGateway = child;
  observed.ready();
  gatewayRecoveryError = undefined;
  log(`gateway ready after ${Date.now() - started} ms; launch elapsed ${Date.now() - launchStarted} ms`);
  if (componentsReady) runConfirmedReleasePrune();
  if (confirmUpdate) engineUpdateReady = false;
  if (!quitting) watchEngine();
}

/** Watches the engine pointer and build from their current value (re-armed after a rejected candidate's rollback). */
let engineWatchGeneration = 0;
function watchEngine(): void {
  const generation = ++engineWatchGeneration;
  stopEngineWatch?.();
  stopEngineWatch = watchEngineBuild(() => engineSignature(cfg), () => {
    if (generation !== engineWatchGeneration || updateLock.purpose === "undo update") return;
    // Undo's temporary pointer is not a new build.
    log("new engine build found; offering Update");
    void readComponentUpdateStatus(cfg).then(({ componentsPendingVersion }) => {
      if (generation !== engineWatchGeneration || updateLock.purpose === "undo update") return;
      if (componentsPendingVersion) return offerStagedUpdate();
      if (withdrawnUpdateVersion) return;
      engineUpdateReady = true;
      sendToBranchWindows("branch-desktop:engine-update", "ready");
    }).catch(error => log(`Engine build status: ${String(error)}`));
  });
}

/** A failed newly published build restores the prior pointer/window before booting the retained engine. */
async function bootSelectedEngine(prepared?: PreparedGateway): Promise<boolean> {
  const selectedEngine = resolveEngineDir(cfg);
  return bootSelectedEngineWithRollback({
    boot: async () => {
      const selected = prepared;
      prepared = undefined;
      if (!selected) return bootEngine(resolveEngineDir(cfg), true);
      try { await bootEngine(resolveEngineDir(cfg), true, selected); }
      catch (error) {
        // Something else took the standby's spare port before the engine could bind it: not the release's fault.
        const exited = selected.child.exitCode !== null || selected.child.signalCode !== null;
        if (!exited || await portIsFree(selected.port)) throw error;
        log(`standby port ${selected.port} was taken before the engine could bind it; starting on port ${gatewayPort}`);
        await waitForGatewayPort();
        if (quitting) throw error;
        await bootEngine(resolveEngineDir(cfg), true);
      }
    },
    stopFailedGateway: async () => { if (gateway) await stopFailedEngine(gateway); },
    recordTimeout: () => recordComponentUpdateTimeout(cfg, selectedEngine),
    rejectExited: () => rejectFailedComponentUpdate(cfg, selectedEngine),
    rollback: () => rollbackComponentUpdate(cfg),
    waitForPortRelease: waitForGatewayPort,
    quitting: () => quitting,
    log,
  });
}

/** The window build the open window last loaded; the watcher never reloads onto the same build. */
let shownWindowBuild: string | undefined;
function watchUpdates(w: BrowserWindow): void {
  shownWindowBuild = windowBuild(servedWindowDir);
  stopWindowWatch = watchWindowBuild(cfg.windowDir, () => {
    void readComponentUpdateStatus(cfg).then(({ publicationInProgress }) => {
      // A staged engine/window pair activates together through the in-place swap.
      if (publicationInProgress || updateLock.held) return;
      // The window already shows this build (a staged pair was put back, or rolled back to the build it runs).
      if (windowBuild(servedWindowDir) === shownWindowBuild) return;
      log("new window build found; swapping it in");
      void hotSwapWindow();
    }).catch(error => log(`Window update status: ${String(error)}`));
  });
  // A reload re-runs the preload; show the bar again if an engine update is still waiting.
  w.webContents.on("did-finish-load", () => { shownWindowBuild = windowBuild(servedWindowDir); offerWindowStatus(w); });
}
function offerWindowStatus(w: BrowserWindow): void {
  if (w.isDestroyed() || !w.webContents.getURL().startsWith(windowUrl())) return;
  if (engineUpdateReady) w.webContents.send("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
  if (gatewayRecoveryError) w.webContents.send("branch-desktop:gateway-recovery-failed", gatewayRecoveryError);
  if (updateNotice && updateNotice.expiresAt > Date.now()) w.webContents.send("branch-desktop:update-applied", updateNotice);
}

/** Undo owns the same lock as update, recovery and staged-release replacement, including its publication moves. */
async function undoLastUpdate(): Promise<void> {
  const lock = updateLock.acquire("undo update");
  if (!lock) {
    sendToBranchWindows("branch-desktop:update-undo-failed", "An update is finishing, try again in a moment");
    return;
  }
  try {
    if (!gateway || !engineServing()) throw new Error("The engine is not ready to switch");
    const active = await gatewayActivity(gateway);
    const window = await probeWindowState();
    if (active.activeRuns || active.totalActive || active.pendingReplies || window.pendingApprovals ||
        window.streaming || window.unsavedDraftFiles) throw new Error("The previous version cannot take over while work is running");
    if (!await prepareComponentUpdateUndo(cfg, dir => { servedWindowDir = dir; })) throw new Error("The previous version is no longer available");
    const previousVersion = (await readComponentUpdateStatus(cfg)).componentsPendingVersion;
    await swapEngineInPlace("previous version", true, lock);
    if ((await readComponentUpdateStatus(cfg)).currentVersion !== previousVersion) throw new Error("The previous version could not take over");
    await confirmComponentUpdateUndo(cfg);
    updateNotice = undefined;
    sendToBranchWindows("branch-desktop:update-undone");
  } catch (error) {
    try { await rollbackComponentUpdateUndo(cfg); }
    catch (rollbackError) { log(`update undo rollback failed: ${String(rollbackError)}`); }
    if (!existsSync(servedWindowDir)) servedWindowDir = cfg.windowDir;
    log(`update undo failed: ${String(error)}`);
    sendToBranchWindows("branch-desktop:update-undo-failed", String(error));
  } finally {
    // Boot may have re-armed the watcher on Undo's temporary pointer; seed it from the final pointer.
    if (stopEngineWatch) watchEngine();
    await updateLock.release(lock);
  }
}

/** The owner's Update click: applies a staged engine/window pair, or a rebuilt engine, in place. */
async function restartEngine(): Promise<void> {
  if (!gateway || !win || !componentsReady) return;
  if (updateLock.held) {
    if (updateLock.purpose === REPLACING && !updateClickQueued) {
      // A newer release is replacing the staged one: the click is kept and runs right after, on the newer release.
      updateClickQueued = true;
      log("update requested while a newer release replaces the staged one; it runs right after");
      sendToBranchWindows("branch-desktop:engine-update", "preparing");
    }
    return;
  }
  if (!engineServing()) {
    // A crash restart wins: the click never cancels it. If recovery already gave up, the click retries it now.
    log("update requested while the engine is restarting; recovery runs first");
    gatewaySupervisor.recover(new Error("the engine was not running when Update was clicked"));
    return;
  }
  const staged = (await readComponentUpdateStatus(cfg)).componentsPendingVersion;
  if (staged && staged === withdrawnUpdateVersion) {
    log(`update requested for withdrawn release ${staged}; keeping the running engine`);
    sendToBranchWindows("branch-desktop:engine-update", "kept");
    return;
  }
  log(`update requested (${staged ?? "rebuilt engine"}); old engine pid ${gateway.pid}`);
  try { await swapEngineInPlace(staged ?? "rebuilt engine", true); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`update failed: ${msg}`);
    if (!quitting && !engineRunning() && !HIDDEN) dialog.showErrorBox("Branch couldn't finish the update", msg);
  }
}

/** Quitting stops an idle engine cleanly, so the next launch skips the stale-lease integrity pass. */
let quitAfterCleanStop = false;
function deferQuitForCleanStop(event: Electron.Event | undefined): boolean {
  if (quitAfterCleanStop || !gateway || !engineRunning() || typeof event?.preventDefault !== "function") return false;
  event.preventDefault();
  quitting = true;
  quitAfterCleanStop = true;
  gatewaySupervisor.close();
  stopGatewayCleanly(gateway, 15_000).then(() => log("gateway stopped cleanly for quit"),
    error => log(`quit: clean stop skipped: ${error instanceof Error ? error.message : String(error)}`)).finally(() => app.quit());
  return true;
}

function shutdown(): void {
  quitting = true;
  log(`quit; stopping gateway pid ${gateway?.pid}`);
  gatewaySupervisor.close();
  stopEngineWatch?.();
  stopComponentWatch?.();
  autoApply.stop();
  stopWindowWatch?.();
  controls.dispose();
  stopCandidate();
  stopWarmingStandby();
  // A quit mid-handoff stops the stepped-down engine too; a crash leaves its record for the next launch.
  for (const child of retiring.keys()) stopGateway(child);
  if (standby) stopGateway(standby.child);
  standby = undefined;
  if (gateway) stopGateway(gateway);
  clearEngineRecords(cfg.dataDir);
  void macComputerDriver?.stop();
  server?.close();
  // The next launch starts on the configured port; never leave a moved, dead port for the branch command to dial.
  writeGatewayPortFile(cfg.gatewayPort);
}

if (!app.requestSingleInstanceLock()) {
  log("another Branch Agent window is open; quitting");
  app.quit();
} else {
  app.on("before-quit", () => { quitting = true; });
  app.on("second-instance", () => {
    if (win && !win.isDestroyed() && !HIDDEN) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.on("activate", () => {
    if (win && !win.isDestroyed() && !HIDDEN) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", (event?: Electron.Event) => { if (!deferQuitForCleanStop(event)) shutdown(); });
  app.whenReady().then(start).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`could not start: ${msg}`);
    if (!HIDDEN) dialog.showErrorBox("Branch Agent could not start", msg);
    app.quit();
  });
}
