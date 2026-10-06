import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error("Compile the exact desktop source before testing");
const require = createRequire(import.meta.url), Module = require("node:module");
const originalLoad = Module._load, originalFetch = globalThis.fetch;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function eventually(predicate, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() > end) throw Error("Fixture deadline"); await pause(20); }
}
async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function electronFixture() {
  let window; const app = new EventEmitter(), ipcMain = new EventEmitter(), errors = [];
  Object.assign(app, { getVersion: () => "fixture", setPath() {}, setAppUserModelId() {},
    requestSingleInstanceLock: () => true, whenReady: async () => {}, quit() { app.emit("will-quit"); } });
  class BrowserWindow extends EventEmitter {
    constructor() { super(); window = this; this.reloads = 0; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: { url: "" }, getURL: () => this.url, setWindowOpenHandler() {}, send() {},
        reload: () => { this.reloads++; this.webContents.emit("did-finish-load"); } }); }
    async loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; this.webContents.emit("did-finish-load"); }
    setMenuBarVisibility() {} show() {} focus() {} hide() {} isMinimized() { return false; }
    maximize() {} isMaximized() { return false; } isVisible() { return true; } isDestroyed() { return false; } getNormalBounds() { return { x: 0, y: 0, width: 1280, height: 840 }; }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} }
  return { app, ipcMain, errors, get window() { return window; }, electron: { app, BrowserWindow, Tray,
    ipcMain: Object.assign(ipcMain, { handle() {} }), Menu: { buildFromTemplate: value => value },
    screen: { getAllDisplays: () => [], getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 840 } }) },
    dialog: { showErrorBox: (...args) => errors.push(args) }, shell: { openExternal() {} },
    session: { defaultSession: { setPermissionRequestHandler() {} } } } };
}
async function createFixtureFiles(root) {
  const engine = join(root, "engine"), windowDir = join(root, "window");
  await mkdir(join(engine, "dist"), { recursive: true }); await mkdir(windowDir);
  await writeFile(join(engine, "dist/build-info.json"), '{"version":"fixture"}');
  const script = `import fs from "node:fs";import http from "node:http";
const root=${JSON.stringify(root)}, file=root+"/starts.json";
const starts=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):[];
starts.push(process.pid);fs.writeFileSync(file,JSON.stringify(starts));
if(starts.length>1&&fs.existsSync(root+"/fail-next"))process.exit(1);
process.on("message",m=>{if(!String(m?.type).startsWith("branch-desktop:"))return;if(m.type==="branch-desktop:drain-stop"&&fs.existsSync(root+"/older-engine"))return;process.send({type:"branch-desktop:activity-result",id:m.id,idle:!fs.existsSync(root+"/busy"),activeRuns:fs.existsSync(root+"/busy")?1:0,pendingReplies:0,totalActive:0});
if(m.type==="branch-desktop:drain-stop"){fs.writeFileSync(root+"/drained-"+process.pid,"1");setTimeout(()=>process.exit(0),20);}
if(m.type==="branch-desktop:stop-if-idle"&&!fs.existsSync(root+"/busy"))setTimeout(()=>process.exit(0),20);});
http.createServer((q,r)=>{r.writeHead(starts.length===1&&!fs.existsSync(root+"/hold-startup")||fs.existsSync(root+"/release-ready")?200:503).end();}).listen(Number(process.argv.at(-1)),"127.0.0.1");`;
  await writeFile(join(engine, "branch.mjs"), script); await writeFile(join(windowDir, "index.html"), "<html>fixture</html>");
  await writeFile(join(root, "gateway-token"), "isolated-fixture-token");
  await writeFile(join(root, "desktop.json"), JSON.stringify({ dataDir: root, engineDir: engine, windowDir,
    nodePath: process.execPath, gatewayPort: await freePort(), windowPort: await freePort() }));
}
async function fixture(run, holdStartup = false, fastSupervisor = false) {
  const scratch = join(tmpdir(), "Codex-session-files"); await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "branch-restart-")); await createFixtureFiles(root);
  const previous = process.env.BRANCH_DESKTOP_DATA; process.env.BRANCH_DESKTOP_DATA = root;
  const runtime = electronFixture(), starts = async () => {
    try { return JSON.parse(await readFile(join(root, "starts.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  if (holdStartup) await writeFile(join(root, "hold-startup"), "wait");
  Module._load = function(name, ...args) {
    if (name === "electron") return runtime.electron;
    if (fastSupervisor && name === "./gateway-supervisor") {
      const source = originalLoad.call(this, name, ...args);
      return { createGatewayCrashSupervisor: options => source.createGatewayCrashSupervisor({ ...options,
        policy: { maxAttempts: 1, initialDelayMs: 10, maxDelayMs: 10, stableAfterMs: 60_000 } }) };
    }
    return originalLoad.call(this, name, ...args);
  };
  globalThis.fetch = (url, options) => String(url).startsWith("https://github.com/") ? Promise.resolve(new Response("", { status: 404 })) : originalFetch(url, options);
  // Fresh main.js per test: compare normalized paths (CI passes a mixed-slash workspace path on Windows).
  const dist = resolve(process.env.BRANCH_DESKTOP_TEST_DIST).replaceAll("\\", "/").toLowerCase();
  for (const file of Object.keys(require.cache)) if (file.replaceAll("\\", "/").toLowerCase().startsWith(dist)) delete require.cache[file];
  const restart = () => runtime.ipcMain.emit("branch-desktop:restart-engine", { sender: runtime.window.webContents, senderFrame: runtime.window.webContents.mainFrame });
  try {
    require(join(process.env.BRANCH_DESKTOP_TEST_DIST, "main.js"));
    if (!holdStartup) await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway ready"));
    await run({ root, runtime, starts, restart });
  } finally {
    await writeFile(join(root, "release-ready"), "ready"); await pause(600);
    runtime.app.emit("will-quit");
    await eventually(async () => (await starts()).every(pid => !alive(pid)));
    Module._load = originalLoad; globalThis.fetch = originalFetch;
    previous === undefined ? delete process.env.BRANCH_DESKTOP_DATA : process.env.BRANCH_DESKTOP_DATA = previous;
    await rm(root, { recursive: true, force: true });
  }
}
const swapped = async (root, count = 1) => (await readFile(join(root, "desktop.log"), "utf8")).split("engine swapped in place").length - 1 >= count;
test("a crashed ready gateway restarts without closing or reloading the window", () => fixture(async ({ root, runtime, starts }) => {
  const first = (await starts())[0];
  await writeFile(join(root, "release-ready"), "ready");
  process.kill(first, "SIGTERM");
  await eventually(async () => (await starts()).length === 2);
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway recovered after unexpected exit"));
  assert.equal(alive((await starts())[1]), true);
  assert.equal(runtime.window.reloads, 0);
  assert.equal(runtime.errors.length, 0);
}));
test("an Update click cancels a pending crash restart without starting a second gateway", () => fixture(async ({ root, runtime, starts, restart }) => {
  await writeFile(join(root, "release-ready"), "ready");
  process.kill((await starts())[0], "SIGTERM");
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway restart attempt"));
  restart();
  await eventually(() => swapped(root));
  await pause(1200);
  assert.equal((await starts()).length, 2, "The supervisor started another gateway after Update");
  assert.equal(runtime.errors.length, 0);
}));
test("a clean quit closes supervision before stopping the gateway", () => fixture(async ({ root, runtime, starts }) => {
  let deferred = false;
  runtime.app.emit("will-quit", { preventDefault() { deferred = true; } });
  assert.equal(deferred, true);
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway stopped cleanly for quit"));
  assert.equal((await starts()).every(pid => !alive(pid)), true);
  const log = await readFile(join(root, "desktop.log"), "utf8");
  assert.match(log, /gateway stopped cleanly for quit/);
  assert.doesNotMatch(log, /gateway restart attempt|gateway recovery stopped/);
}));
test("exhausted crash recovery notifies the window and shows a visible-window error", () => fixture(async ({ root, runtime, starts }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  await writeFile(join(root, "fail-next"), "fail");
  process.kill((await starts())[0], "SIGTERM");
  await eventually(() => sent.some(([channel]) => channel === "branch-desktop:gateway-recovery-failed"));
  const notification = sent.find(([channel]) => channel === "branch-desktop:gateway-recovery-failed")[1];
  assert.match(notification, /couldn't restart the engine after repeated attempts/);
  assert.match(notification, /Restart Branch Agent to try again/);
  assert.equal(runtime.errors.length, 1);
  assert.equal(runtime.errors[0][0], "Branch couldn't restart the engine");
}, false, true));
test("a second update click preserves the gateway already starting", () => fixture(async ({ root, runtime, starts, restart }) => {
  restart(); await eventually(async () => (await starts()).length === 2);
  const candidate = (await starts())[1]; restart();
  assert.equal(alive(candidate), true, "The second click killed the first replacement gateway");
  await writeFile(join(root, "release-ready"), "ready"); await eventually(() => swapped(root));
  assert.equal((await starts()).length, 2); assert.equal(runtime.errors.length, 0);
}));
test("a failed update releases the guard for the next owner retry", () => fixture(async ({ root, runtime, starts, restart }) => {
  await writeFile(join(root, "fail-next"), "fail"); restart(); await eventually(() => runtime.errors.length === 1);
  await unlink(join(root, "fail-next")); await writeFile(join(root, "release-ready"), "ready");
  restart(); await eventually(() => swapped(root));
  assert.equal((await starts()).length, 3); assert.equal(runtime.errors.length, 1);
}));
test("an update click swaps the engine in place: the app and window stay open and the busy engine drains", () => fixture(async ({ root, runtime, starts, restart }) => {
  let quits = 0, relaunches = 0; runtime.app.on("will-quit", () => quits++); runtime.app.relaunch = () => relaunches++;
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const old = (await starts())[0]; await writeFile(join(root, "busy"), "a Trunk is working");
  await writeFile(join(root, "release-ready"), "ready"); restart();
  await eventually(() => swapped(root));
  assert.equal(quits + relaunches, 0, "An update restarted the app");
  assert.equal(runtime.window.reloads, 0, "An engine-only update reloaded the window");
  assert.equal(alive(old), false); assert.ok(await readFile(join(root, `drained-${old}`), "utf8"), "The busy engine was killed instead of drained");
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-update").map(([, state]) => state), ["updating", "updated"]);
  assert.equal(alive((await starts())[1]), true);
}));
test("a busy engine from before drain-stop is never killed by an update click; the update is offered again", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const old = (await starts())[0]; await writeFile(join(root, "older-engine"), "1"); await writeFile(join(root, "busy"), "a Trunk is working");
  restart();
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("update failed"), 40_000);
  assert.equal(alive(old), true, "A busy engine that cannot drain was killed");
  assert.equal((await starts()).length, 1, "A second engine started while the first was busy");
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-update").map(([, state]) => state), ["updating", "auto-wait"]);
}));
test("a new window build swaps in place after attached files are sent, keeping the engine", () => fixture(async ({ root, runtime, starts }) => {
  let files = true; const owner = runtime.window.webContents; owner.isDestroyed = () => false;
  owner.send = (channel, id) => {
    const event = { sender: owner, senderFrame: owner.mainFrame };
    if (channel === "branch-desktop:auto-apply:probe") setTimeout(() => runtime.ipcMain.emit("branch-desktop:auto-apply:result", event, id, { pendingApprovals: 0, streaming: false, unsavedDraftFiles: files }), 5);
    if (channel === "branch-desktop:prepare-swap") setTimeout(() => runtime.ipcMain.emit("branch-desktop:swap-ready", event, id), 5);
  };
  const windowDir = JSON.parse(await readFile(join(root, "desktop.json"), "utf8")).windowDir;
  await writeFile(join(windowDir, "branch-build.txt"), "build-a"); await pause(3500);
  await writeFile(join(windowDir, "branch-build.txt"), "build-b"); await pause(4000);
  assert.equal(runtime.window.reloads, 0, "The swap dropped attached files");
  files = false; await eventually(() => runtime.window.reloads === 1);
  assert.equal((await starts()).length, 1, "A window update restarted the engine");
}));
test("a restart request during first launch preserves its starting gateway", () => fixture(async ({ root, starts, restart }) => {
  await eventually(async () => (await starts()).length === 1);
  const candidate = (await starts())[0]; restart();
  assert.equal(alive(candidate), true, "An initial startup request killed the launching gateway");
  await unlink(join(root, "hold-startup"));
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway ready"));
  assert.equal((await starts()).length, 1);
}, true));
