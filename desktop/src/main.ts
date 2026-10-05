// Branch Agent desktop app: starts the engine gateway, serves the built window on 127.0.0.1 and shows it.
import { app, BrowserWindow, dialog, ipcMain, screen, session, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { appendFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { engineSignature, loadConfig, resolveEngineDir, type DesktopConfig } from "./config";
import { GatewayReadinessError, gatewayActivity, portIsFree, readToken, startGateway, stopGateway, stopGatewayCleanly, waitForReady } from "./gateway";
import { serveWindow } from "./static-server";
import { watchEngineBuild, watchWindowBuild } from "./updates";
import { keepWindowsWindowResident } from "./resident-window";
import { confirmComponentUpdate, readComponentUpdateStatus, recoverComponentUpdate, refreshComponentUpdate, rejectFailedComponentUpdate, rollbackComponentUpdate, watchComponentUpdates } from "./component-update";
import { createComponentUpdateController, isOwnedComponentWindow, registerComponentUpdateIpc } from "./component-update-ipc";
import { createDesktopControls, registerDesktopControlsIpc } from "./desktop-controls";
import { desktopOs, START_IN_TRAY } from "./desktop-os";
import { registerTitleBarIpc, titleBarOptions } from "./title-bar";
import { placeWindow, readWindowState, trackWindowState } from "./window-state";
import { confirmDesktopUpdate, handOffDesktopUpdate, stagedDesktopVersion, type DesktopInstall } from "./desktop-update";
import { createAutoApplyUpdate } from "./auto-apply-update";
import type { Tray } from "electron";

const HIDDEN = process.env.BRANCH_DESKTOP_HIDDEN === "1";
/** Started with Windows: open quietly in the tray (only where the tray exists). */
const QUIET = process.platform === "win32" && process.argv.includes(START_IN_TRAY);
const ICON = join(__dirname, "..", "assets", "branch.ico");
const READY_TIMEOUT_MS = 180_000;
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
app.setAppUserModelId("dev.branch.agent.desktop");

let gateway: ChildProcess | undefined;
let server: Server | undefined;
let win: BrowserWindow | undefined;
let token = "";
let engineUpdateReady = false;
let stopEngineWatch: (() => void) | undefined;
let stopComponentWatch: (() => void) | undefined;
let stopWindowWatch: (() => void) | undefined;
let componentsReady = false;
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

async function relaunchForUpdate(version: string): Promise<void> {
  if (!gateway || !win || engineRestartInProgress) throw new Error("The desktop is not ready to restart");
  engineRestartInProgress = true;
  try {
    // The engine rechecks the process-wide inventory before admitting its clean stop.
    await stopGatewayCleanly(gateway);
    log(`auto-apply: gateway stopped cleanly for ${version}`);
    win.webContents.send("branch-desktop:engine-update", "updating");
    await new Promise(resolve => setTimeout(resolve, 750));
    if (!await handOffDesktop(true)) app.relaunch({ args: process.argv.slice(1) });
    app.quit();
  } catch (error) { engineRestartInProgress = false; throw error; }
}

const autoApply = createAutoApplyUpdate({
  pendingVersion: async () => (await readComponentUpdateStatus(cfg)).pendingVersion,
  enabled: () => controls.settings().autoApplyUpdates,
  activity: async () => {
    if (!gateway) throw new Error("The gateway is not running");
    // The approval RPCs themselves count as gateway work; sample after they settle.
    const window = await probeWindowState();
    const engine = await gatewayActivity(gateway);
    return { activeRuns: Math.max(engine.activeRuns, engine.totalActive), pendingApprovals: window.pendingApprovals,
      streaming: engine.pendingReplies > 0 || window.streaming, unsavedDraftFiles: window.unsavedDraftFiles };
  },
  restart: relaunchForUpdate,
  log,
});

/** Staging never invokes the gateway's generic updater. */
async function stageComponentUpdate(): Promise<boolean> {
  if (!componentsReady) throw new Error("The desktop is still starting; check again when the engine is ready");
  const staged = await refreshComponentUpdate(cfg, fetch, { desktop: install });
  if ((await readComponentUpdateStatus(cfg)).pendingVersion) {
    engineUpdateReady = true;
    win?.webContents.send("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
    void autoApply.tick();
  }
  return staged;
}

const STARTING = `data:text/html;charset=utf-8,${encodeURIComponent(
  "<!doctype html><title>Branch Agent</title><body style=\"-webkit-app-region:drag;font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f6f7f8;color:#333\">Starting Branch Agent…</body>",
)}`;

function createWindow(): BrowserWindow {
  // First launch opens maximized; later launches restore the last state, size, position and display.
  const place = placeWindow(readWindowState(cfg.dataDir), screen.getAllDisplays());
  const w = new BrowserWindow({
    title: "Branch Agent",
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
  if (!HIDDEN && !QUIET) w.once("ready-to-show", () => (place.maximized ? w.maximize() : w.show()));
  trackWindowState(w, cfg.dataDir, (bounds) => screen.getDisplayMatching(bounds).bounds);
  lockDown(w);
  tray = keepWindowsWindowResident(app, w, ICON, {
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

/** Like quitAndInstall: the helper swaps the staged desktop app in once this process has exited, then relaunches it. */
async function handOffDesktop(explicit: boolean): Promise<boolean> {
  if (!install || !await handOffDesktopUpdate(cfg, install, join(__dirname, "desktop-update-helper.js"), process.argv.slice(1), explicit)) return false;
  log("desktop update staged; handing off to the update helper and quitting");
  return true;
}

async function start(): Promise<void> {
  // A desktop update staged during the last run applies before anything starts.
  if (await handOffDesktop(false)) { app.exit(0); return; }
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
  server = await serveWindow(cfg.windowDir, cfg.windowPort);
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
    void readComponentUpdateStatus(cfg).then(({ pendingVersion }) => {
      if (!pendingVersion) return;
      engineUpdateReady = true;
      win?.webContents.send("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
      void autoApply.tick();
    }).catch(error => log(`Component update status: ${String(error)}`));
  } });
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
  try { await waitForReady(cfg, gateway, READY_TIMEOUT_MS); } catch (error) {
    if (error instanceof GatewayReadinessError && error.reason !== "unready") {
      await rejectFailedComponentUpdate(cfg, engineDir, error.reason);
    }
    throw error;
  }
  await confirmComponentUpdate(cfg);
  log(`gateway ready after ${Date.now() - started} ms; launch elapsed ${Date.now() - launchStarted} ms`);
  engineUpdateReady = false;
  stopEngineWatch?.();
  stopEngineWatch = watchEngineBuild(() => engineSignature(cfg), () => {
    engineUpdateReady = true;
    log("new engine build found; offering Restart");
    win?.webContents.send("branch-desktop:engine-update", "ready");
  });
}

/** A failed newly published build restores the prior pointer/window before booting the retained engine. */
async function bootSelectedEngine(): Promise<boolean> {
  try { await bootEngine(); return false; } catch (error) {
    if (error instanceof GatewayReadinessError && error.reason === "unready") throw error;
    if (gateway) stopGateway(gateway);
    if (!await rollbackComponentUpdate(cfg)) throw error;
    log("Updated engine failed readiness; restored prior components");
    for (let i = 0; i < 40 && !(await portIsFree(cfg.gatewayPort)); i++) await new Promise(r => setTimeout(r, 250));
    await bootEngine();
    return true;
  }
}

function watchUpdates(w: BrowserWindow): void {
  stopWindowWatch = watchWindowBuild(cfg.windowDir, () => {
    void readComponentUpdateStatus(cfg).then(({ publicationInProgress }) => {
      // A staged engine/window pair activates together through the owned restart flow.
      if (publicationInProgress) return;
      log("new window build found; reloading the window");
      if (w.webContents.getURL().startsWith(windowUrl())) w.webContents.reload();
    }).catch(error => log(`Window update status: ${String(error)}`));
  });
  // A reload re-runs the preload; show the bar again if an engine update is still waiting.
  w.webContents.on("did-finish-load", () => {
    if (engineUpdateReady) w.webContents.send("branch-desktop:engine-update", controls.settings().autoApplyUpdates ? "auto-wait" : "ready");
  });
}

/** The explicit Restart action also handles non-release build changes. */
async function restartEngine(): Promise<void> {
  if (!gateway || !win || !componentsReady || engineRestartInProgress) return;
  const staged = (await readComponentUpdateStatus(cfg)).pendingVersion;
  if (staged) {
    try { await relaunchForUpdate(staged); }
    catch (error) { log(`clean relaunch failed: ${String(error)}`); if (!HIDDEN) dialog.showErrorBox("Branch Agent could not restart", String(error)); }
    return;
  }
  engineRestartInProgress = true;
  try {
    // A staged desktop app restarts the whole app (the new engine and window come up with it).
    if (await stagedDesktopVersion(cfg) && await handOffDesktop(true)) { app.quit(); return; }
    log(`restart requested; stopping gateway pid ${gateway.pid}`);
    win.webContents.send("branch-desktop:engine-update", "restarting");
    stopGateway(gateway);
    for (let i = 0; i < 40 && !(await portIsFree(cfg.gatewayPort)); i++) await new Promise((r) => setTimeout(r, 250));
    await bootSelectedEngine();
    win.webContents.reload();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`restart failed: ${msg}`);
    if (!HIDDEN) dialog.showErrorBox("Branch Agent could not restart the engine", msg);
  } finally {
    engineRestartInProgress = false;
  }
}

function shutdown(): void {
  log(`quit; stopping gateway pid ${gateway?.pid}`);
  stopEngineWatch?.();
  stopComponentWatch?.();
  autoApply.stop();
  stopWindowWatch?.();
  controls.dispose();
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
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", shutdown);
  app.whenReady().then(start).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    log(`could not start: ${msg}`);
    if (!HIDDEN) dialog.showErrorBox("Branch Agent could not start", msg);
    app.quit();
  });
}
