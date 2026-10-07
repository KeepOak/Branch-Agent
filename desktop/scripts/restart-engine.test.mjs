import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error("Compile the exact desktop source before testing");
const require = createRequire(import.meta.url), Module = require("node:module");
const originalLoad = Module._load, originalFetch = globalThis.fetch;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const servingOn = async (port) => (await originalFetch(`http://127.0.0.1:${port}/readyz`).then(response => response.status, () => 0)) === 200;
async function eventually(predicate, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!await predicate()) { if (Date.now() > end) throw Error("Fixture deadline"); await pause(20); }
}
async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
function electronFixture() {
  let window; const windows = [], handlers = new Map(), app = new EventEmitter(), ipcMain = new EventEmitter(), errors = [];
  Object.assign(app, { getVersion: () => "fixture", setPath() {}, setAppUserModelId() {},
    requestSingleInstanceLock: () => true, whenReady: async () => {}, quit() { app.emit("will-quit"); } });
  class BrowserWindow extends EventEmitter {
    static fromWebContents(sender) { return windows.find(w => w.webContents === sender) ?? null; }
    constructor() { super(); if (!window) window = this; windows.push(this); this.reloads = 0; this.destroyed = false; this.webContents = new EventEmitter();
      Object.assign(this.webContents, { mainFrame: { url: "" }, getURL: () => this.url, setWindowOpenHandler() {}, send() {},
        isDestroyed: () => this.destroyed, reload: () => { this.reloads++; this.webContents.emit("did-finish-load"); } }); }
    async loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; this.webContents.emit("did-finish-load"); }
    setMenuBarVisibility() {} show() {} focus() {} hide() {} isMinimized() { return false; }
    maximize() {} isMaximized() { return false; } isVisible() { return true; } isDestroyed() { return this.destroyed; }
    getNormalBounds() { return { x: 0, y: 0, width: 1280, height: 840 }; } getBounds() { return this.getNormalBounds(); }
    close() { if (this.destroyed) return; const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; this.emit("close", event); if (!event.defaultPrevented) this.destroy(); }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit("closed"); }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} }
  return { app, ipcMain, handlers, windows, errors, get window() { return window; }, electron: { app, BrowserWindow, Tray,
    ipcMain: Object.assign(ipcMain, { handle(channel, fn) { handlers.set(channel, fn); } }), Menu: { buildFromTemplate: value => value },
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
const peers=starts.filter(p=>p!==process.pid&&(()=>{try{process.kill(p,0);return true;}catch{return false;}})());
fs.writeFileSync(root+"/launch-"+process.pid+".json",JSON.stringify({port:Number(process.argv.at(-1)),standby:process.env.BRANCH_GATEWAY_STANDBY==="1",token:process.env.BRANCH_GATEWAY_TOKEN,peers}));
if(starts.length===2&&fs.existsSync(root+"/fail-next"))process.exit(1);
if(process.env.BRANCH_GATEWAY_STANDBY==="1"&&fs.existsSync(root+"/fail-standby"))process.exit(1);
// slow-sigterm: the update's new engine runs a shutdown that outlasts the desktop's grace (as one stuck in startup can).
if(starts.length===2&&fs.existsSync(root+"/slow-sigterm"))process.on("SIGTERM",()=>{fs.writeFileSync(root+"/sigterm-"+process.pid,"1");setTimeout(()=>process.exit(0),20000);});
process.on("message",m=>{if(!String(m?.type).startsWith("branch-desktop:"))return;
// slow-drain-reply: a saturated first engine answers the drain request after 7 s (past the desktop's 5 s), then drains:
// it answers the plain activity check, and refuses stop-if-idle while draining.
if(starts.length===1&&fs.existsSync(root+"/slow-drain-reply")){if(m.type==="branch-desktop:drain-stop"&&!globalThis.draining){const end=Date.now()+7000;while(Date.now()<end);globalThis.draining=true;setTimeout(()=>{fs.writeFileSync(root+"/drained-"+process.pid,"1");process.exit(0);},3000);}process.send({type:"branch-desktop:activity-result",id:m.id,idle:!globalThis.draining,activeRuns:globalThis.draining?1:0,pendingReplies:0,totalActive:globalThis.draining?1:0});return;}
// late-drain-ack: a saturated first engine answers nothing, yet the drain request lands and it exits 12 s later.
if(starts.length===1&&fs.existsSync(root+"/late-drain-ack")){if(m.type==="branch-desktop:drain-stop"&&!globalThis.draining){globalThis.draining=true;setTimeout(()=>{fs.writeFileSync(root+"/drained-"+process.pid,"1");process.exit(0);},12000);}return;}if(m.type==="branch-desktop:drain-stop"&&fs.existsSync(root+"/older-engine"))return;process.send({type:"branch-desktop:activity-result",id:m.id,idle:!fs.existsSync(root+"/busy"),activeRuns:fs.existsSync(root+"/busy")?1:0,pendingReplies:0,totalActive:0});
if(m.type==="branch-desktop:drain-stop"){fs.writeFileSync(root+"/drained-"+process.pid,"1");setTimeout(()=>process.exit(0),20);}
if(m.type==="branch-desktop:stop-if-idle"&&!fs.existsSync(root+"/busy"))setTimeout(()=>process.exit(0),20);});
const listener=http.createServer((q,r)=>{r.writeHead(starts.length===1&&!fs.existsSync(root+"/hold-startup")||fs.existsSync(root+"/release-ready")?200:503).end();});
// As a standby since #411: it takes the state over only on its launcher's take-over message, then says so.
if(process.env.BRANCH_GATEWAY_STANDBY==="1")process.on("message",m=>{if(m?.type!=="branch-desktop:take-over"||globalThis.tookOver)return;globalThis.tookOver=true;fs.writeFileSync(root+"/took-over-"+process.pid,JSON.stringify({oldEngineAlive:(()=>{try{process.kill(starts[0],0);return true;}catch{return false;}})()}));process.send?.({type:"branch-desktop:taking-over",pid:process.pid,port:Number(process.argv.at(-1))});});
if(process.env.BRANCH_GATEWAY_STANDBY==="1"){
  const announce=()=>process.send?.({type:"branch-desktop:standby-ready",pid:process.pid});
  if(fs.existsSync(root+"/hold-standby")){const timer=setInterval(()=>{if(!fs.existsSync(root+"/hold-standby")){clearInterval(timer);announce();}},10);}else announce();
}
// No EADDRINUSE retry: an engine listens once on the port the desktop gave it, so a standby on the live port fails.
const listen=()=>listener.listen(Number(process.argv.at(-1)),"127.0.0.1");
// As the real engine: a standby binds only after the old engine released state (here: once it drained).
if(process.env.BRANCH_GATEWAY_STANDBY==="1"&&fs.existsSync(root+"/standby-exits-after-release")){const timer=setInterval(()=>{if(fs.existsSync(root+"/drained-"+starts[0])){clearInterval(timer);process.exit(1);}},10);}
else if(process.env.BRANCH_GATEWAY_STANDBY==="1"&&fs.existsSync(root+"/standby-binds-after-release")){const timer=setInterval(()=>{if(fs.existsSync(root+"/drained-"+starts[0])){clearInterval(timer);listen();}},10);}
else if(process.env.BRANCH_GATEWAY_STANDBY==="1"&&fs.existsSync(root+"/standby-needs-take-over")){const timer=setInterval(()=>{if(globalThis.tookOver){clearInterval(timer);listen();}},10);}else listen();`;
  await writeFile(join(engine, "branch.mjs"), script); await writeFile(join(windowDir, "index.html"), "<html>fixture</html>");
  await writeFile(join(root, "gateway-token"), "isolated-fixture-token");
  await writeFile(join(root, "desktop.json"), JSON.stringify({ dataDir: root, engineDir: engine, windowDir,
    nodePath: process.execPath, gatewayPort: await freePort(), windowPort: await freePort() }));
}
/** standby: true always warms a standby; "never" (the default) always runs the plain guarded swap, whatever the runner's memory. */
async function fixture(run, holdStartup = false, fastSupervisor = false, holdCandidate = false, standby = "never", keepWorkingOff = false, prepare = undefined) {
  const scratch = join(tmpdir(), "Codex-session-files"); await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "branch-restart-")); await createFixtureFiles(root);
  if (keepWorkingOff) await writeFile(join(root, "desktop-settings.json"), JSON.stringify({ keepWorking: false }));
  const previous = process.env.BRANCH_DESKTOP_DATA;
  const previousCandidateMin = process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB;
  process.env.BRANCH_DESKTOP_DATA = root;
  if (holdCandidate || standby === true) process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB = "0";
  else if (standby === "never") process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB = String(2 ** 40);
  const runtime = electronFixture(), starts = async () => {
    try { return JSON.parse(await readFile(join(root, "starts.json"), "utf8")); }
    // The fixture may be mid-write: an empty or partial file reads as "not yet", and eventually() polls again.
    catch (error) { if (error.code === "ENOENT" || error instanceof SyntaxError) return []; throw error; }
  };
  if (holdStartup) await writeFile(join(root, "hold-startup"), "wait");
  await prepare?.(root);
  let onStaged;
  Module._load = function(name, ...args) {
    if (name === "electron") return runtime.electron;
    if (fastSupervisor && name === "./gateway-supervisor") {
      const source = originalLoad.call(this, name, ...args);
      return { createGatewayCrashSupervisor: options => source.createGatewayCrashSupervisor({ ...options,
        policy: typeof fastSupervisor === "object" ? fastSupervisor :
          { maxAttempts: 1, initialDelayMs: 10, maxDelayMs: 10, stableAfterMs: 60_000 } }) };
    }
    if (name === "./component-update") {
      const source = originalLoad.call(this, name, ...args);
      return { ...source, watchComponentUpdates: (cfg, log, options) => {
        onStaged = options.onStaged;
        return source.watchComponentUpdates(cfg, log, options);
      }, confirmComponentUpdate: async (...args) => {
        // fail-confirm: the new engine answered /readyz but its update cannot be confirmed (once).
        if (existsSync(join(root, "fail-confirm"))) { await unlink(join(root, "fail-confirm")); throw Error("fixture confirmation failure"); }
        return source.confirmComponentUpdate(...args);
      } };
    }
    if (holdCandidate && name === "./candidate-check") {
      const source = originalLoad.call(this, name, ...args);
      return { ...source, stopCandidate: () => { void writeFile(join(root, "candidate-aborted"), "1"); source.stopCandidate(); }, checkCandidateBeside: async () => {
        await writeFile(join(root, "candidate-started"), "1");
        while (!existsSync(join(root, "release-candidate")) && !existsSync(join(root, "candidate-aborted"))) await pause(5);
        return "exited";
      } };
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
    if (!holdStartup) await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway ready"), 30_000);
    await run({ root, runtime, starts, restart, offerStaged: () => onStaged() });
  } finally {
    await writeFile(join(root, "release-ready"), "ready"); await pause(600);
    runtime.app.emit("will-quit");
    await eventually(async () => (await starts()).every(pid => !alive(pid)));
    Module._load = originalLoad; globalThis.fetch = originalFetch;
    previous === undefined ? delete process.env.BRANCH_DESKTOP_DATA : process.env.BRANCH_DESKTOP_DATA = previous;
    previousCandidateMin === undefined ? delete process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB : process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB = previousCandidateMin;
    delete process.env.BRANCH_DESKTOP_READY_TIMEOUT_MS;
    await rm(root, { recursive: true, force: true });
  }
}
const swapped = async (root, count = 1) => (await readFile(join(root, "desktop.log"), "utf8")).split("engine swapped in place").length - 1 >= count;
async function stageFixtureUpdate(root) {
  const { engineDir, windowDir } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const stagedEngine = join(root, "staged-engine"), previousWindow = join(root, "previous-window");
  await mkdir(join(stagedEngine, "dist"), { recursive: true });
  await copyFile(join(engineDir, "branch.mjs"), join(stagedEngine, "branch.mjs"));
  await copyFile(join(engineDir, "dist", "build-info.json"), join(stagedEngine, "dist", "build-info.json"));
  await rename(windowDir, previousWindow);
  await mkdir(windowDir);
  await writeFile(join(windowDir, "index.html"), "<html>staged window</html>");
  await writeFile(join(root, "engine-current.txt"), `${stagedEngine}\n`);
  await writeFile(join(root, "component-update-pending.json"), JSON.stringify({ version: "fixture-next", phase: "pending",
    enginePrevious: "", engineNext: stagedEngine, windowPrevious: previousWindow, windowExisted: true,
    identity: { version: "fixture-next", engineSha256: "engine", windowSha256: "window" } }));
  return { engineDir, stagedEngine, previousWindow, windowDir };
}
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
test("crash recovery keeps the running engine and staged engine/window update pending", () => fixture(async ({ root, runtime, starts, offerStaged }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { engineDir, stagedEngine, previousWindow, windowDir } = await stageFixtureUpdate(root);
  offerStaged();
  await eventually(() => sent.some(([channel, value]) => channel === "branch-desktop:engine-update" && value === "auto-wait"));
  const first = (await starts())[0];
  await writeFile(join(root, "release-ready"), "ready");
  process.kill(first, "SIGTERM");
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway recovered after unexpected exit"));
  const log = await readFile(join(root, "desktop.log"), "utf8");
  assert.equal(log.split(`gateway started from ${engineDir}, pid`).length - 1, 2);
  assert.equal((await starts()).length, 2, "Recovery started the staged engine");
  assert.equal((await readFile(join(root, "engine-current.txt"), "utf8")).trim(), stagedEngine);
  assert.equal(JSON.parse(await readFile(join(root, "component-update-pending.json"), "utf8")).phase, "pending");
  assert.equal(await readFile(join(previousWindow, "index.html"), "utf8"), "<html>fixture</html>");
  assert.equal(await readFile(join(windowDir, "index.html"), "utf8"), "<html>staged window</html>");
  const { windowPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  assert.equal(await (await fetch(`http://127.0.0.1:${windowPort}/`)).text(), "<html>fixture</html>");
  assert.equal(sent.filter(([channel, value]) => channel === "branch-desktop:engine-update" && value === "updated").length, 0);
  assert.equal(runtime.window.reloads, 0);
}));
test("a crash during candidate rejection aborts it and restarts the dead engine", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  await stageFixtureUpdate(root);
  restart();
  await eventually(() => sent.some(([channel, value]) => channel === "branch-desktop:engine-update" && value === "preparing"));
  await writeFile(join(root, "release-ready"), "ready");
  process.kill((await starts())[0], "SIGTERM");
  await eventually(() => existsSync(join(root, "candidate-aborted")), 10_000);
  await eventually(async () => (await starts()).length === 2 && alive((await starts())[1]), 30_000);
  assert.equal(existsSync(join(root, "release-candidate")), false);
  assert.equal((await starts()).length, 2);
  assert.equal(sent.some(([channel]) => channel === "branch-desktop:gateway-recovery-failed"), false);
}, false, { maxAttempts: 4, initialDelayMs: 10, maxDelayMs: 80, stableAfterMs: 60_000 }, true));
test("an Update click during a pending crash restart lets the restart win; the update works afterwards", () => fixture(async ({ root, runtime, starts, restart }) => {
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  await writeFile(join(root, "release-ready"), "ready");
  const crashed = (await starts())[0];
  process.kill(crashed, "SIGTERM");
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway restart attempt"));
  restart();
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway recovered after unexpected exit"));
  const log = await readFile(join(root, "desktop.log"), "utf8");
  assert.match(log, /update requested while the engine is restarting; recovery runs first/);
  assert.doesNotMatch(log, /update requested \(/, "the click started an update with no engine serving");
  const recovered = (await starts())[1];
  assert.equal((await starts()).length, 2); assert.equal(alive(recovered), true); assert.equal(await servingOn(gatewayPort), true);
  restart(); await eventually(() => swapped(root));
  assert.equal((await starts()).length, 3, "the update after recovery did not run once");
  assert.equal(runtime.errors.length, 0);
}));
test("an Update click with a failing candidate while a crash restart waits never leaves zero engines", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  await stageFixtureUpdate(root);
  // The candidate check would reject this release at once; the crash restart waits about 2 s.
  await writeFile(join(root, "release-candidate"), "exits"); await writeFile(join(root, "release-ready"), "ready");
  const crashed = (await starts())[0];
  process.kill(crashed, "SIGTERM");
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway restart attempt"));
  restart();
  await eventually(async () => { const latest = (await starts()).at(-1); return latest !== crashed && alive(latest) && await servingOn(gatewayPort); }, 20_000);
  const log = await readFile(join(root, "desktop.log"), "utf8");
  assert.doesNotMatch(log, /candidate check beside the running engine/, "the click ran the candidate check with no engine serving");
  assert.equal(sent.some(([channel, state]) => channel === "branch-desktop:engine-update" && state === "kept"), false,
    "the owner was told the current version was kept while nothing served");
  assert.equal(sent.some(([channel]) => channel === "branch-desktop:gateway-recovery-failed"), false);
}, false, { maxAttempts: 2, initialDelayMs: 2000, maxDelayMs: 2000, stableAfterMs: 60_000 }, true));
test("a serving engine crash aborts a held candidate check and recovers before its deadline", () => fixture(async ({ root, starts, restart }) => {
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  await stageFixtureUpdate(root);
  const old = (await starts())[0];
  await writeFile(join(root, "release-ready"), "ready");
  restart();
  await eventually(() => existsSync(join(root, "candidate-started")), 10_000);
  process.kill(old, "SIGTERM");
  await eventually(() => existsSync(join(root, "candidate-aborted")), 10_000);
  await eventually(async () => { const latest = (await starts()).at(-1); return latest !== old && alive(latest) && await servingOn(gatewayPort); }, 30_000);
  assert.equal(existsSync(join(root, "release-candidate")), false, "recovery waited for the candidate deadline");
}, false, { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 10, stableAfterMs: 60_000 }, true));
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
  // Nothing served after the failure: the previous build comes back first (a click never cancels that), then the
  // owner's retry runs.
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway recovered after unexpected exit"));
  restart(); await eventually(() => swapped(root));
  assert.equal((await starts()).length, 4); assert.equal(runtime.errors.length, 1);
}, false, false, false, "never"));
test("a standby that exits early falls through to the guarded swap without another click", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const old = (await starts())[0];
  await writeFile(join(root, "fail-next"), "fail"); await writeFile(join(root, "release-ready"), "ready"); restart();
  await eventually(() => swapped(root), 30_000);
  const failed = (await starts())[1];
  await eventually(() => !alive(failed));
  assert.equal(alive(old), false);
  assert.equal(existsSync(join(root, `drained-${old}`)), true);
  assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/readyz`)).status, 200);
  assert.equal((await starts()).length, 3, "the retry started more than one standby");
}, false, false, false, true));
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
test("standby takes a separate loopback port before desktop hands the resident window to it", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const old = (await starts())[0];
  await writeFile(join(root, "hold-standby"), "wait");
  await writeFile(join(root, "release-ready"), "ready");
  restart();
  try {
    await eventually(async () => (await starts()).length === 2);
    const standby = (await starts())[1];
    await eventually(() => existsSync(join(root, `launch-${standby}.json`)));
    const launch = JSON.parse(await readFile(join(root, `launch-${standby}.json`), "utf8"));
    assert.equal(launch.standby, true, "desktop did not start a standby before stopping the old engine");
    assert.notEqual(launch.port, gatewayPort, "standby tried to claim the old engine's live port");
    assert.equal(alive(old), true, "old engine stopped before standby was ready");
    assert.equal((await fetch(`http://127.0.0.1:${gatewayPort}/readyz`)).status, 200);
  } finally {
    await unlink(join(root, "hold-standby")).catch(() => undefined);
  }
  await eventually(() => sent.some(([channel]) => channel === "branch-desktop:engine-handoff"), 40_000);
  const successor = (await starts())[1];
  const launch = JSON.parse(await readFile(join(root, `launch-${successor}.json`), "utf8"));
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-handoff"),
    [["branch-desktop:engine-handoff", `ws://127.0.0.1:${launch.port}`]]);
  assert.equal(runtime.window.reloads, 0);
  assert.ok(await readFile(join(root, `drained-${old}`), "utf8"), "old engine did not complete its drain");
}, false, false, false, true));
test("a standby that waits for its launcher's word (#411) is told to take over only once the old engine has stopped", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const old = (await starts())[0];
  await writeFile(join(root, "release-ready"), "ready"); await writeFile(join(root, "standby-needs-take-over"), "1");
  restart();
  await eventually(() => swapped(root), 30_000);
  const standby = (await starts())[1];
  assert.deepEqual(JSON.parse(await readFile(join(root, `took-over-${standby}`), "utf8")), { oldEngineAlive: false },
    "the standby was told to take over while the old engine still ran");
  assert.equal(alive(old), false); assert.equal(alive(standby), true);
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-update").map(([, state]) => state), ["updating", "updated"]);
}, false, false, false, true));
test("after a standby handoff the window and the next swap follow the live port; the configured port is untouched", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const info = () => { const event = { sender: runtime.window.webContents, senderFrame: runtime.window.webContents.mainFrame }; runtime.ipcMain.emit("branch-desktop:info", event); return event.returnValue; };
  await writeFile(join(root, "release-ready"), "ready");
  restart(); await eventually(() => swapped(root));
  const first = JSON.parse(await readFile(join(root, `launch-${(await starts())[1]}.json`), "utf8"));
  assert.equal(first.token, "isolated-fixture-token", "the standby did not share the window's token");
  assert.deepEqual(info(), { gatewayUrl: `ws://127.0.0.1:${first.port}`, gatewayToken: "isolated-fixture-token" });
  assert.equal(JSON.parse(await readFile(join(root, "desktop.json"), "utf8")).gatewayPort, gatewayPort);
  restart(); await eventually(() => swapped(root, 2));
  const second = JSON.parse(await readFile(join(root, `launch-${(await starts())[2]}.json`), "utf8"));
  assert.notEqual(second.port, first.port, "the second standby tried to claim the live engine's port");
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-handoff").map(([, url]) => url),
    [`ws://127.0.0.1:${first.port}`, `ws://127.0.0.1:${second.port}`]);
  assert.equal(info().gatewayUrl, `ws://127.0.0.1:${second.port}`);
  assert.equal(await readFile(join(root, "gateway-port"), "utf8"), String(second.port), "the branch command would dial a stale port");
  assert.equal((await starts()).length, 3);
}, false, false, false, true));
test("a busy engine from before drain-stop is never killed by an update click; the update is offered again", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const old = (await starts())[0]; await writeFile(join(root, "older-engine"), "1"); await writeFile(join(root, "busy"), "a Trunk is working");
  restart();
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("update failed"), 40_000);
  assert.equal(alive(old), true, "A busy engine that cannot drain was killed");
  const launched = await starts();
  assert.equal(launched.length, 2, "only the read-only standby may start while the first engine is busy");
  await eventually(() => !alive(launched[1]));
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-update").map(([, state]) => state), ["updating", "auto-wait"]);
}, false, false, false, true));
test("a busy engine from before drain-stop is never killed by the guarded swap either", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const old = (await starts())[0]; await writeFile(join(root, "older-engine"), "1"); await writeFile(join(root, "busy"), "a Trunk is working");
  restart();
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("update failed"), 40_000);
  assert.equal(alive(old), true, "A busy engine that cannot drain was killed");
  assert.equal((await starts()).length, 1, "A second engine started while the first was busy");
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-update").map(([, state]) => state), ["updating", "auto-wait"]);
}));
test("an early standby exit uses the guarded stop/start swap in the same Update click", () => fixture(async ({ root, runtime, starts, restart }) => {
  const old = (await starts())[0];
  await writeFile(join(root, "fail-standby"), "fail"); await writeFile(join(root, "release-ready"), "ready");
  restart(); await eventually(() => swapped(root));
  assert.match(await readFile(join(root, "desktop.log"), "utf8"), /standby exited before warming; using the guarded stop\/start swap/);
  const launched = await starts();
  assert.equal(launched.length, 3);
  assert.equal(JSON.parse(await readFile(join(root, `launch-${launched[2]}.json`), "utf8")).standby, false);
  assert.ok(existsSync(join(root, `drained-${old}`)));
}, false, false, false, true));
test("quitting while a standby warms stops it; nothing is left running", () => fixture(async ({ root, runtime, starts, restart }) => {
  await writeFile(join(root, "hold-standby"), "wait");
  restart();
  await eventually(async () => (await starts()).length === 2);
  const warming = (await starts())[1];
  runtime.app.emit("will-quit");
  await eventually(() => !alive(warming));
  assert.equal(existsSync(join(root, "hold-standby")), true, "the standby finished warming instead of being stopped");
  assert.equal(await readFile(join(root, "gateway-port"), "utf8"),
    String(JSON.parse(await readFile(join(root, "desktop.json"), "utf8")).gatewayPort), "quit left a moved port behind");
}, false, false, false, true));
test("a window build that arrives with a standby update hands the window the new port before it reloads", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const reload = runtime.window.webContents.reload; runtime.window.webContents.reload = () => { sent.push(["reload"]); reload(); };
  const { windowDir } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  await writeFile(join(root, "release-ready"), "ready"); await writeFile(join(root, "hold-standby"), "wait");
  restart();
  await eventually(async () => (await starts()).length === 2);
  await writeFile(join(windowDir, "branch-build.txt"), "build-next");
  await unlink(join(root, "hold-standby"));
  await eventually(() => swapped(root));
  const launch = JSON.parse(await readFile(join(root, `launch-${(await starts())[1]}.json`), "utf8"));
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-handoff").map(([, url]) => url), [`ws://127.0.0.1:${launch.port}`]);
  await eventually(() => sent.some(([channel]) => channel === "reload"), 20_000);
  assert.ok(sent.findIndex(([channel]) => channel === "branch-desktop:engine-handoff") < sent.findIndex(([channel]) => channel === "reload"),
    "the window reloaded before it was given the new port");
  const event = { sender: runtime.window.webContents, senderFrame: runtime.window.webContents.mainFrame }; runtime.ipcMain.emit("branch-desktop:info", event);
  assert.equal(event.returnValue.gatewayUrl, `ws://127.0.0.1:${launch.port}`);
}, false, false, false, true));
test("a standby port taken before the engine binds it falls back to the live port without rejecting the update", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  await writeFile(join(root, "release-ready"), "ready"); await writeFile(join(root, "hold-standby"), "wait");
  await writeFile(join(root, "standby-binds-after-release"), "1");
  restart();
  await eventually(async () => (await starts()).length === 2);
  const standby = (await starts())[1];
  await eventually(() => existsSync(join(root, `launch-${standby}.json`)));
  const { port } = JSON.parse(await readFile(join(root, `launch-${standby}.json`), "utf8"));
  // Readiness probes connect to the squatter too: drop them at once, so closing it never waits on a lingering socket.
  const squatter = createServer(socket => socket.destroy()); await new Promise(resolve => squatter.listen(port, "127.0.0.1", resolve));
  try {
    await unlink(join(root, "hold-standby"));
    await eventually(() => swapped(root), 40_000);
  } finally { await new Promise(resolve => squatter.close(resolve)); }
  assert.equal(alive(standby), false);
  const launched = await starts();
  assert.equal(launched.length, 3);
  assert.deepEqual(JSON.parse(await readFile(join(root, `launch-${launched[2]}.json`), "utf8")).port, gatewayPort);
  assert.match(await readFile(join(root, "desktop.log"), "utf8"), new RegExp(`standby port ${port} was taken before the engine could bind it`));
  assert.equal(runtime.errors.length, 0);
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-handoff").map(([, url]) => url), [`ws://127.0.0.1:${gatewayPort}`]);
}, false, false, false, true));
test("an update that fails after its standby answered /readyz rolls back on the port the window already uses", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  await stageFixtureUpdate(root);
  await writeFile(join(root, "release-ready"), "ready"); await writeFile(join(root, "fail-confirm"), "1");
  restart();
  await eventually(() => sent.some(([channel, state]) => channel === "branch-desktop:engine-update" && state === "kept"), 40_000);
  assert.equal(existsSync(join(root, "fail-confirm")), false, "the confirmation failure was never exercised");
  assert.match(await readFile(join(root, "desktop.log"), "utf8"), /standby engine \d+ prepared on port/);
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-handoff"), [], "the window was moved to a rolled-back engine");
  const event = { sender: runtime.window.webContents, senderFrame: runtime.window.webContents.mainFrame }; runtime.ipcMain.emit("branch-desktop:info", event);
  assert.equal(event.returnValue.gatewayUrl, `ws://127.0.0.1:${gatewayPort}`);
  assert.equal(await readFile(join(root, "gateway-port"), "utf8"), String(gatewayPort));
  const serving = (await starts()).at(-1);
  assert.equal(alive(serving), true);
  assert.equal(JSON.parse(await readFile(join(root, `launch-${serving}.json`), "utf8")).port, gatewayPort);
}, false, false, false, true));
test("a drain whose answer times out still lands: the update completes once the old engine exits", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const old = (await starts())[0];
  await writeFile(join(root, "release-ready"), "ready"); await writeFile(join(root, "late-drain-ack"), "1");
  restart();
  await eventually(() => swapped(root), 40_000);
  assert.equal(alive(old), false);
  assert.ok(await readFile(join(root, `drained-${old}`), "utf8"), "the old engine was killed instead of drained");
  const latest = (await starts()).at(-1);
  assert.notEqual(latest, old); assert.equal(alive(latest), true); assert.equal(await servingOn(gatewayPort), true);
  assert.doesNotMatch(await readFile(join(root, "desktop.log"), "utf8"), /update failed/);
  // While the old engine drained the bar said "Updating", never "ready" or "auto-wait".
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-update").map(([, state]) => state), ["updating", "updated"]);
}));
test("an engine that exits while an update warms its standby is recovered before warmup ends", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const old = (await starts())[0];
  await writeFile(join(root, "hold-standby"), "wait");
  restart();
  await eventually(async () => (await starts()).length === 2);
  const warming = (await starts())[1];
  await writeFile(join(root, "release-ready"), "ready");
  process.kill(old, "SIGTERM");
  await eventually(() => !alive(old));
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("update failed"), 30_000);
  await eventually(async () => { const latest = (await starts()).at(-1); return ![old, warming].includes(latest) && alive(latest) && await servingOn(gatewayPort); }, 30_000);
  assert.equal(existsSync(join(root, "hold-standby")), true, "recovery waited for standby warmup");
  assert.equal(sent.some(([channel]) => channel === "branch-desktop:gateway-recovery-failed"), false, "recovery gave up");
  assert.deepEqual(runtime.errors.map(([title]) => title).filter(title => title !== "Branch couldn't finish the update"), [],
    "the owner was told recovery failed");
}, false, { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 10, stableAfterMs: 60_000 }, false, true));
test("a new engine that never became ready is stopped, not mistaken for a serving one, and the previous build returns", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const old = (await starts())[0];
  restart();
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("update failed"), 30_000);
  const unready = (await starts())[1];
  await eventually(() => !alive(unready), 20_000);
  assert.equal(alive(old), false);
  assert.deepEqual(sent.filter(([channel, state]) => channel === "branch-desktop:engine-update" && ["ready", "auto-wait"].includes(state)), [],
    "the bar offered Update with no engine serving");
  await writeFile(join(root, "release-ready"), "ready");
  await eventually(async () => { const latest = (await starts()).at(-1); return ![old, unready].includes(latest) && alive(latest) && await servingOn(gatewayPort); }, 30_000);
}, false, false, false, "never", false, async () => { process.env.BRANCH_DESKTOP_READY_TIMEOUT_MS = "3000"; }));
test("a failed new engine that outlives its SIGTERM grace is killed, and the previous build serves again", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const old = (await starts())[0];
  await writeFile(join(root, "slow-sigterm"), "1");
  restart();
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("update failed"), 40_000);
  const unready = (await starts())[1];
  // The new engine never became ready and ignored SIGTERM: it is gone before anything else starts.
  assert.equal(alive(unready), false, "a failed engine that ignored SIGTERM was left running");
  await unlink(join(root, "slow-sigterm")); await writeFile(join(root, "release-ready"), "ready");
  await eventually(async () => { const latest = (await starts()).at(-1); return ![old, unready].includes(latest) && alive(latest) && await servingOn(gatewayPort); }, 30_000);
  const recovered = (await starts()).at(-1);
  assert.deepEqual(JSON.parse(await readFile(join(root, `launch-${recovered}.json`), "utf8")).peers, [], "recovery started beside a live failed engine");
  // After recovery the bar leaves "Updating Branch…": the owner hears the current version was kept.
  await eventually(() => sent.some(([channel, state]) => channel === "branch-desktop:engine-update" && state === "kept"));
  assert.deepEqual(sent.filter(([channel, state]) => channel === "branch-desktop:engine-update" && ["ready", "auto-wait"].includes(state)), []);
}, false, false, false, "never", false, async () => { process.env.BRANCH_DESKTOP_READY_TIMEOUT_MS = "3000"; }));
test("a staged engine that times out and outlives its SIGTERM grace is gone before the retained build starts", () => fixture(async ({ root, starts, restart }) => {
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  await stageFixtureUpdate(root);
  await writeFile(join(root, "slow-sigterm"), "1");
  restart();
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("restored prior components"), 40_000);
  const unready = (await starts())[1];
  await unlink(join(root, "slow-sigterm")); await writeFile(join(root, "release-ready"), "ready");
  await eventually(async () => (await starts()).length >= 3 && await servingOn(gatewayPort), 30_000);
  const retained = (await starts())[2];
  assert.equal(alive(unready), false);
  // The retained build never waited on the failed engine's state: that engine was gone before it started.
  assert.deepEqual(JSON.parse(await readFile(join(root, `launch-${retained}.json`), "utf8")).peers, []);
}, false, false, false, "never", false, async () => { process.env.BRANCH_DESKTOP_READY_TIMEOUT_MS = "3000"; }));
test("a drain reply that arrives after the drain wait still finishes the update instead of failing it", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const old = (await starts())[0];
  await writeFile(join(root, "release-ready"), "ready"); await writeFile(join(root, "slow-drain-reply"), "1");
  restart();
  await eventually(() => swapped(root), 40_000);
  assert.equal(alive(old), false); assert.ok(existsSync(join(root, `drained-${old}`)), "the old engine did not drain");
  const log = await readFile(join(root, "desktop.log"), "utf8");
  assert.doesNotMatch(log, /update failed|became busy/);
  assert.match(log, /old engine drained/);
  assert.equal(await servingOn(gatewayPort), true);
  assert.deepEqual(sent.filter(([channel]) => channel === "branch-desktop:engine-update").map(([, state]) => state), ["updating", "updated"]);
}));
test("quitting while the new engine boots never rejects the release or starts another engine", () => fixture(async ({ root, runtime, starts, restart }) => {
  await stageFixtureUpdate(root);
  restart();
  await eventually(async () => (await starts()).length === 2);
  await pause(500);
  let deferred = false;
  runtime.app.emit("will-quit", { preventDefault() { deferred = true; } });
  assert.equal(deferred, true);
  await eventually(async () => (await starts()).every(pid => !alive(pid)), 20_000);
  await pause(1500);
  assert.equal((await starts()).length, 2, "an engine started after quit");
  assert.equal(existsSync(join(root, "component-update-rejected.json")), false, "a healthy release was rejected for a quit");
  assert.doesNotMatch(await readFile(join(root, "desktop.log"), "utf8"), /restored prior components|Updated engine failure/);
}));
test("launch retires the engines the last session recorded and left holding their ports, and nothing else", async () => {
  const { spawn } = await import("node:child_process");
  const { engineProcessIdentity } = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, "engine-records.js"));
  const holdPort = "const s=require('net').createServer().listen(0,'127.0.0.1',()=>process.send(s.address().port));setInterval(()=>{},1000)";
  const orphan = spawn(process.execPath, ["-e", holdPort], { stdio: ["ignore", "ignore", "ignore", "ipc"], detached: process.platform !== "win32" });
  const orphanPort = await new Promise(resolve => orphan.once("message", resolve));
  // A reused PID on an occupied port, or a matching process that does not own that port, is never touched.
  const bystander = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  try {
    await fixture(async ({ root, starts }) => {
      await eventually(() => !alive(orphan.pid), 10_000);
      assert.equal(alive(bystander.pid), true, "a reused PID was stopped");
      assert.match(await readFile(join(root, "desktop.log"), "utf8"), new RegExp(`retiring the last session's standby engine ${orphan.pid} on port ${orphanPort}`));
      // Only the engine this launch started is recorded now.
      assert.deepEqual(JSON.parse(await readFile(join(root, "gateway-engines.json"), "utf8")).map(record => record.pid), await starts());
    }, false, false, false, "never", false, async (root) => {
      const orphanIdentity = engineProcessIdentity(orphan.pid), bystanderIdentity = engineProcessIdentity(bystander.pid);
      assert.ok(orphanIdentity && bystanderIdentity);
      await writeFile(join(root, "gateway-engines.json"), JSON.stringify([
        { pid: orphan.pid, port: orphanPort, role: "standby", ...orphanIdentity },
        { pid: bystander.pid, port: orphanPort, role: "candidate", ...bystanderIdentity, started: "reused-pid" },
        { pid: bystander.pid, port: orphanPort, role: "candidate", ...bystanderIdentity },
      ]));
    });
  } finally {
    orphan.kill(); bystander.kill();
  }
});
test("launch refuses plainly when the last session's engine still runs on a moved port", async () => {
  const squatter = createServer(); await new Promise(resolve => squatter.listen(0, "127.0.0.1", resolve));
  const { spawn } = await import("node:child_process");
  const orphan = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  try {
    await fixture(async ({ runtime }) => {
      await eventually(() => runtime.errors.length === 1);
      assert.equal(runtime.errors[0][0], "Branch Agent could not start");
      assert.match(runtime.errors[0][1], new RegExp(`still running \\(process ${orphan.pid} on port ${squatter.address().port}\\)`));
    }, true, false, false, "never", false, async (root) => {
      await writeFile(join(root, "gateway-port"), String(squatter.address().port));
      await writeFile(join(root, "gateway.pid"), String(orphan.pid));
    });
  } finally {
    orphan.kill(); await new Promise(resolve => squatter.close(resolve));
  }
});
test("a standby that fails after the old engine drained brings the previous build back", () => fixture(async ({ root, runtime, starts, restart }) => {
  const sent = []; runtime.window.webContents.send = (channel, value) => sent.push([channel, value]);
  const { gatewayPort, engineDir } = JSON.parse(await readFile(join(root, "desktop.json"), "utf8"));
  const old = (await starts())[0];
  await writeFile(join(root, "release-ready"), "ready"); await writeFile(join(root, "standby-exits-after-release"), "1");
  restart();
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("update failed"), 30_000);
  const standby = (await starts())[1];
  await eventually(async () => { const latest = (await starts()).at(-1); return ![old, standby].includes(latest) && alive(latest) && await servingOn(gatewayPort); }, 30_000);
  assert.equal(alive(old), false); assert.equal(alive(standby), false);
  const log = await readFile(join(root, "desktop.log"), "utf8");
  assert.ok(log.lastIndexOf(`gateway started from ${engineDir}`) > log.indexOf("update failed"), "the previous build was not restarted");
  assert.ok(sent.some(([channel]) => channel === "branch-desktop:engine-update-failed"));
}, false, false, false, true));
test("a new window build swaps in place after attached files are sent, keeping the engine", () => fixture(async ({ root, runtime, starts }) => {
  const main = runtime.window;
  await runtime.handlers.get("branch-desktop:open-conversation")(
    { sender: main.webContents, senderFrame: main.webContents.mainFrame }, "agent:test:one");
  const child = runtime.windows[1];
  let files = true;
  for (const w of [main, child]) {
    const owner = w.webContents;
    owner.send = (channel, id) => {
      const event = { sender: owner, senderFrame: owner.mainFrame };
      if (channel === "branch-desktop:auto-apply:probe") setTimeout(() => runtime.ipcMain.emit("branch-desktop:auto-apply:result", event, id, { pendingApprovals: 0, streaming: false, unsavedDraftFiles: w === child && files }), 5);
      if (channel === "branch-desktop:prepare-swap") setTimeout(() => runtime.ipcMain.emit("branch-desktop:swap-ready", event, id), 5);
    };
  }
  const windowDir = JSON.parse(await readFile(join(root, "desktop.json"), "utf8")).windowDir;
  await writeFile(join(windowDir, "branch-build.txt"), "build-a"); await pause(3500);
  await writeFile(join(windowDir, "branch-build.txt"), "build-b"); await pause(4000);
  assert.equal(runtime.window.reloads, 0, "The swap dropped attached files");
  assert.equal(child.reloads, 0, "The pop-out dropped attached files");
  files = false; await eventually(() => runtime.window.reloads === 1);
  assert.equal(child.reloads, 1, "The pop-out kept running the old window build");
  assert.equal((await starts()).length, 1, "A window update restarted the engine");
}));
test("conversation IPC authenticates frames, tracks retargets, and guards a closed main window", () => fixture(async ({ runtime }) => {
  const main = runtime.window;
  const event = (w) => ({ sender: w.webContents, senderFrame: w.webContents.mainFrame });
  const info = event(main);
  runtime.ipcMain.emit("branch-desktop:info", info);
  assert.equal(typeof info.returnValue.gatewayToken, "string");
  const foreign = { sender: { getURL: () => main.url }, senderFrame: main.webContents.mainFrame };
  runtime.ipcMain.emit("branch-desktop:info", foreign);
  assert.equal(foreign.returnValue, null);
  await runtime.handlers.get("branch-desktop:open-conversation")(event(main), "agent:test:one");
  const child = runtime.windows[1];
  assert.ok(child);
  assert.deepEqual(runtime.handlers.get("branch-desktop:conversation-windows")(event(main)), ["agent:test:one"]);
  const childInfo = event(child);
  runtime.ipcMain.emit("branch-desktop:info", childInfo);
  assert.equal(childInfo.returnValue.gatewayToken, info.returnValue.gatewayToken);
  assert.throws(() => runtime.handlers.get("branch-desktop:open-main-route")(event(main), { kind: "chat", key: "agent:test:one" }));
  await runtime.handlers.get("branch-desktop:retarget-conversation-window")(event(child), "agent:test:two");
  assert.deepEqual(runtime.handlers.get("branch-desktop:conversation-windows")(event(main)), ["agent:test:two"]);
  await runtime.handlers.get("branch-desktop:open-main-route")(event(child), { kind: "chat", key: "agent:test:two" });
  main.destroy();
  await runtime.handlers.get("branch-desktop:close-conversation-window")(event(child));
  assert.equal(child.isDestroyed(), true);
}));
test("closing the main window with Keep working off closes pop-outs and quits", () => fixture(async ({ runtime }) => {
  const main = runtime.window;
  const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  await runtime.handlers.get("branch-desktop:open-conversation")(event, "agent:test:one");
  const child = runtime.windows[1];
  let quits = 0;
  runtime.app.on("will-quit", () => { quits++; });
  main.close();
  assert.equal(main.isDestroyed(), true);
  assert.equal(child.isDestroyed(), true);
  assert.equal(quits, 1);
}, false, false, false, false, true));
test("engine handoff and update notices reach the main window and every pop-out", () => fixture(async ({ root, runtime, restart }) => {
  const main = runtime.window;
  await runtime.handlers.get("branch-desktop:open-conversation")(
    { sender: main.webContents, senderFrame: main.webContents.mainFrame }, "agent:test:one");
  const child = runtime.windows[1];
  const mainEvents = [], childEvents = [];
  main.webContents.send = (...args) => mainEvents.push(args);
  child.webContents.send = (...args) => childEvents.push(args);
  await writeFile(join(root, "release-ready"), "ready");
  restart();
  await eventually(() => childEvents.some(([channel]) => channel === "branch-desktop:engine-handoff"));
  for (const events of [mainEvents, childEvents]) {
    assert.ok(events.some(([channel, state]) => channel === "branch-desktop:engine-update" && state === "updating"));
    assert.ok(events.some(([channel, url]) => channel === "branch-desktop:engine-handoff" && /^ws:\/\/127\.0\.0\.1:\d+$/.test(url)));
    assert.ok(events.some(([channel, state]) => channel === "branch-desktop:engine-update" && state === "updated"));
  }
}));
test("a restart request during first launch preserves its starting gateway", () => fixture(async ({ root, starts, restart }) => {
  await eventually(async () => (await starts()).length === 1);
  const candidate = (await starts())[0]; restart();
  assert.equal(alive(candidate), true, "An initial startup request killed the launching gateway");
  await unlink(join(root, "hold-startup"));
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway ready"));
  assert.equal((await starts()).length, 1);
}, true));
