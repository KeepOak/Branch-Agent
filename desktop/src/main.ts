// Branch Agent desktop app: starts the engine gateway, serves the built window on 127.0.0.1 and shows it.
import { app, BrowserWindow, clipboard, dialog, ipcMain, screen, session, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { engineSignature, loadConfig, resolveEngineDir, type DesktopConfig } from "./config";
import { drainStopGateway, gatewayActivity, portIsFree, readToken, startGateway, stopGateway, stopGatewayCleanly, waitForReady } from "./gateway";
import { serveWindow } from "./static-server";
import { watchEngineBuild, watchWindowBuild } from "./updates";
import { keepWindowResident } from "./resident-window";
import { confirmComponentUpdate, readComponentUpdateStatus, recordComponentUpdateTimeout, recoverComponentUpdate, refreshComponentUpdate, rejectFailedComponentUpdate, rollbackComponentUpdate, watchComponentUpdates } from "./component-update";
import { bootSelectedEngineWithRollback } from "./boot-selected-engine";
import { createComponentUpdateController, isOwnedComponentWindow, registerComponentUpdateIpc } from "./component-update-ipc";
import { createDesktopControls, readSettings, registerDesktopControlsIpc } from "./desktop-controls";
import { desktopOs, START_IN_TRAY } from "./desktop-os";
import { registerTitleBarIpc, titleBarOptions } from "./title-bar";
import { registerClipboardIpc } from "./clipboard-ipc";
import { placeWindow, readWindowState, trackWindowState } from "./window-state";
import { confirmDesktopUpdate, handOffDesktopUpdate, type DesktopInstall } from "./desktop-update";
import { createAutoApplyUpdate } from "./auto-apply-update";
import { checkCandidateBeside, stopCandidate } from "./candidate-check";
import { freemem } from "node:os";
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
const READY_TIMEOUT_MS = 600_000;
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
let server: Server | undefined;
let win: BrowserWindow | undefined;
let token = "";
let engineUpdateReady = false;
let stopEngineWatch: (() => void) | undefined;
let stopComponentWatch: (() => void) | undefined;
let stopWindowWatch: (() => void) | undefined;
let componentsReady = false;
/** The window build the static server serves: the staged one only once its engine runs. */
let servedWindowDir = cfg.windowDir;
let engineRestartInProgress = false;
const componentUpdates = createComponentUpdateController(cfg, { stage: stageComponentUpdate });
let tray: Tray | undefined;
const controls = createDesktopControls({ ...desktopOs(app, cfg, () => tray, ICON), onChange: settings => {
  if (engineUpdateReady) win?.webContents.send("branch-desktop:engine-update", settings.autoApplyUpdates ? "auto-wait" : "ready");
  void autoApply.tick();
} });
let nextProbeId = 0;

async function probeWindowState(): Promise<{ pendingApprovals: number; streaming: boolean; unsavedDraftFiles: boolean }> {
  const owner = win?.webContents;
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

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const windowBuild = (dir: string): string => { try { return readFileSync(join(dir, "branch-build.txt"), "utf8").trim(); } catch { return ""; } };
const engineRunning = (): boolean => Boolean(gateway && gateway.exitCode === null && gateway.signalCode === null);

/**
 * Applies a staged engine/window update, or a rebuilt engine, inside the running app: the app and its window stay
 * open. The old engine stops cleanly (auto-apply: only while idle; the owner's click: it drains, and the new
 * engine's restart recovery resumes interrupted runs), the new one starts on the same port with the readiness
 * rollback, and the window either reconnects (engine-only) or swaps in its new build keeping route, scroll and drafts.
 * A staged desktop app is never applied here; it waits for the next natural launch.
 */
async function swapEngineInPlace(label: string, explicit: boolean): Promise<void> {
  if (!gateway || !win || engineRestartInProgress) throw new Error("The desktop is not ready to update");
  engineRestartInProgress = true;
  const windowBefore = windowBuild(servedWindowDir);
  try {
    if (!await candidatePassed(label)) return;
    const started = Date.now();
    win.webContents.send("branch-desktop:engine-update", "updating");
    if (explicit) log(`update ${label}: old engine ${await drainStopGateway(gateway)}`);
    else await stopGatewayCleanly(gateway);
    const stopped = Date.now();
    servedWindowDir = cfg.windowDir;
    await waitForGatewayPort();
    const rolledBack = await bootSelectedEngine();
    log(`update ${label}: engine ${rolledBack ? "rolled back" : "swapped"} in place; stop ${stopped - started} ms, start ${Date.now() - stopped} ms, app and window kept open`);
    engineUpdateReady = false;
    if (rolledBack) win.webContents.send("branch-desktop:engine-update", "kept");
    else if (windowBuild(cfg.windowDir) !== windowBefore) void hotSwapWindow();
    else win.webContents.send("branch-desktop:engine-update", "updated");
  } catch (error) {
    // Still serving (the engine became busy before it stopped): offer the update again.
    if (engineRunning()) win.webContents.send("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
    throw error;
  } finally { engineRestartInProgress = false; }
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
  win?.webContents.send("branch-desktop:engine-update", "preparing");
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
  win?.webContents.send("branch-desktop:engine-update", "kept");
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
  win?.webContents.send("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
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
  const w = win;
  if (!w || w.isDestroyed() || !w.webContents.getURL().startsWith(windowUrl())) return;
  // Attached files live only in memory; the swap waits until they are sent or removed.
  while (!w.isDestroyed() && (await probeWindowState().catch(() => undefined))?.unsavedDraftFiles) await pause(5_000);
  if (w.isDestroyed()) return;
  const id = ++nextProbeId;
  await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); ipcMain.off("branch-desktop:swap-ready", receive); resolve(); };
    const receive = (_event: Electron.IpcMainEvent, replyId: unknown) => { if (replyId === id) done(); };
    const timer = setTimeout(done, 2_000);
    ipcMain.on("branch-desktop:swap-ready", receive);
    w.webContents.send("branch-desktop:prepare-swap", id);
  });
  log("window updated in place");
  w.webContents.reload();
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
  tray = keepWindowResident(app, w, TRAY_ICON, {
    hidden: HIDDEN,
    keepRunning: () => controls.settings().keepWorking,
    // With the usage ring in the tray, a click opens the same list (Settings › Usage).
    onTrayClick: () => { if (controls.settings().trayUsage) w.webContents.send("branch-desktop:open-usage"); },
  });
  return w;
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
    const served = e.sender.getURL().startsWith(windowUrl());
    e.returnValue = served ? { gatewayUrl: `ws://127.0.0.1:${cfg.gatewayPort}`, gatewayToken: token } : null;
  });
  ipcMain.on("branch-desktop:restart-engine", e => { if (isOwnedComponentWindow(e, win?.webContents, windowUrl())) void restartEngine(); });
  registerComponentUpdateIpc(ipcMain, () => win?.webContents, windowUrl(), componentUpdates);
  registerDesktopControlsIpc(ipcMain, () => win?.webContents, windowUrl(), controls);
  registerTitleBarIpc(ipcMain, () => win?.webContents, windowUrl(), (overlay) => win?.setTitleBarOverlay(overlay));
  registerClipboardIpc(ipcMain, () => win?.webContents, windowUrl(), clipboard);
  controls.apply();
  win = createWindow();
  await win.loadURL(STARTING);
  log(`starting page shown after ${Date.now() - launchStarted} ms`);
  const desktopVersion = await confirmDesktopUpdate(cfg);
  if (desktopVersion) log(`desktop update ${desktopVersion} started; confirmed`);
  for (const port of [cfg.gatewayPort, cfg.windowPort]) {
    if (!(await portIsFree(port))) throw new Error(`port ${port} is already in use; is Branch Agent already running?`);
  }
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
  watchUpdates(win);
  componentsReady = true;
  autoApply.start();
  stopComponentWatch = watchComponentUpdates(cfg, log, { desktop: install, onStaged: () => {
    offerStagedUpdate().catch(error => log(`Component update status: ${String(error)}`));
  } });
}

async function waitForGatewayPort(): Promise<void> {
  for (let i = 0; i < 40 && !(await portIsFree(cfg.gatewayPort)); i++) await pause(250);
}

/** Starts the gateway, waits until it is ready, and watches its build for a newer one. */
async function bootEngine(): Promise<void> {
  const started = Date.now();
  const engineDir = resolveEngineDir(cfg);
  gateway = startGateway(cfg, engineDir, token);
  log(`gateway started from ${engineDir}, pid ${gateway.pid}`);
  // publish-engine.sh never removes the folder named here.
  writeFileSync(join(cfg.dataDir, "engine-running.txt"), `${engineDir}
`);
  await waitForReady(cfg, gateway, READY_TIMEOUT_MS);
  await confirmComponentUpdate(cfg);
  log(`gateway ready after ${Date.now() - started} ms; launch elapsed ${Date.now() - launchStarted} ms`);
  engineUpdateReady = false;
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
      win?.webContents.send("branch-desktop:engine-update", "ready");
    }).catch(error => log(`Engine build status: ${String(error)}`));
  });
}

/** A failed newly published build restores the prior pointer/window before booting the retained engine. */
async function bootSelectedEngine(): Promise<boolean> {
  const selectedEngine = resolveEngineDir(cfg);
  return bootSelectedEngineWithRollback({
    boot: bootEngine,
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
  w.webContents.on("did-finish-load", () => {
    if (engineUpdateReady) w.webContents.send("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
  });
}

/** The owner's Update click: applies a staged engine/window pair, or a rebuilt engine, in place. */
async function restartEngine(): Promise<void> {
  if (!gateway || !win || !componentsReady || engineRestartInProgress) return;
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
  quitAfterCleanStop = true;
  stopGatewayCleanly(gateway, 15_000).then(() => log("gateway stopped cleanly for quit"),
    error => log(`quit: clean stop skipped: ${error instanceof Error ? error.message : String(error)}`)).finally(() => app.quit());
  return true;
}

function shutdown(): void {
  log(`quit; stopping gateway pid ${gateway?.pid}`);
  stopEngineWatch?.();
  stopComponentWatch?.();
  autoApply.stop();
  stopWindowWatch?.();
  controls.dispose();
  stopCandidate();
  if (gateway) stopGateway(gateway);
  server?.close();
}

if (!app.requestSingleInstanceLock()) {
  log("another Branch Agent window is open; quitting");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win && !HIDDEN) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.on("activate", () => {
    if (win && !HIDDEN) {
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
