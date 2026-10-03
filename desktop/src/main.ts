// Branch Agent desktop app: starts the engine gateway, serves the built window on 127.0.0.1 and shows it.
import { app, BrowserWindow, dialog, ipcMain, session, shell } from "electron";
import type { ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { engineSignature, loadConfig, resolveEngineDir, type DesktopConfig } from "./config";
import { portIsFree, readToken, startGateway, stopGateway, waitForReady } from "./gateway";
import { serveWindow } from "./static-server";
import { watchEngineBuild, watchWindowBuild } from "./updates";

const HIDDEN = process.env.BRANCH_DESKTOP_HIDDEN === "1";
const READY_TIMEOUT_MS = 180_000;
const cfg: DesktopConfig = loadConfig();

/** Appends one line to the app's own log (C:/Users/you/BranchApp/desktop.log). */
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

const STARTING = `data:text/html;charset=utf-8,${encodeURIComponent(
  "<!doctype html><title>Branch Agent</title><body style=\"font:15px system-ui;display:grid;place-items:center;height:100vh;margin:0;background:#f6f7f8;color:#333\">Starting Branch Agent…</body>",
)}`;

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    title: "Branch Agent",
    width: 1280,
    height: 840,
    show: false,
    icon: join(__dirname, "..", "assets", "branch.ico"),
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
  w.on("page-title-updated", (e) => e.preventDefault());
  if (!HIDDEN) w.once("ready-to-show", () => w.show());
  lockDown(w);
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

async function start(): Promise<void> {
  token = readToken(cfg);
  // Registered before any page loads: the preload asks for it synchronously.
  ipcMain.on("branch-desktop:info", (e) => {
    const served = e.sender.getURL().startsWith(windowUrl());
    e.returnValue = served ? { gatewayUrl: `ws://127.0.0.1:${cfg.gatewayPort}`, gatewayToken: token } : null;
  });
  ipcMain.on("branch-desktop:restart-engine", () => void restartEngine());
  win = createWindow();
  await win.loadURL(STARTING);
  log("starting page shown");
  for (const port of [cfg.gatewayPort, cfg.windowPort]) {
    if (!(await portIsFree(port))) throw new Error(`port ${port} is already in use; is Branch Agent already running?`);
  }
  server = await serveWindow(cfg.windowDir, cfg.windowPort);
  await bootEngine();
  await win.loadURL(windowUrl());
  log(`window loaded after ${Date.now() - launchStarted} ms`);
  watchUpdates(win);
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
  log(`gateway ready after ${Date.now() - started} ms`);
  engineUpdateReady = false;
  stopEngineWatch?.();
  stopEngineWatch = watchEngineBuild(() => engineSignature(cfg), () => {
    engineUpdateReady = true;
    log("new engine build found; offering Restart");
    win?.webContents.send("branch-desktop:engine-update", "ready");
  });
}

function watchUpdates(w: BrowserWindow): void {
  watchWindowBuild(cfg.windowDir, () => {
    log("new window build found; reloading the window");
    if (w.webContents.getURL().startsWith(windowUrl())) w.webContents.reload();
  });
  // A reload re-runs the preload; show the bar again if an engine update is still waiting.
  w.webContents.on("did-finish-load", () => {
    if (engineUpdateReady) w.webContents.send("branch-desktop:engine-update", "ready");
  });
}

/** Only on the owner's click: stops the gateway by PID, starts the new build and reloads the window. */
async function restartEngine(): Promise<void> {
  if (!gateway || !win) return;
  log(`restart requested; stopping gateway pid ${gateway.pid}`);
  win.webContents.send("branch-desktop:engine-update", "restarting");
  stopGateway(gateway);
  try {
    for (let i = 0; i < 40 && !(await portIsFree(cfg.gatewayPort)); i++) await new Promise((r) => setTimeout(r, 250));
    await bootEngine();
    win.webContents.reload();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`restart failed: ${msg}`);
    if (!HIDDEN) dialog.showErrorBox("Branch Agent could not restart the engine", msg);
  }
}

function shutdown(): void {
  log(`quit; stopping gateway pid ${gateway?.pid}`);
  stopEngineWatch?.();
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
