// Branch Agent desktop app: starts the engine gateway, serves the built window on 127.0.0.1 and shows it.
import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, session, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { engineSignature, loadConfig, resolveEngineDir, type DesktopConfig } from "./config";
import { drainStopGateway, gatewayActivity, portIsFree, prepareStandbyGateway, readToken, setEnginePriority, startGateway, stopGateway, stopGatewayCleanly, stopWarmingStandby, waitForGatewayExit, waitForReady, type PreparedGateway } from "./gateway";
import { readPreparedNormalProfile } from "./profile-migration";
import { createGatewayCrashSupervisor } from "./gateway-supervisor";
import { serveWindow } from "./static-server";
import { watchEngineBuild, watchWindowBuild } from "./updates";
import { keepWindowResident } from "./resident-window";
import { confirmComponentUpdate, readComponentUpdateStatus, recordComponentUpdateTimeout, recoverComponentUpdate, refreshComponentUpdate, rejectFailedComponentUpdate, rollbackComponentUpdate, watchComponentUpdates } from "./component-update";
import { bootSelectedEngineWithRollback } from "./boot-selected-engine";
import { createComponentUpdateController, isOwnedComponentWindow, registerComponentUpdateIpc } from "./component-update-ipc";
import { createDesktopControls, readSettings, registerDesktopControlsIpc } from "./desktop-controls";
import { desktopOs, START_IN_TRAY } from "./desktop-os";
import { parseTitleBarOverlay, registerTitleBarIpc, titleBarOptions } from "./title-bar";
import { registerClipboardIpc } from "./clipboard-ipc";
import { placeWindow, readWindowState, trackWindowState } from "./window-state";
import { confirmDesktopUpdate, handOffDesktopUpdate, type DesktopInstall } from "./desktop-update";
import { createAutoApplyUpdate } from "./auto-apply-update";
import { checkCandidateBeside, stopCandidate } from "./candidate-check";
import { freemem } from "node:os";
import { createHash } from "node:crypto";
import type { Tray } from "electron";

const HIDDEN = process.env.BRANCH_DESKTOP_HIDDEN === "1";
/** Scratch test copies: never grouped with, or mistaken for, the owner's app (they also start hidden). */
const TEST_COPY = process.env.BRANCH_DESKTOP_TEST === "1";
/** Started with Windows: open quietly in the tray (only where the tray exists). */
const QUIET = process.platform === "win32" && process.argv.includes(START_IN_TRAY);
const ICON = process.platform === "win32"
  ? join(__dirname, "..", "assets", "branch.ico")
  : join(__dirname, "..", "assets", "brand", "linux", "branch-48.png");
// Electron loads branch-16@2x.png automatically for Retina menu bars.
const TRAY_ICON = process.platform === "darwin"
  ? join(__dirname, "..", "assets", "brand", "linux", "branch-16.png")
  : ICON;
/** Tests shorten it with BRANCH_DESKTOP_READY_TIMEOUT_MS. */
const READY_TIMEOUT_MS = Number(process.env.BRANCH_DESKTOP_READY_TIMEOUT_MS ?? 600_000);
/** A standby only loads code before it reports warm; one that takes longer is stopped and the old engine keeps serving. */
const STANDBY_WARM_TIMEOUT_MS = 120_000;
/** Failed standbys per update before the guarded stop/start swap takes over, so an update never becomes impossible. */
const STANDBY_ATTEMPTS = 2;
/** Free memory a candidate check needs (6 GB, the shared load rule); tests lower it with BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB. */
const CANDIDATE_MIN_FREE_BYTES = Number(process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB ?? 6144) * 2 ** 20;
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
let server: Server | undefined;
let win: BrowserWindow | undefined;
const conversationWindows = new Map<string, BrowserWindow>();
const branchWindows = (): BrowserWindow[] => [win, ...conversationWindows.values()].filter((w): w is BrowserWindow => Boolean(w && !w.isDestroyed()));
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
function saveConversationWindows(): void {
  try { writeFileSync(conversationWindowFile, JSON.stringify([...conversationWindows.keys()])); } catch { /* a window remains usable without persistence */ }
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
/** The window build the static server serves: the staged one only once its engine runs. */
let servedWindowDir = cfg.windowDir;
let engineRestartInProgress = false;
/** The engine exited while an update ran: the update's end decides, then recovery runs once with a full budget. */
let recoveryDeferred = false;
let quitting = false;
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
    if (engineRestartInProgress) { recoveryDeferred = true; log("gateway exit during an update; recovery waits for it"); return; }
    if (engineRunning()) return;
    engineRestartInProgress = true;
    try {
      await waitForGatewayPort();
      // The selected pointer may already name a staged update. Recover the build that exited;
      // only the normal update path may validate and confirm the staged engine/window pair.
      const engineDir = lastGoodEngineDir ?? readFileSync(join(cfg.dataDir, "engine-running.txt"), "utf8").trim();
      await bootEngine(engineDir, false, undefined, await recoveryPort());
      handWindowToGateway();
      log("gateway recovered after unexpected exit");
    } catch (error) {
      if (gateway) stopGateway(gateway);
      throw error;
    } finally {
      engineRestartInProgress = false;
    }
  },
});
const componentUpdates = createComponentUpdateController(cfg, { stage: stageComponentUpdate });
let tray: Tray | undefined;
const controls = createDesktopControls({ ...desktopOs(app, cfg, () => tray, ICON), onChange: settings => {
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
async function swapEngineInPlace(label: string, explicit: boolean): Promise<void> {
  if (!gateway || !win || engineRestartInProgress) throw new Error("The desktop is not ready to update");
  engineRestartInProgress = true;
  gatewaySupervisor.cancelPending();
  const windowBefore = windowBuild(servedWindowDir);
  const priorGateway = gateway;
  const stillOpen = () => { if (quitting) throw new Error("Branch Agent is quitting"); };
  try {
    if (!await candidatePassed(label)) return;
    await prepareUpdateStandby(label, explicit);
    stillOpen();
    const started = Date.now();
    sendToBranchWindows("branch-desktop:engine-update", "updating");
    const priorGateway = gateway;
    const resumeSupervision = gatewaySupervisor.expectExit(priorGateway);
    try {
      if (explicit) log(`update ${label}: old engine ${await drainStopGateway(priorGateway)}`);
      else await stopGatewayCleanly(priorGateway);
    } catch (error) {
      resumeSupervision();
      throw error;
    }
    const stopped = Date.now();
    stillOpen();
    servedWindowDir = cfg.windowDir;
    await waitForGatewayPort();
    stillOpen();
    const selectedStandby = standby;
    standby = undefined;
    const rolledBack = await bootSelectedEngine(selectedStandby);
    log(`update ${label}: engine ${rolledBack ? "rolled back" : "swapped"} in place; stop ${stopped - started} ms, start ${Date.now() - stopped} ms, app and window kept open`);
    engineUpdateReady = false;
    if (rolledBack) {
      sendToBranchWindows("branch-desktop:engine-update", "kept");
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
    sendToBranchWindows("branch-desktop:engine-update-failed", message);
    // Still serving only if the engine from before the update is the one running: a new engine that failed may
    // not have exited yet, and it never became ready.
    if (gateway === priorGateway && engineRunning()) {
      recoveryDeferred = false;
      const state = controls.settings().autoApplyUpdates && !autoApplyWaitsForOwner(label) ? "auto-wait" : "ready";
      sendToBranchWindows("branch-desktop:engine-update", state);
    } else {
      const failed = gateway;
      if (failed && failed !== priorGateway && engineRunning()) {
        stopGateway(failed);
        await waitForGatewayExit(failed, 15_000).catch(() => undefined);
      }
      // Never leave zero engines: the crash supervisor brings back the build that last ran, with a fresh budget.
      recoveryDeferred = false;
      gatewaySupervisor.recover(new Error(`the update failed with no engine serving: ${message}`));
    }
    throw error;
  } finally {
    engineRestartInProgress = false;
    // The engine exited during an update that still ended with nothing serving.
    if (recoveryDeferred && !quitting) {
      recoveryDeferred = false;
      if (!engineRunning()) gatewaySupervisor.recover(new Error("the engine exited during an update"));
    }
  }
}

/**
 * Warms the update's standby on a spare port while the current engine keeps serving. With no room for it, an
 * unmigrated profile, or after STANDBY_ATTEMPTS failures for this update, the guarded stop/start swap runs instead.
 * A failed standby is already stopped and nothing else is: the current engine keeps serving.
 */
async function prepareUpdateStandby(label: string, explicit: boolean): Promise<void> {
  if (freemem() < CANDIDATE_MIN_FREE_BYTES || !standbyProfileReady()) return;
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
 * A staged engine first starts beside the running one (spare port, scratch state). One that exits is rejected and its
 * publication rolled back with nothing stopped; a slow one still gets the normal swap and its readiness rollback.
 */
let candidateCheckedFor: string | undefined;
async function candidatePassed(label: string): Promise<boolean> {
  const version = (await readComponentUpdateStatus(cfg)).componentsPendingVersion;
  if (!version || candidateCheckedFor === version) return true;
  // The machine-load rule: a second engine only when there is room for it; otherwise the plain swap with its rollback.
  if (freemem() < CANDIDATE_MIN_FREE_BYTES) { log(`update ${label}: candidate check skipped; ${Math.round(freemem() / 2 ** 20)} MB free`); return true; }
  const candidate = resolveEngineDir(cfg);
  sendToBranchWindows("branch-desktop:engine-update", "preparing");
  const started = Date.now();
  const result = await checkCandidateBeside(cfg, candidate, token, READY_TIMEOUT_MS);
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
  pendingVersion: async () => (await readComponentUpdateStatus(cfg)).componentsPendingVersion,
  enabled: () => controls.settings().autoApplyUpdates,
  activity: async () => {
    if (!gateway) throw new Error("The gateway is not running");
    // The approval RPCs themselves count as gateway work; sample after they settle.
    const window = await probeWindowState();
    const engine = await gatewayActivity(gateway);
    return { activeRuns: Math.max(engine.activeRuns, engine.totalActive), pendingApprovals: window.pendingApprovals,
      streaming: engine.pendingReplies > 0 || window.streaming, unsavedDraftFiles: window.unsavedDraftFiles };
  },
  restart: version => swapEngineInPlace(version, false),
  log,
});

/**
 * A staged engine/window pair waits for the in-place swap; until then the window server keeps serving the build
 * the running engine started with. A staged desktop app only waits for the next launch, so it offers nothing.
 */
async function offerStagedUpdate(): Promise<void> {
  const { componentsPendingVersion, previousWindowDir } = await readComponentUpdateStatus(cfg);
  if (!componentsPendingVersion) return;
  if (previousWindowDir && !engineRestartInProgress) servedWindowDir = previousWindowDir;
  engineUpdateReady = true;
  sendToBranchWindows("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
  void autoApply.tick();
}

/** Staging never invokes the gateway's generic updater. */
async function stageComponentUpdate(): Promise<boolean> {
  if (!componentsReady) throw new Error("The desktop is still starting; check again when the engine is ready");
  const staged = await refreshComponentUpdate(cfg, fetch, { desktop: install });
  await offerStagedUpdate();
  return staged;
}

/** Swaps in a new window build: route and drafts are already kept by the window; the preload keeps scroll. */
async function hotSwapWindow(): Promise<void> {
  const windows = branchWindows().filter(w => w.webContents.getURL().startsWith(windowUrl()));
  if (!windows.length) return;
  // Attached files live only in memory; the swap waits until they are sent or removed.
  while (branchWindows().length && (await probeWindowState().catch(() => undefined))?.unsavedDraftFiles) await pause(5_000);
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
  conversationWindows.set(key, child);
  saveConversationWindows();
  child.on("closed", () => { if (conversationWindows.get(key) === child) { conversationWindows.delete(key); if (!quitting) saveConversationWindows(); } });
  child.webContents.on("did-finish-load", () => offerWindowStatus(child));
  if (place?.maximized) child.once("show", () => child.maximize());
  trackWindowState(child, cfg.dataDir, (bounds) => screen.getDisplayMatching(bounds).bounds, conversationStateFile(key));
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
    saveConversationWindows();
  });
  ipcMain.on("branch-desktop:restart-engine", e => { if (isOwnedComponentWindow(e, ownedWebContents(e.sender), windowUrl())) void restartEngine(); });
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
  win = createWindow();
  await win.loadURL(STARTING);
  log(`starting page shown after ${Date.now() - launchStarted} ms`);
  const desktopVersion = await confirmDesktopUpdate(cfg);
  if (desktopVersion) log(`desktop update ${desktopVersion} started; confirmed`);
  for (const port of [cfg.gatewayPort, cfg.windowPort]) {
    if (!(await portIsFree(port))) throw new Error(`port ${port} is already in use; is Branch Agent already running?`);
  }
  await refuseOrphanedEngine();
  adoptGatewayPort(cfg.gatewayPort);
  await recoverComponentUpdate(cfg);
  if (!existsSync(join(cfg.windowDir, "index.html")) || !existsSync(join(cfg.dataDir, "engine-current.txt")) && !existsSync(join(cfg.engineDir, "branch.mjs"))) {
    log("Installing verified GitHub components for first launch");
    await refreshComponentUpdate(cfg, fetch, { desktop: install });
  }
  servedWindowDir = cfg.windowDir;
  server = await serveWindow(() => servedWindowDir, cfg.windowPort);
  await win.loadURL(windowUrl());
  log(`window loaded after ${Date.now() - launchStarted} ms`);
  if (await bootSelectedEngine()) {
    await win.loadURL(windowUrl());
    log("Reloaded retained window after component rollback");
  }
  for (const key of savedConversationKeys()) openConversationWindow(key);
  watchUpdates(win);
  componentsReady = true;
  autoApply.start();
  stopComponentWatch = watchComponentUpdates(cfg, log, { desktop: install, onStaged: () => {
    offerStagedUpdate().catch(error => log(`Component update status: ${String(error)}`));
  } });
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
async function bootEngine(engineDir = resolveEngineDir(cfg), confirmUpdate = true, prepared?: PreparedGateway, port = prepared?.port ?? gatewayPort): Promise<void> {
  const started = Date.now();
  const child = prepared?.child ?? startGateway(cfg, engineDir, token, false, port);
  if (prepared?.child.pid !== undefined) writeFileSync(join(cfg.dataDir, "gateway.pid"), String(prepared.child.pid));
  if (prepared) setEnginePriority(prepared.child, false);
  gateway = child;
  const observed = gatewaySupervisor.observe(child);
  log(`gateway started from ${engineDir}, pid ${child.pid}, port ${port}`);
  // publish-engine.sh never removes the folder named here.
  writeFileSync(join(cfg.dataDir, "engine-running.txt"), `${engineDir}
`);
  // Ready means listening on its own port and answering /readyz there; only then does the window follow it.
  await waitForReady({ ...cfg, gatewayPort: port }, child, READY_TIMEOUT_MS);
  // Only a confirmed engine moves the live port: a rollback reboots on the port the window already uses.
  if (confirmUpdate) await confirmComponentUpdate(cfg);
  adoptGatewayPort(port);
  lastGoodEngineDir = engineDir;
  observed.ready();
  gatewayRecoveryError = undefined;
  log(`gateway ready after ${Date.now() - started} ms; launch elapsed ${Date.now() - launchStarted} ms`);
  if (confirmUpdate) engineUpdateReady = false;
  watchEngine();
}

/** Watches the engine pointer and build from their current value (re-armed after a rejected candidate's rollback). */
function watchEngine(): void {
  stopEngineWatch?.();
  stopEngineWatch = watchEngineBuild(() => engineSignature(cfg), () => {
    log("new engine build found; offering Update");
    void readComponentUpdateStatus(cfg).then(({ componentsPendingVersion }) => {
      if (componentsPendingVersion) return offerStagedUpdate();
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
        await bootEngine(resolveEngineDir(cfg), true);
      }
    },
    stopFailedGateway: () => { if (gateway) stopGateway(gateway); },
    recordTimeout: () => recordComponentUpdateTimeout(cfg, selectedEngine),
    rejectExited: () => rejectFailedComponentUpdate(cfg, selectedEngine),
    rollback: () => rollbackComponentUpdate(cfg),
    waitForPortRelease: waitForGatewayPort,
    log,
  });
}

function watchUpdates(w: BrowserWindow): void {
  stopWindowWatch = watchWindowBuild(cfg.windowDir, () => {
    void readComponentUpdateStatus(cfg).then(({ publicationInProgress }) => {
      // A staged engine/window pair activates together through the in-place swap.
      if (publicationInProgress || engineRestartInProgress) return;
      log("new window build found; swapping it in");
      void hotSwapWindow();
    }).catch(error => log(`Window update status: ${String(error)}`));
  });
  // A reload re-runs the preload; show the bar again if an engine update is still waiting.
  w.webContents.on("did-finish-load", () => offerWindowStatus(w));
}
function offerWindowStatus(w: BrowserWindow): void {
  if (w.isDestroyed() || !w.webContents.getURL().startsWith(windowUrl())) return;
  if (engineUpdateReady) w.webContents.send("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
  if (gatewayRecoveryError) w.webContents.send("branch-desktop:gateway-recovery-failed", gatewayRecoveryError);
}

/** The owner's Update click: applies a staged engine/window pair, or a rebuilt engine, in place. */
async function restartEngine(): Promise<void> {
  if (!gateway || !win || !componentsReady || engineRestartInProgress) return;
  gatewaySupervisor.cancelPending();
  const staged = (await readComponentUpdateStatus(cfg)).componentsPendingVersion;
  log(`update requested (${staged ?? "rebuilt engine"}); old engine pid ${gateway.pid}`);
  try { await swapEngineInPlace(staged ?? "rebuilt engine", true); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`update failed: ${msg}`);
    if (!engineRunning() && !HIDDEN) dialog.showErrorBox("Branch couldn't finish the update", msg);
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
  if (standby) stopGateway(standby.child);
  standby = undefined;
  if (gateway) stopGateway(gateway);
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
