import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, readlink, rm, symlink, writeFile, rename } from "node:fs/promises";
import { createServer } from "node:http";
import { createServer as createPortProbe } from "node:net";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync, gunzipSync } from "node:zlib";
import test, { mock } from "node:test";
import { makeComponentRelease } from "./make-component-release.mjs";
import { bundleNode, validateRuntime } from "./bundle-node.mjs";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const source = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update.js")));
const { createComponentUpdateController } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update-ipc.js")));
const { parseComponentRelease } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update-manifest.js")));
const { defaultDataDirectory } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "config.js")));
const { readToken } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));
const { GatewayReadinessTimeoutError } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "gateway.js")));
const { bootSelectedEngineWithRollback } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "boot-selected-engine.js")));

async function fixture(run, modify = () => {}) {
  const parent = join(tmpdir(), "Codex-session-files", "resume-desktop-updater-20261003");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "fixture-"));
  const engine = join(root, "source-engine"); const window = join(root, "source-window");
  const output = join(root, "release"); const dataDir = join(root, "data");
  const cfg = { dataDir, windowDir: join(dataDir, "window-current"), engineDir: join(root, "old-engine") };
  await mkdir(join(engine, "dist"), { recursive: true }); await mkdir(window); await mkdir(cfg.windowDir, { recursive: true });
  await writeFile(join(engine, "branch.mjs"), "console.log('fixture');\n");
  await writeFile(join(engine, "dist", "build-info.json"), '{"version":"new"}');
  await writeFile(join(engine, "dist", "entry.js"), "export {};\n");
  await writeFile(join(engine, "dist", "large.bin"), Buffer.alloc(2 * 1024 * 1024, 19));
  await writeFile(join(window, "index.html"), "<title>new window</title>");
  await writeFile(join(cfg.windowDir, "index.html"), "old window");
  await writeFile(join(dataDir, "engine-current.txt"), cfg.engineDir + "\n");
  const release = await makeComponentRelease({ version: "0.4.3", tag: "v0.4.3", engine, window, output });
  await modify({ root, engine, window, output, cfg, release });
  const requests = [];
  const server = createServer((request, response) => {
    const filename = request.url?.slice(1);
    if (filename === `branch-release-${process.platform}-${process.arch}.json`) { response.end(JSON.stringify(release)); return; }
    if (!Object.values(release.components).some(asset => asset.url.endsWith("/" + filename))) { response.writeHead(404).end(); return; }
    createReadStream(join(output, filename)).on("error", () => response.destroy()).pipe(response);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const request = async (url, options) => {
    requests.push(String(url));
    const filename = new URL(url).pathname.split("/").at(-1);
    const response = await fetch(`http://127.0.0.1:${port}/${filename}`, options);
    // Real loopback HTTP bytes; production still validates the real GitHub redirect URL.
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  try { await run({ root, engine, window, output, cfg, release, request, requests }); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
}

async function unchanged(cfg) {
  assert.equal(await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8"), cfg.engineDir + "\n");
  assert.equal(await readFile(join(cfg.windowDir, "index.html"), "utf8"), "old window");
}

async function damage({ output, release }, change) {
  const asset = release.components.engine;
  const file = join(output, new URL(asset.url).pathname.split("/").at(-1));
  const tar = gunzipSync(await readFile(file)); change(tar);
  const compressed = gzipSync(tar); await writeFile(file, compressed);
  asset.bytes = compressed.length; asset.sha256 = createHash("sha256").update(compressed).digest("hex");
}
function checksum(tar) {
  tar.fill(32, 148, 156);
  tar.write(tar.subarray(0, 512).reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8);
}

test("real HTTP manifest/archive download stages complete components without restarting engine", async () => fixture(async ({ cfg, request }) => {
  assert.equal(await source.refreshComponentUpdate(cfg, request), true);
  const selected = (await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim();
  assert.notEqual(selected, cfg.engineDir);
  assert.equal((await readFile(join(selected, "dist", "large.bin"))).length, 2 * 1024 * 1024);
  assert.equal(await readFile(join(cfg.windowDir, "index.html"), "utf8"), "<title>new window</title>");
  assert.equal(await source.refreshComponentUpdate(cfg, request), false, "pending engine update prevents another publication");
  assert.equal(await source.rollbackComponentUpdate(cfg), true);
  await unchanged(cfg);
}));

test("manual component bridge checks configured release then stages actual HTTP archives while retaining the running engine", async () => fixture(async ({ cfg, request, requests }) => {
  await writeFile(join(cfg.dataDir, "engine-running.txt"), cfg.engineDir + "\n");
  const controller = createComponentUpdateController(cfg, { request });
  const checked = await controller.check();
  assert.equal(checked.phase, "available"); await unchanged(cfg);
  assert.equal(requests.length, 1);
  const [staged, automatic] = await Promise.all([controller.stage(), source.refreshComponentUpdate(cfg, request)]);
  assert.equal(staged.phase, "staged"); assert.equal(staged.pendingVersion, "0.4.3");
  assert.equal(automatic, true, "manual and startup/hourly staging share one component publication");
  assert.equal(await readFile(join(cfg.dataDir, "engine-running.txt"), "utf8"), cfg.engineDir + "\n");
  assert.equal(requests.length, 4);
  assert.ok(requests.every(url => url.startsWith("https://github.com/KeepOak/Branch-Agent/releases/")));
  assert.equal(await source.rollbackComponentUpdate(cfg), true); await unchanged(cfg);
}));

test("readiness confirmation records version and repeated poll avoids assets", async () => fixture(async ({ cfg, request, requests }) => {
  await source.refreshComponentUpdate(cfg, request); await source.confirmComponentUpdate(cfg);
  assert.equal(await readFile(join(cfg.dataDir, "component-update-version.txt"), "utf8"), "0.4.3\n");
  requests.length = 0;
  assert.equal(await source.refreshComponentUpdate(cfg, request), false);
  assert.equal(requests.length, 1);
  assert.equal(await source.rollbackComponentUpdate(cfg), false);
}));

test("new per-user installation stages components and creates a stable local token", async () => fixture(async ({ cfg, request }) => {
  await rm(cfg.windowDir, { recursive: true }); await rm(join(cfg.dataDir, "engine-current.txt"));
  const token = readToken(cfg); assert.match(token, /^[a-f0-9]{64}$/); assert.equal(readToken(cfg), token);
  assert.equal(await source.refreshComponentUpdate(cfg, request), true);
  await source.confirmComponentUpdate(cfg);
  assert.equal(await readFile(join(cfg.windowDir, "index.html"), "utf8"), "<title>new window</title>");
}));

test("packaging bundles a real Node24 runtime with hash receipt", async () => fixture(async ({ root }) => {
  const resources = join(root, "resources"); const receipt = await bundleNode(resources);
  assert.match(receipt.version, /^v24\./);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(resources, "node", process.platform === "win32" ? "node.exe" : "node"))) hash.update(chunk);
  assert.equal(hash.digest("hex"), receipt.sha256);
}));

test("runtime validation refuses unsupported minor versions and a foreign package target", () => {
  assert.throws(() => validateRuntime({ version: "v24.8.0", platform: "win32", arch: "x64" }, { platform: "win32", arch: "x64" }), /24.16/);
  assert.throws(() => validateRuntime({ version: "v24.19.0", platform: "darwin", arch: "arm64" }, { platform: "win32", arch: "x64" }), /platform/);
  assert.doesNotThrow(() => validateRuntime({ version: "v24.16.0", platform: "win32", arch: "x64" }, { platform: "win32", arch: "x64" }));
});

test("an external publication is retained rather than overwritten by updater rollback", async () => fixture(async ({ cfg, request }) => {
  await source.refreshComponentUpdate(cfg, request);
  const external = join(cfg.dataDir, "owner-published-engine");
  await writeFile(join(cfg.dataDir, "engine-current.txt"), external);
  await assert.rejects(source.confirmComponentUpdate(cfg), /changed before/);
  await assert.rejects(source.rollbackComponentUpdate(cfg), /changed outside/);
  assert.equal(await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8"), external);
}));

test("damaged SHA256 leaves current pointer/window unchanged and deletes private stage", async () => fixture(async ({ cfg, request }) => {
  await assert.rejects(source.refreshComponentUpdate(cfg, request), /SHA256/); await unchanged(cfg);
  assert.deepEqual(await readdir(join(cfg.dataDir, "updates")), []);
}, ({ release }) => { release.components.window.sha256 = "0".repeat(64); }));

test("compressed byte count mismatch refuses publication", async () => fixture(async ({ cfg, request }) => {
  await assert.rejects(source.refreshComponentUpdate(cfg, request), /size mismatch/); await unchanged(cfg);
}, ({ release }) => { release.components.engine.bytes -= 1; }));

test("expanded byte count mismatch refuses publication", async () => fixture(async ({ cfg, request }) => {
  await assert.rejects(source.refreshComponentUpdate(cfg, request), /size mismatch/); await unchanged(cfg);
}, ({ release }) => { release.components.engine.expandedBytes -= 1; }));

test("archive traversal is rejected even when compressed asset hash is valid", async () => fixture(async ({ cfg, request, root }) => {
  await assert.rejects(source.refreshComponentUpdate(cfg, request), /Unsafe/); await unchanged(cfg);
  await assert.rejects(readFile(join(root, "escaped")), { code: "ENOENT" });
}, data => damage(data, tar => { tar.fill(0, 0, 100); tar.write("../../escaped", 0); checksum(tar); })));

test("malformed archive symlink entries are rejected before filesystem publication", async () => fixture(async ({ cfg, request }) => {
  await assert.rejects(source.refreshComponentUpdate(cfg, request), /link has content/); await unchanged(cfg);
}, data => damage(data, tar => { tar[156] = 50; checksum(tar); })));

test("archive checksum corruption is rejected after asset hash passes", async () => fixture(async ({ cfg, request }) => {
  await assert.rejects(source.refreshComponentUpdate(cfg, request), /header/); await unchanged(cfg);
}, data => damage(data, tar => { tar[0] ^= 1; })));

test("prepared publication interrupted after window swap restores both components", async () => fixture(async ({ cfg, root }) => {
  const backup = join(root, "previous-window"); await rename(cfg.windowDir, backup);
  await mkdir(cfg.windowDir); await writeFile(join(cfg.windowDir, "index.html"), "uncommitted window");
  await writeFile(join(cfg.dataDir, "engine-current.txt"), join(root, "uncommitted-engine"));
  await writeFile(join(cfg.dataDir, "component-update-pending.json"), JSON.stringify({ version: "0.4.3", phase: "prepared",
    enginePrevious: cfg.engineDir, engineNext: join(root, "uncommitted-engine"), windowPrevious: backup, windowExisted: true }));
  await source.recoverComponentUpdate(cfg); await unchanged(cfg);
}));

test("manifest refuses foreign repository, digest, platform and traversal version", async () => fixture(async ({ release }) => {
  for (const change of [value => { value.components.engine.url = "https://github.com/other/repo/releases/download/v1/engine.tar.gz"; },
    value => { value.components.engine.sha256 = "bad"; }, value => { value.components.engine.platform = "unsupported"; },
    value => { value.version = "../../escape"; }]) {
    const value = structuredClone(release); change(value); assert.throws(() => parseComponentRelease(value));
  }
}));

test("explicit existing data directory remains authoritative", () => {
  const previous = process.env.BRANCH_DESKTOP_DATA;
  process.env.BRANCH_DESKTOP_DATA = "C:/fixture-owner-data";
  try { assert.equal(defaultDataDirectory(), "C:/fixture-owner-data"); }
  finally { if (previous === undefined) delete process.env.BRANCH_DESKTOP_DATA; else process.env.BRANCH_DESKTOP_DATA = previous; }
});

async function eventually(predicate, timeout = 8000) {
  const end = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > end) throw new Error("Fixture deadline exceeded");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function freePort() {
  const probe = createPortProbe(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}

test("actual desktop caller retains running engine and checks a failing engine beside it, keeping the running one without restarting the app", async () => fixture(async ({ cfg, request }) => {
  const require = createRequire(import.meta.url); const Module = require("node:module");
  const load = Module._load; const previousFetch = globalThis.fetch;
  const previousData = process.env.BRANCH_DESKTOP_DATA; const previousHidden = process.env.BRANCH_DESKTOP_HIDDEN;
  const desktop = { ...cfg, nodePath: process.execPath, gatewayPort: await freePort(), windowPort: await freePort() };
  await mkdir(join(cfg.engineDir, "dist"), { recursive: true });
  await writeFile(join(cfg.engineDir, "dist", "build-info.json"), '{"version":"old"}');
  await writeFile(join(cfg.engineDir, "branch.mjs"), 'import http from "node:http"; process.on("message", m => { if(m.type?.startsWith("branch-desktop:")){ process.send({type:"branch-desktop:activity-result",id:m.id,idle:true,activeRuns:0,pendingReplies:0,totalActive:0}); if(m.type==="branch-desktop:stop-if-idle"||m.type==="branch-desktop:drain-stop")setTimeout(()=>process.exit(0),20); }}); setTimeout(()=>http.createServer((_req,res)=>res.writeHead(200).end()).listen(Number(process.argv[process.argv.indexOf("--port")+1]),"127.0.0.1"),1000);');
  await writeFile(join(cfg.dataDir, "desktop.json"), JSON.stringify(desktop));
  let relaunches = 0;
  const app = new EventEmitter(); Object.assign(app, { getVersion: () => "fixture", setPath: () => {}, setAppUserModelId: () => {},
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), relaunch: () => { relaunches++; }, quit: () => app.emit("will-quit") });
  const ipcMain = Object.assign(new EventEmitter(), { handle() {} });
  let servedAt, ownerWindow, reloads = 0; const launchedAt = Date.now();
  class BrowserWindow extends EventEmitter {
    static fromWebContents(sender) { return ownerWindow?.webContents === sender ? ownerWindow : null; }
    constructor() { super(); ownerWindow = this; this.url = ""; this.webContents = new EventEmitter(); Object.assign(this.webContents, {
      getURL: () => this.url, setWindowOpenHandler: () => {}, send: () => {}, reload: () => { reloads++; this.webContents.emit("did-finish-load"); } }); }
    async loadURL(url) { if (url.startsWith("http://")) servedAt = Date.now(); this.url = url; this.webContents.emit("did-finish-load"); }
    setMenuBarVisibility() {} show() {} isMinimized() { return false; } focus() {}
    maximize() {} isMaximized() { return false; } isDestroyed() { return false; } getNormalBounds() { return { x: 0, y: 0, width: 1280, height: 840 }; }
  }
  const electron = { app, BrowserWindow, ipcMain, screen: { getAllDisplays: () => [], getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 840 } }) }, dialog: { showErrorBox: () => assert.fail("Unexpected native caller error") },
    session: { defaultSession: { setPermissionRequestHandler: () => {} } }, shell: { openExternal: () => {} } };
  process.env.BRANCH_DESKTOP_DATA = cfg.dataDir; process.env.BRANCH_DESKTOP_HIDDEN = "1"; process.env.BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB = "0";
  Module._load = function(name, ...args) { return name === "electron" ? electron : load.call(this, name, ...args); };
  globalThis.fetch = (url, options) => String(url).startsWith("https://github.com/") ? request(url, options) : previousFetch(url, options);
  delete require.cache[require.resolve(join(process.env.BRANCH_DESKTOP_TEST_DIST, "config.js"))];
  try {
    require(join(process.env.BRANCH_DESKTOP_TEST_DIST, "main.js")); Module._load = load;
    await eventually(async () => { try { return JSON.parse(await readFile(join(cfg.dataDir, "component-update-pending.json"), "utf8")).phase === "pending"; } catch { return false; } });
    assert.ok(servedAt - launchedAt < 1000, "real renderer shell must load while the child engine is still starting");
    const phaseLog = await readFile(join(cfg.dataDir, "desktop.log"), "utf8");
    assert.ok(phaseLog.indexOf("window loaded after") < phaseLog.indexOf("gateway ready after"));
    const oldPid = Number(await readFile(join(cfg.dataDir, "gateway.pid"), "utf8"));
    assert.doesNotThrow(() => process.kill(oldPid, 0));
    assert.equal((await readFile(join(cfg.dataDir, "engine-running.txt"), "utf8")).trim(), cfg.engineDir);
    ownerWindow.draft = "unfinished component-update draft";
    await new Promise(resolve => setTimeout(resolve, 3200));
    assert.equal(reloads, 0, "component staging must not reload the renderer before owned engine activation");
    assert.equal(ownerWindow.draft, "unfinished component-update draft");
    const served = await (await previousFetch(`http://127.0.0.1:${desktop.windowPort}/index.html`)).text();
    assert.equal(served, "old window", "until the swap, the window server keeps the build the running engine started with");
    ownerWindow.webContents.mainFrame = { url: ownerWindow.url };
    ipcMain.emit("branch-desktop:restart-engine", { sender: { ...ownerWindow.webContents }, senderFrame: ownerWindow.webContents.mainFrame });
    assert.doesNotThrow(() => process.kill(oldPid, 0), "foreign restart sender cannot stop the owned child");
    ipcMain.emit("branch-desktop:restart-engine", { sender: ownerWindow.webContents, senderFrame: ownerWindow.webContents.mainFrame });
    await eventually(async () => (await readFile(join(cfg.dataDir, "desktop.log"), "utf8")).includes("kept the running engine; nothing was stopped"));
    assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /candidate check beside the running engine exited/);
    assert.equal(relaunches, 0, "an update never relaunches the app");
    assert.equal(reloads, 0, "the retained window build stays loaded");
    assert.equal((await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim(), cfg.engineDir, "the failed publication is rolled back");
    assert.equal(await readFile(join(cfg.windowDir, "index.html"), "utf8"), "old window");
    assert.match(await readFile(join(cfg.dataDir, "component-update-rejected.json"), "utf8"), /"reason":"exit"/);
    assert.doesNotThrow(() => process.kill(oldPid, 0), "the running engine was never stopped");
    assert.equal(Number(await readFile(join(cfg.dataDir, "gateway.pid"), "utf8")), oldPid);
  } finally {
    app.emit("will-quit"); Module._load = load; globalThis.fetch = previousFetch;
    if (previousData === undefined) delete process.env.BRANCH_DESKTOP_DATA; else process.env.BRANCH_DESKTOP_DATA = previousData;
    if (previousHidden === undefined) delete process.env.BRANCH_DESKTOP_HIDDEN; else process.env.BRANCH_DESKTOP_HIDDEN = previousHidden;
    await eventually(async () => { try { process.kill(Number(await readFile(join(cfg.dataDir, "gateway.pid"), "utf8")), 0); return false; } catch { return true; } });
  }
}, async ({ engine, output, release }) => {
  await writeFile(join(engine, "branch.mjs"), "process.exit(31);\n");
  for (const file of await readdir(output)) await rm(join(output, file));
  Object.assign(release, await makeComponentRelease({ version: "0.4.3", tag: "v0.4.3", engine, window: join(engine, "..", "source-window"), output }));
}));

test("a staged desktop app alone waits for the next launch and offers no in-place update", async () => fixture(async ({ cfg }) => {
  await writeFile(join(cfg.dataDir, "desktop-update-pending.json"), JSON.stringify({ phase: "staged", version: "0.4.5", kind: "asar", staged: join(cfg.dataDir, "x", "app.asar") }));
  const status = await source.readComponentUpdateStatus(cfg);
  assert.equal(status.pendingVersion, "0.4.5", "Settings still shows the staged desktop app");
  assert.equal(status.componentsPendingVersion, null, "auto-apply and the Update click never restart the app for it");
  assert.equal(status.previousWindowDir, null);
}));

test("release maker assembles distinct Windows/macOS descriptors sharing only an identical renderer", async () => fixture(async ({ root, engine, window }) => {
  const output = join(root, "assembly");
  const windows = await makeComponentRelease({ version: "0.4.3", engine, window, output, platform: "win32", arch: "x64" });
  const mac = await makeComponentRelease({ version: "0.4.3", engine, window, output, platform: "darwin", arch: "arm64" });
  assert.equal(windows.components.engine.platform, "win32"); assert.equal(windows.components.engine.arch, "x64");
  assert.equal(mac.components.engine.platform, "darwin"); assert.equal(mac.components.engine.arch, "arm64");
  assert.notEqual(windows.components.engine.url, mac.components.engine.url);
  assert.equal(windows.components.window.sha256, mac.components.window.sha256);
  assert.equal(windows.components.window.url, mac.components.window.url);
  for (const [platform, arch] of [["win32", "x64"], ["darwin", "arm64"]]) {
    const manifest = JSON.parse(await readFile(join(output, `branch-release-${platform}-${arch}.json`), "utf8"));
    assert.equal(manifest.components.engine.platform, platform);
    for (const asset of Object.values(manifest.components)) {
      const bytes = await readFile(join(output, new URL(asset.url).pathname.split("/").at(-1)));
      assert.equal(bytes.length, asset.bytes); assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
    }
  }
  assert.equal((await readdir(output)).filter(name => name.startsWith(".component-stage-")).length, 0);
}));

test("macOS runtime component preserves in-bundle framework symlinks", { skip: process.platform !== "darwin" }, async () => fixture(async ({ root, engine, window }) => {
  const app = join(root, "signed-app"), contents = join(app, "Branch Agent.app/Contents");
  const framework = join(contents, "Frameworks/Example.framework");
  await mkdir(join(contents, "Resources"), { recursive: true });
  await mkdir(join(framework, "Versions/A"), { recursive: true });
  await writeFile(join(contents, "Resources/app.asar"), "sealed asar");
  await writeFile(join(framework, "Versions/A/Example"), "signed framework");
  await symlink("A", join(framework, "Versions/Current"));
  const asar = join(root, "asar"); await mkdir(asar); await writeFile(join(asar, "app.asar"), "sealed asar");
  const output = join(root, "mac-runtime-release");
  const release = await makeComponentRelease({ version: "0.4.3", engine, window, output, platform: "darwin", arch: "arm64",
    desktop: { app: asar, runtime: app, electronVersion: "44.5.1" } });
  const asset = release.components.desktopRuntime;
  const extracted = join(root, "mac-runtime-extracted"); await mkdir(extracted);
  const { extractComponentArchive } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update-archive.js")));
  await extractComponentArchive(join(output, new URL(asset.url).pathname.split("/").at(-1)), extracted, asset.expandedBytes);
  assert.equal(await readlink(join(extracted, "Branch Agent.app/Contents/Frameworks/Example.framework/Versions/Current")), "A");
  assert.equal(await readFile(join(extracted, "Branch Agent.app/Contents/Frameworks/Example.framework/Versions/Current/Example"), "utf8"), "signed framework");
}));

test("release maker refuses changed shared renderer and preserves existing immutable assets", async () => fixture(async ({ root, engine, window }) => {
  const output = join(root, "assembly");
  await makeComponentRelease({ version: "0.4.3", engine, window, output, platform: "win32", arch: "x64" });
  const names = await readdir(output); const hashes = await Promise.all(names.map(async name => createHash("sha256").update(await readFile(join(output, name))).digest("hex")));
  await writeFile(join(window, "index.html"), "different renderer");
  await assert.rejects(makeComponentRelease({ version: "0.4.3", engine, window, output, platform: "darwin", arch: "arm64" }), /collision/);
  assert.deepEqual(await readdir(output), names);
  for (let index = 0; index < names.length; index++) assert.equal(createHash("sha256").update(await readFile(join(output, names[index]))).digest("hex"), hashes[index]);
}));

test("release maker rejects incomplete source, malformed metadata and invalid targets before publishing assets", async () => fixture(async ({ root, engine, window }) => {
  const output = join(root, "invalid-output");
  const options = { version: "0.4.3", engine, window, output };
  await assert.rejects(makeComponentRelease({ ...options, platform: "../../escape" }), /target/);
  await assert.rejects(makeComponentRelease({ ...options, output: join(engine, "release-output") }), /outside/);
  await rm(join(engine, "dist", "entry.js"));
  await assert.rejects(makeComponentRelease(options), /entry/);
  await writeFile(join(engine, "dist", "entry.mjs"), "export {};\n");
  await writeFile(join(engine, "dist", "build-info.json"), "not-json");
  await assert.rejects(makeComponentRelease(options), SyntaxError);
  await rm(join(engine, "branch.mjs"));
  await assert.rejects(makeComponentRelease(options), { code: "ENOENT" });
  await assert.rejects(readdir(output), { code: "ENOENT" });
}));

test("release extraction preserves every launch/build/renderer byte and rollback restores retained components", async () => fixture(async ({ cfg, request, engine, window }) => {
  await source.refreshComponentUpdate(cfg, request);
  const selected = (await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim();
  for (const name of ["branch.mjs", "dist/build-info.json", "dist/large.bin"]) assert.deepEqual(await readFile(join(selected, name)), await readFile(join(engine, name)));
  assert.deepEqual(await readFile(join(cfg.windowDir, "index.html")), await readFile(join(window, "index.html")));
  await source.rollbackComponentUpdate(cfg); await unchanged(cfg);
}));

test("packaged default config selects the bundled real runtime from resources", async () => fixture(async ({ root }) => {
  const { execFileSync } = await import("node:child_process");
  const resources = join(root, "resources"); await bundleNode(resources);
  const require = createRequire(import.meta.url);
  const configFile = join(process.env.BRANCH_DESKTOP_TEST_DIST, "config.js");
  const previousResources = process.resourcesPath; const previousData = process.env.BRANCH_DESKTOP_DATA;
  process.resourcesPath = resources; process.env.BRANCH_DESKTOP_DATA = join(root, "isolated-runtime-data");
  delete require.cache[require.resolve(configFile)];
  try {
    const cfg = require(configFile).loadConfig();
    const expected = join(resources, "node", process.platform === "win32" ? "node.exe" : "node");
    assert.equal(cfg.nodePath, expected);
    assert.equal(execFileSync(cfg.nodePath, ["-p", "process.version"], { encoding: "utf8", timeout: 5000 }).trim(), process.version);
  } finally {
    if (previousResources === undefined) delete process.resourcesPath; else process.resourcesPath = previousResources;
    if (previousData === undefined) delete process.env.BRANCH_DESKTOP_DATA; else process.env.BRANCH_DESKTOP_DATA = previousData;
    delete require.cache[require.resolve(configFile)];
  }
}));

test("release maker uses a valid earlier ustar split for nested production dependency paths", async () => fixture(async ({ root, engine, window }) => {
  const relative = ["a".repeat(75), "b".repeat(70), "c".repeat(20), "entry.js"].join("/");
  const file = join(engine, relative);
  await mkdir(join(file, ".."), { recursive: true }); await writeFile(file, "actual nested fixture dependency\n");
  const output = join(root, "nested-release");
  const release = await makeComponentRelease({ version: "0.4.4", engine, window, output });
  const asset = release.components.engine; const archive = join(output, new URL(asset.url).pathname.split("/").at(-1));
  const extracted = join(root, "extracted"); await mkdir(extracted);
  const { extractComponentArchive } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "component-update-archive.js")));
  await extractComponentArchive(archive, extracted, asset.expandedBytes);
  assert.deepEqual(await readFile(join(extracted, relative)), await readFile(file));
}));

function coldCallerElectron(state) {
  const app = new EventEmitter(); Object.assign(app, { getVersion: () => "fixture", setPath: () => {}, setAppUserModelId: () => {},
    requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit: () => app.emit("will-quit") });
  class BrowserWindow extends EventEmitter {
    static fromWebContents(sender) { return state.window?.webContents === sender ? state.window : null; }
    constructor() { super(); state.window = this; this.url = ""; this.webContents = new EventEmitter(); Object.assign(this.webContents, {
      getURL: () => this.url, setWindowOpenHandler: () => {}, send: () => {}, reload: () => { state.draft = ""; state.reloads++; } }); }
    async loadURL(url) {
      this.url = url;
      if (url.startsWith("http://")) {
        state.bodies.push(await (await state.fetch(url)).text());
        state.draft = state.bodies.length === 1 ? "typed while connecting" : "";
      }
      this.webContents.emit("did-finish-load");
    }
    setMenuBarVisibility() {} show() {} isMinimized() { return false; } focus() {}
    maximize() {} isMaximized() { return false; } isDestroyed() { return false; } getNormalBounds() { return { x: 0, y: 0, width: 1280, height: 840 }; }
  }
  return { app, BrowserWindow, ipcMain: Object.assign(new EventEmitter(), { handle() {} }), screen: { getAllDisplays: () => [], getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 840 } }) }, dialog: { showErrorBox: () => assert.fail("Unexpected native caller error") },
    session: { defaultSession: { setPermissionRequestHandler: () => {} } }, shell: { openExternal: () => {} } };
}

async function coldDesktopCaller(cfg, state, releaseRequest) {
  const require = createRequire(import.meta.url); const Module = require("node:module");
  const previousLoad = Module._load; const previousFetch = globalThis.fetch;
  const previousData = process.env.BRANCH_DESKTOP_DATA; const previousHidden = process.env.BRANCH_DESKTOP_HIDDEN;
  const main = join(process.env.BRANCH_DESKTOP_TEST_DIST, "main.js");
  const config = join(process.env.BRANCH_DESKTOP_TEST_DIST, "config.js");
  const electron = coldCallerElectron(state);
  const desktop = { ...cfg, nodePath: process.execPath, gatewayPort: await freePort(), windowPort: await freePort() };
  state.gatewayPort = desktop.gatewayPort;
  await mkdir(join(cfg.engineDir, "dist"), { recursive: true });
  await writeFile(join(cfg.engineDir, "dist", "build-info.json"), '{"version":"retained"}');
  await writeFile(join(cfg.engineDir, "branch.mjs"), 'import http from "node:http"; setTimeout(()=>http.createServer((_req,res)=>res.writeHead(200).end()).listen(Number(process.argv[process.argv.indexOf("--port")+1]),"127.0.0.1"),300);');
  await writeFile(join(cfg.dataDir, "desktop.json"), JSON.stringify(desktop));
  process.env.BRANCH_DESKTOP_DATA = cfg.dataDir; process.env.BRANCH_DESKTOP_HIDDEN = "1";
  Module._load = function(name, ...args) { return name === "electron" ? electron : previousLoad.call(this, name, ...args); };
  globalThis.fetch = (url, options) => String(url).startsWith("https://github.com/") ? (releaseRequest ? releaseRequest(url, options) : Promise.reject(new Error("No further fixture releases"))) : previousFetch(url, options);
  delete require.cache[require.resolve(config)]; delete require.cache[require.resolve(main)];
  try { require(main); } finally { Module._load = previousLoad; }
  return async () => {
    electron.app.emit("will-quit"); globalThis.fetch = previousFetch;
    if (previousData === undefined) delete process.env.BRANCH_DESKTOP_DATA; else process.env.BRANCH_DESKTOP_DATA = previousData;
    if (previousHidden === undefined) delete process.env.BRANCH_DESKTOP_HIDDEN; else process.env.BRANCH_DESKTOP_HIDDEN = previousHidden;
    delete require.cache[require.resolve(config)]; delete require.cache[require.resolve(main)];
    await eventually(async () => { try { process.kill(Number(await readFile(join(cfg.dataDir, "gateway.pid"), "utf8")), 0); return false; } catch { return true; } });
  };
}

test("cold rollback retains renderer and engine while the failed latest stays online; newer release stages", async () => fixture(async ({ cfg, request, requests, engine, window, output, release }) => {
  await writeFile(join(cfg.dataDir, "component-update-version.txt"), "0.4.2\n");
  await source.refreshComponentUpdate(cfg, request);
  const state = { bodies: [], reloads: 0, draft: "", fetch };
  const stop = await coldDesktopCaller(cfg, state, request);
  try {
    await eventually(async () => state.bodies.length === 2 && requests.length >= 4);
    assert.deepEqual(state.bodies, ["<title>new window</title>", "old window"]);
    assert.equal(state.draft, "", "actual rollback replaces the failed renderer document");
    await unchanged(cfg);
    assert.equal(await readFile(join(cfg.dataDir, "component-update-version.txt"), "utf8"), "0.4.2\n");
    const rejected = JSON.parse(await readFile(join(cfg.dataDir, "component-update-rejected.json"), "utf8"));
    assert.deepEqual(rejected, { version: release.version, engineSha256: release.components.engine.sha256, windowSha256: release.components.window.sha256, reason: "exit" });
    assert.equal(await source.refreshComponentUpdate(cfg, request), false);
    await new Promise(resolve => setTimeout(resolve, 100));
    await unchanged(cfg);
    assert.equal(requests.filter(url => url.endsWith(".tar.gz")).length, 2, "failed latest must not redownload/restage archives");
    await assert.rejects(readFile(join(cfg.dataDir, "component-update-pending.json")), { code: "ENOENT" });
    const runningPid = Number(await readFile(join(cfg.dataDir, "gateway.pid"), "utf8"));
    assert.doesNotThrow(() => process.kill(runningPid, 0));
    const ready = await state.fetch(`http://127.0.0.1:${state.gatewayPort}/readyz`, { signal: AbortSignal.timeout(2000) });
    await ready.body?.cancel(); assert.equal(ready.status, 200, "retained engine remains usable with failed latest online");
    assert.match(await readFile(join(cfg.dataDir, "desktop.log"), "utf8"), /Reloaded retained window after component rollback/);
    await writeFile(join(engine, "branch.mjs"), 'import http from "node:http"; http.createServer((_req,res)=>res.writeHead(200).end()).listen(Number(process.argv[process.argv.indexOf("--port")+1]),"127.0.0.1");');
    for (const file of await readdir(output)) await rm(join(output, file));
    Object.assign(release, await makeComponentRelease({ version: "0.4.4", engine, window, output }));
    assert.equal(await source.refreshComponentUpdate(cfg, request), true, "a newer valid release remains stageable");
    assert.notEqual((await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim(), cfg.engineDir);
    assert.doesNotThrow(() => process.kill(runningPid, 0), "staging still retains the running engine");
  } finally { await stop(); }
}));

test("normal readiness keeps the early renderer and typed draft without another navigation", async () => fixture(async ({ cfg }) => {
  const state = { bodies: [], reloads: 0, draft: "", fetch };
  const stop = await coldDesktopCaller(cfg, state);
  try {
    await eventually(async () => (await readFile(join(cfg.dataDir, "desktop.log"), "utf8")).includes("gateway ready after"));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(state.bodies, ["old window"]);
    assert.equal(state.reloads, 0); assert.equal(state.draft, "typed while connecting");
  } finally { await stop(); }
}));

test("explicit retry bypasses only the exact failed identity without marking it installed", async () => fixture(async ({ cfg, request }) => {
  await writeFile(join(cfg.dataDir, "component-update-version.txt"), "0.4.2\n");
  await source.refreshComponentUpdate(cfg, request);
  const selected = (await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim();
  await source.rejectFailedComponentUpdate(cfg, selected); await source.rollbackComponentUpdate(cfg);
  assert.equal(await source.refreshComponentUpdate(cfg, request), false);
  assert.equal(await source.refreshComponentUpdate(cfg, request, { retryRejected: true }), true);
  assert.equal(await readFile(join(cfg.dataDir, "component-update-version.txt"), "utf8"), "0.4.2\n");
}));

test("an exited staged engine records exit and is not automatically retried", async () => fixture(async ({ cfg, request }) => {
  await source.refreshComponentUpdate(cfg, request);
  const selected = (await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim();
  let runningEngine;
  await bootSelectedEngineWithRollback({
    boot: async () => {
      const current = (await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim();
      if (current === selected) throw new Error("gateway exited");
      runningEngine = current;
    },
    stopFailedGateway: () => {},
    recordTimeout: () => source.recordComponentUpdateTimeout(cfg, selected),
    rejectExited: () => source.rejectFailedComponentUpdate(cfg, selected),
    rollback: () => source.rollbackComponentUpdate(cfg),
    waitForPortRelease: async () => {},
    log: () => {},
  });
  assert.equal(runningEngine, cfg.engineDir);
  const rejected = JSON.parse(await readFile(join(cfg.dataDir, "component-update-rejected.json"), "utf8"));
  assert.equal(rejected.reason, "exit");
  assert.equal(await source.refreshComponentUpdate(cfg, request), false);
}));

async function bootTimedOutRelease(cfg) {
  const selected = (await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim();
  let stoppedPid;
  let runningEngine;
  const restored = await bootSelectedEngineWithRollback({
    boot: async () => {
      const current = (await readFile(join(cfg.dataDir, "engine-current.txt"), "utf8")).trim();
      if (current === selected) throw new GatewayReadinessTimeoutError();
      runningEngine = current;
    },
    stopFailedGateway: () => { stoppedPid = 12345; },
    recordTimeout: () => source.recordComponentUpdateTimeout(cfg, selected),
    rejectExited: () => source.rejectFailedComponentUpdate(cfg, selected),
    rollback: () => source.rollbackComponentUpdate(cfg),
    waitForPortRelease: async () => assert.equal(stoppedPid, 12345),
    log: () => {},
  });
  assert.equal(restored, true);
  assert.equal(stoppedPid, 12345, "timed-out selected gateway was stopped before the prior boot");
  assert.equal(runningEngine, cfg.engineDir, "previous engine booted after rollback");
  await unchanged(cfg);
}

test("a first readiness timeout stops the selected gateway and boots previous components without rejection", async () => fixture(async ({ cfg, request }) => {
  await source.refreshComponentUpdate(cfg, request);
  await bootTimedOutRelease(cfg);
  await assert.rejects(readFile(join(cfg.dataDir, "component-update-rejected.json")), { code: "ENOENT" });
  const timeout = JSON.parse(await readFile(join(cfg.dataDir, "component-update-timeouts.json"), "utf8"));
  assert.equal(timeout.attempts, 1);
  assert.equal(await source.refreshComponentUpdate(cfg, request), true);
}));

test("a second readiness timeout rejects its release and auto-apply does not restage it", async () => fixture(async ({ cfg, request }) => {
  await source.refreshComponentUpdate(cfg, request);
  await bootTimedOutRelease(cfg);
  assert.equal(await source.refreshComponentUpdate(cfg, request), true);
  await bootTimedOutRelease(cfg);
  const rejected = JSON.parse(await readFile(join(cfg.dataDir, "component-update-rejected.json"), "utf8"));
  assert.equal(rejected.reason, "timeout");
  assert.equal(rejected.timeoutAttempts, 2);
  assert.equal(await source.refreshComponentUpdate(cfg, request), false);
}));

test("prepared interruption and unrelated engines do not reject a release", async () => fixture(async ({ cfg, request }) => {
  await source.refreshComponentUpdate(cfg, request);
  const file = join(cfg.dataDir, "component-update-pending.json");
  const pending = JSON.parse(await readFile(file, "utf8"));
  await source.rejectFailedComponentUpdate(cfg, cfg.engineDir);
  await assert.rejects(readFile(join(cfg.dataDir, "component-update-rejected.json")), { code: "ENOENT" });
  pending.phase = "prepared"; await writeFile(file, JSON.stringify(pending));
  await source.rejectFailedComponentUpdate(cfg, pending.engineNext);
  await source.recoverComponentUpdate(cfg); await unchanged(cfg);
  await assert.rejects(readFile(join(cfg.dataDir, "component-update-rejected.json")), { code: "ENOENT" });
  assert.equal(await source.refreshComponentUpdate(cfg, request), true);
}));

test("a manifest network failure stays retryable and does not reject its release", async () => fixture(async ({ cfg, request }) => {
  await assert.rejects(source.refreshComponentUpdate(cfg, async () => { throw new Error("fixture network outage"); }), /network outage/);
  await unchanged(cfg);
  await assert.rejects(readFile(join(cfg.dataDir, "component-update-rejected.json")), { code: "ENOENT" });
  assert.equal(await source.refreshComponentUpdate(cfg, request), true);
}));

test("legacy token and engine pointer select existing data without a desktop config", async () => fixture(async ({ root }) => {
  const os = createRequire(import.meta.url)("node:os"); const home = mock.method(os, "homedir", () => root);
  const previous = process.env.BRANCH_DESKTOP_DATA; delete process.env.BRANCH_DESKTOP_DATA;
  const legacy = join(root, "BranchApp"); await mkdir(legacy);
  await writeFile(join(legacy, "gateway-token"), "synthetic fixture token");
  await writeFile(join(legacy, "engine-current.txt"), "fixture engine pointer");
  try {
    assert.equal(defaultDataDirectory(), legacy);
    await assert.rejects(readFile(join(legacy, "desktop.json")), { code: "ENOENT" });
    process.env.BRANCH_DESKTOP_DATA = join(root, "explicit-data");
    assert.equal(defaultDataDirectory(), process.env.BRANCH_DESKTOP_DATA, "explicit data override remains authoritative");
  } finally { home.mock.restore(); if (previous === undefined) delete process.env.BRANCH_DESKTOP_DATA; else process.env.BRANCH_DESKTOP_DATA = previous; }
}));

test("bare unrelated legacy folder and incomplete markers do not capture fresh data", async () => fixture(async ({ root }) => {
  const os = createRequire(import.meta.url)("node:os"); const home = mock.method(os, "homedir", () => root);
  const previous = process.env.BRANCH_DESKTOP_DATA; delete process.env.BRANCH_DESKTOP_DATA;
  const legacy = join(root, "BranchApp"); await mkdir(legacy);
  try {
    assert.notEqual(defaultDataDirectory(), legacy);
    await writeFile(join(legacy, "gateway-token"), "synthetic fixture token");
    assert.notEqual(defaultDataDirectory(), legacy, "one marker is insufficient");
    await mkdir(join(legacy, "engine-current.txt"));
    assert.notEqual(defaultDataDirectory(), legacy, "directories masquerading as marker files are insufficient");
    await writeFile(join(legacy, "desktop.json"), "{}");
    assert.equal(defaultDataDirectory(), legacy, "an existing real desktop config remains authoritative");
  } finally { home.mock.restore(); if (previous === undefined) delete process.env.BRANCH_DESKTOP_DATA; else process.env.BRANCH_DESKTOP_DATA = previous; }
}));
