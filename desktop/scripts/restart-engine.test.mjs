import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error("Compile the exact desktop source before testing");
const require = createRequire(import.meta.url), Module = require("node:module");
const originalLoad = Module._load, originalFetch = globalThis.fetch;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function eventually(predicate) {
  const end = Date.now() + 8000;
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
    maximize() {} isMaximized() { return false; } isDestroyed() { return false; } getNormalBounds() { return { x: 0, y: 0, width: 1280, height: 840 }; }
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
http.createServer((q,r)=>{r.writeHead(starts.length===1&&!fs.existsSync(root+"/hold-startup")||fs.existsSync(root+"/release-ready")?200:503).end();}).listen(Number(process.argv.at(-1)),"127.0.0.1");`;
  await writeFile(join(engine, "branch.mjs"), script); await writeFile(join(windowDir, "index.html"), "<html>fixture</html>");
  await writeFile(join(root, "gateway-token"), "isolated-fixture-token");
  await writeFile(join(root, "desktop.json"), JSON.stringify({ dataDir: root, engineDir: engine, windowDir,
    nodePath: process.execPath, gatewayPort: await freePort(), windowPort: await freePort() }));
}
async function fixture(run, holdStartup = false) {
  const scratch = join(tmpdir(), "Codex-session-files"); await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, "branch-restart-")); await createFixtureFiles(root);
  const previous = process.env.BRANCH_DESKTOP_DATA; process.env.BRANCH_DESKTOP_DATA = root;
  const runtime = electronFixture(), starts = async () => {
    try { return JSON.parse(await readFile(join(root, "starts.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
  };
  if (holdStartup) await writeFile(join(root, "hold-startup"), "wait");
  Module._load = function(name, ...args) { return name === "electron" ? runtime.electron : originalLoad.call(this, name, ...args); };
  globalThis.fetch = (url, options) => String(url).startsWith("https://github.com/") ? Promise.resolve(new Response("", { status: 404 })) : originalFetch(url, options);
  for (const file of Object.keys(require.cache)) if (file.replaceAll("\\", "/").startsWith(process.env.BRANCH_DESKTOP_TEST_DIST)) delete require.cache[file];
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
test("a second restart click preserves the gateway already starting", () => fixture(async ({ root, runtime, starts, restart }) => {
  restart(); await eventually(async () => (await starts()).length === 2);
  const candidate = (await starts())[1]; restart();
  assert.equal(alive(candidate), true, "The second click killed the first replacement gateway");
  await writeFile(join(root, "release-ready"), "ready"); await eventually(() => runtime.window.reloads === 1);
  assert.equal((await starts()).length, 2); assert.equal(runtime.errors.length, 0);
}));
test("a failed restart releases the guard for the next owner retry", () => fixture(async ({ root, runtime, starts, restart }) => {
  await writeFile(join(root, "fail-next"), "fail"); restart(); await eventually(() => runtime.errors.length === 1);
  await unlink(join(root, "fail-next")); await writeFile(join(root, "release-ready"), "ready");
  restart(); await eventually(() => runtime.window.reloads === 1);
  assert.equal((await starts()).length, 3); assert.equal(runtime.errors.length, 1);
}));
test("a restart request during first launch preserves its starting gateway", () => fixture(async ({ root, starts, restart }) => {
  await eventually(async () => (await starts()).length === 1);
  const candidate = (await starts())[0]; restart();
  assert.equal(alive(candidate), true, "An initial startup request killed the launching gateway");
  await unlink(join(root, "hold-startup"));
  await eventually(async () => (await readFile(join(root, "desktop.log"), "utf8")).includes("gateway ready"));
  assert.equal((await starts()).length, 1);
}, true));
