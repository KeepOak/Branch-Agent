// Always on (Private #454 C+E): closing hides the window while the service engine keeps working, the tray shows the
// engine's live state with Pause all work and Stop Branch completely, and engine updates restart the SERVICE through
// the standby/readiness/rollback steps while a window-only update never touches the engine. Nothing here installs,
// starts or stops a real service or gateway: temp folders, a loopback stand-in engine and a recording fake CLI only.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url), Module = require('node:module');
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const { readEngineLiveState, stopBranchCompletely, trayLabel, trayMenu } = require(join(dist, 'tray-status.js'));
const { sameEngineBuild, updateServiceEngine } = require(join(dist, 'service-update.js'));
const { engineServiceArgs } = require(join(dist, 'engine-service.js'));
const originalLoad = Module._load, originalFetch = globalThis.fetch;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(predicate, ms = 8000) {
  const end = Date.now() + ms;
  while (!await predicate()) { if (Date.now() > end) throw Error('Fixture deadline'); await pause(25); }
}
function tempDir(t, name = 'branch-always-on-ce-') {
  const dir = mkdtempSync(join(tmpdir(), name));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
async function listen(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}
async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}

/** Electron stand-in: one window whose page answers the app's activity probe with `work`, and a recording tray. */
function electronFixture(work) {
  let window, tray, quitting = false;
  const app = new EventEmitter(), ipcMain = Object.assign(new EventEmitter(), { handle() {} });
  const dialogs = [];
  Object.assign(app, { getVersion: () => 'fixture', setPath() {}, setAppUserModelId() {},
    requestSingleInstanceLock: () => true, whenReady: async () => {}, quit() {
      if (quitting) return; quitting = true; app.quitCalls = (app.quitCalls ?? 0) + 1;
      app.emit('before-quit'); window?.close(); app.emit('will-quit');
    } });
  class BrowserWindow extends EventEmitter {
    static fromWebContents(sender) { return window?.webContents === sender ? window : null; }
    constructor() {
      super(); window = this; this.hidden = false; this.destroyed = false; this.sent = [];
      const wc = this.webContents = new EventEmitter();
      Object.assign(wc, { mainFrame: { url: '' }, getURL: () => this.url, setWindowOpenHandler() {}, isDestroyed: () => this.destroyed,
        reload() {}, send: (channel, ...args) => {
          this.sent.push(channel);
          if (channel !== 'branch-desktop:auto-apply:probe') return;
          setImmediate(() => ipcMain.emit('branch-desktop:auto-apply:result', { sender: wc, senderFrame: wc.mainFrame }, args[0], work()));
        } });
    }
    async loadURL(url) { this.url = url; this.webContents.mainFrame.url = url; this.webContents.emit('did-finish-load'); }
    close() { const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event); if (!event.prevented) { this.destroyed = true; this.emit('closed'); } return event; }
    hide() { this.hidden = true; } show() { this.hidden = false; } focus() {} isMinimized() { return false; } restore() {}
    setMenuBarVisibility() {} maximize() {} isMaximized() { return false; } isVisible() { return !this.hidden; }
    isDestroyed() { return this.destroyed; } getNormalBounds() { return { x: 0, y: 0, width: 1280, height: 840 }; }
    getBounds() { return this.getNormalBounds(); }
  }
  class Tray extends EventEmitter { constructor() { super(); tray = this; }
    setToolTip(value) { this.tooltip = value; } setContextMenu(value) { this.menu = value; } setImage() {} destroy() { this.destroyed = true; } }
  return { app, dialogs, get window() { return window; }, get tray() { return tray; }, electron: { app, BrowserWindow, Tray, ipcMain,
    Menu: { buildFromTemplate: value => value },
    screen: { getAllDisplays: () => [], getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 840 } }) },
    dialog: { showErrorBox: (...args) => dialogs.push(['error', ...args]),
      showMessageBox: async options => { dialogs.push(['warn', options.message]); return { response: 0 }; } },
    session: { defaultSession: { setPermissionRequestHandler() {} } }, shell: { openExternal() {} } } };
}

/**
 * A fake engine folder. As a CLI (`gateway install|start|restart|stop`) it only records its arguments and the folder it
 * ran from, and a restart records which folder the "service" now runs; as an update's standby (`gateway --dev`) it
 * answers /readyz on its spare port. No real service or gateway is ever started.
 */
function fakeEngine(root, name, build) {
  const dir = join(root, name);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'build-info.json'), JSON.stringify({ version: build }));
  writeFileSync(join(dir, 'branch.mjs'), `import fs from "node:fs"; import http from "node:http"; import path from "node:path";
const root = ${JSON.stringify(root)}, args = process.argv.slice(2), here = path.basename(process.cwd());
if (args[0] === "gateway" && args.includes("--dev")) {
  fs.appendFileSync(root + "/standbys.txt", process.pid + "\\n");
  http.createServer((q, r) => { r.statusCode = q.url === "/readyz" ? 200 : 404; r.end(); }).listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1");
} else {
  fs.appendFileSync(root + "/cli-calls.txt", args.join(" ") + " @" + here + "\\n");
  if (args[1] === "restart") fs.writeFileSync(root + "/service-runs.txt", here);
  console.log(JSON.stringify({ ok: true }));
}`);
  return dir;
}

/**
 * The real main.js with alwaysOn and an engine service already serving: a loopback stand-in on the gateway port that
 * stops answering /readyz while the "service" runs a folder named engine-broken.
 */
async function serviceApp(t, work, run, env = {}) {
  const root = tempDir(t, 'branch-always-on-app-');
  const windowDir = join(root, 'window'), profile = join(root, 'profile');
  for (const dir of [windowDir, profile]) mkdirSync(dir, { recursive: true });
  const engine = fakeEngine(root, 'engine', 'service');
  writeFileSync(join(windowDir, 'index.html'), '<html>fixture</html>');
  const runs = () => { try { return readFileSync(join(root, 'service-runs.txt'), 'utf8'); } catch { return 'engine'; } };
  const gatewayPort = await listen(t, (req, res) => { res.statusCode = req.url === '/readyz' && runs() !== 'engine-broken' ? 200 : 503; res.end(); });
  const windowPort = await freePort();
  writeFileSync(join(root, 'desktop.json'), JSON.stringify({ dataDir: root, engineDir: engine, windowDir, nodePath: process.execPath,
    gatewayPort, windowPort, alwaysOn: true }));
  const vars = { BRANCH_DESKTOP_DATA: root, BRANCH_DESKTOP_HIDDEN: '0', BRANCH_DESKTOP_ENGINE_PROFILE: profile, ...env };
  const saved = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const runtime = electronFixture(work);
  Module._load = function(name, ...args) {
    if (name === 'electron') return runtime.electron;
    const loaded = originalLoad.call(this, name, ...args);
    if (name !== './resident-window') return loaded;
    return { ...loaded, keepWindowResident(app, window, icon, options) {
      return loaded.keepWindowResident(app, window, icon, { ...options, platform: 'win32' });
    } };
  };
  globalThis.fetch = (url, options) => String(url).startsWith('https://') ? Promise.resolve(new Response('', { status: 404 })) : originalFetch(url, options);
  for (const name of ['main.js', 'config.js', 'resident-window.js']) delete require.cache[join(dist, name)];
  const lines = file => { try { return readFileSync(join(root, file), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
  const desktopLog = () => { try { return readFileSync(join(root, 'desktop.log'), 'utf8'); } catch { return ''; } };
  try {
    require(join(dist, 'main.js'));
    await eventually(() => desktopLog().includes('engine: attached to the running service engine'));
    const wc = runtime.window.webContents;
    const clickUpdate = () => runtime.electron.ipcMain.emit('branch-desktop:restart-engine', { sender: wc, senderFrame: wc.mainFrame });
    await run({ ...runtime, window: runtime.window, tray: runtime.tray, root, gatewayPort, desktopLog, clickUpdate,
      cliCalls: () => lines('cli-calls.txt'), standbys: () => lines('standbys.txt').map(Number), serviceRuns: runs,
      runningRecord: () => readFileSync(join(root, 'engine-running.txt'), 'utf8').trim(),
      publish: (name, build) => { const dir = fakeEngine(root, name, build); writeFileSync(join(root, 'engine-current.txt'), `${dir}\n`); return dir; } });
  } finally {
    runtime.app.quit(); Module._load = originalLoad; globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await pause(50);
  }
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const idle = () => ({ pendingApprovals: 0, streaming: false, unsavedDraftFiles: false, workingTrunks: 0 });
const serving = async port => (await originalFetch(`http://127.0.0.1:${port}/readyz`).then(r => r.status, () => 0)) === 200;
const item = (tray, label) => tray.menu.find(entry => entry.label === label);

test('close hides the window and the service engine keeps running: no stop call, Quit keeps it too', async t => {
  await serviceApp(t, () => ({ pendingApprovals: 0, streaming: false, unsavedDraftFiles: false, workingTrunks: 2 }), async ({ app, window, tray, gatewayPort, cliCalls, desktopLog }) => {
    assert.equal(window.close().prevented, true);
    assert.equal(window.hidden, true);
    assert.equal(window.destroyed, false);
    assert.equal(app.quitCalls ?? 0, 0);
    assert.ok(item(tray, 'Open Branch') && item(tray, 'Pause all work') && item(tray, 'Stop Branch completely'), 'the tray offers Open, Pause all work and Stop completely');
    item(tray, 'Quit Branch').click();
    assert.equal(window.destroyed, true);
    assert.equal(await serving(gatewayPort), true, 'the engine service keeps answering after the app quits');
    assert.deepEqual(cliCalls(), [], 'nothing installed, started or stopped the service');
    assert.match(desktopLog(), /quit; the engine service keeps running/);
  });
});

test('the tray label follows the engine state the app reads, and Pause all work reaches the window', async t => {
  await serviceApp(t, () => ({ pendingApprovals: 0, streaming: true, unsavedDraftFiles: false, workingTrunks: 2 }), async ({ window, tray }) => {
    await eventually(() => tray.tooltip === 'Branch Agent · 2 Trunks working');
    assert.equal(tray.menu[0].label, '2 Trunks working');
    assert.equal(tray.menu[0].enabled, false);
    assert.equal(item(tray, 'Pause all work').enabled, true);
    item(tray, 'Pause all work').click();
    assert.ok(window.sent.includes('branch-desktop:pause-all'));
  });
});

test('Stop Branch completely warns while work runs, then stops the service through the engine CLI and quits', async t => {
  await serviceApp(t, () => ({ pendingApprovals: 1, streaming: true, unsavedDraftFiles: false, workingTrunks: 1 }), async ({ app, tray, dialogs, cliCalls }) => {
    item(tray, 'Stop Branch completely').click();
    await eventually(() => (app.quitCalls ?? 0) === 1);
    assert.deepEqual(dialogs.filter(d => d[0] === 'warn').map(d => d[1]), ['1 Trunk is still working.']);
    assert.deepEqual(cliCalls(), ['gateway stop --force --json @engine']);
  });
});

test('trayLabel and readEngineLiveState read the engine state plainly', async () => {
  assert.equal(trayLabel({ running: true, workingTrunks: 2, waitingOnYou: 0 }), '2 Trunks working');
  assert.equal(trayLabel({ running: true, workingTrunks: 1, waitingOnYou: 0 }), '1 Trunk working');
  assert.equal(trayLabel({ running: true, workingTrunks: 2, waitingOnYou: 1 }), 'Waiting on you (1)');
  assert.equal(trayLabel({ running: true, workingTrunks: 0, waitingOnYou: 0 }), 'Ready');
  assert.equal(trayLabel({ running: false, workingTrunks: 0, waitingOnYou: 0 }), 'Stopped');
  const window = async () => ({ pendingApprovals: 1, streaming: true, workingTrunks: 3 });
  assert.deepEqual(await readEngineLiveState({ engineUp: async () => true, window }), { running: true, workingTrunks: 3, waitingOnYou: 1 });
  // A silent engine is Stopped, whatever an old window says.
  assert.deepEqual(await readEngineLiveState({ engineUp: async () => false, window }), { running: false, workingTrunks: 0, waitingOnYou: 0 });
  // A window from before the count: the child engine's own run count, else one live stream.
  assert.equal((await readEngineLiveState({ engineUp: async () => true, window: async () => ({ pendingApprovals: 0, streaming: true }), engineRuns: async () => 4 })).workingTrunks, 4);
  assert.equal((await readEngineLiveState({ engineUp: async () => true, window: async () => { throw Error('no window'); } })).workingTrunks, 0);
  const labels = trayMenu({ running: true, workingTrunks: 0, waitingOnYou: 0 }, { open() {}, pauseAll() {}, quit() {}, stopCompletely() {} }).map(i => i.label ?? '-');
  assert.deepEqual(labels, ['Ready', '-', 'Open Branch', 'Pause all work', '-', 'Quit Branch', 'Stop Branch completely']);
});

test('Stop Branch completely: no warning when idle, nothing stopped when the warning is declined', async () => {
  const run = async (state, answer) => {
    const calls = [];
    const result = await stopBranchCompletely({ state: async () => state, confirm: async message => { calls.push(`warn:${message}`); return answer; },
      stopService: async () => { calls.push('stop'); }, quit: () => calls.push('quit'), log: () => undefined });
    return { result, calls };
  };
  assert.deepEqual(await run({ running: true, workingTrunks: 0, waitingOnYou: 0 }, false), { result: 'stopped', calls: ['stop', 'quit'] });
  assert.deepEqual(await run({ running: true, workingTrunks: 2, waitingOnYou: 0 }, false), { result: 'cancelled', calls: ['warn:2 Trunks are still working.'] });
  assert.deepEqual(await run({ running: true, workingTrunks: 2, waitingOnYou: 0 }, true), { result: 'stopped', calls: ['warn:2 Trunks are still working.', 'stop', 'quit'] });
  // The engine inside the app (the fallback): quitting stops it, no service call.
  const calls = [];
  await stopBranchCompletely({ state: async () => ({ running: true, workingTrunks: 0, waitingOnYou: 0 }), confirm: async () => true, quit: () => calls.push('quit'), log: () => undefined });
  assert.deepEqual(calls, ['quit']);
});

/**
 * A fake service manager for one per-user service: `restart(dir)` replaces the one engine process with one running
 * `dir` (as launchd/systemd/Task Scheduler do); the standby is a separate process that is stopped before returning.
 */
function fakeServiceManager(t, options = {}) {
  const root = tempDir(t);
  const engineDir = (name, build) => {
    const dir = join(root, name); mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'build-info.json'), JSON.stringify({ version: build })); writeFileSync(join(dir, 'branch.mjs'), '');
    return dir;
  };
  const old = engineDir('engine-old', 'v1');
  const state = { serviceRuns: old, engines: 1, maxEngines: 1, standbys: 0, restarts: [], calls: [] };
  const steps = selected => ({
    runningEngineDir: old,
    selectedEngineDir: selected,
    warmStandby: async () => {
      state.calls.push('standby'); state.standbys++;
      state.engines++; state.maxEngines = Math.max(state.maxEngines, state.engines);
      await pause(5); state.engines--;
      return options.standby ?? 'ready';
    },
    restartService: async dir => {
      state.calls.push(`restart:${dir === old ? 'old' : 'new'}`); state.restarts.push(dir);
      // The service manager stops the one engine and starts it again on dir: never two at once.
      state.engines--; await pause(5); state.serviceRuns = dir; state.engines++;
      state.maxEngines = Math.max(state.maxEngines, state.engines);
    },
    waitForReady: async () => !(options.newNeverReady && state.serviceRuns !== old),
    confirm: async () => { state.calls.push('confirm'); },
    reject: async () => { state.calls.push('reject'); },
    rollback: async () => { state.calls.push('rollback'); },
    log: () => undefined,
  });
  return { state, steps, engineDir, old };
}

test('an engine update with the service restarts it through the service manager, after the standby, with exactly one engine', async t => {
  const { state, steps, engineDir } = fakeServiceManager(t);
  const fresh = engineDir('engine-new', 'v2');
  assert.equal(await updateServiceEngine(steps(fresh)), 'updated');
  assert.deepEqual(state.calls, ['standby', 'restart:new', 'confirm']);
  assert.equal(state.serviceRuns, fresh);
  assert.equal(state.engines, 1, 'exactly one engine after the update');
  assert.ok(state.maxEngines <= 2, 'only the scratch standby ever ran beside the service engine');
  assert.deepEqual(engineServiceArgs('restart'), ['branch.mjs', 'gateway', 'restart', '--force', '--json']);
  assert.deepEqual(engineServiceArgs('stop'), ['branch.mjs', 'gateway', 'stop', '--force', '--json']);
});

test('a new service engine that fails readiness is rolled back: release rejected, pointers restored, service on the previous engine', async t => {
  const { state, steps, engineDir, old } = fakeServiceManager(t, { newNeverReady: true });
  assert.equal(await updateServiceEngine(steps(engineDir('engine-new', 'v2'))), 'rolled-back');
  assert.deepEqual(state.calls, ['standby', 'restart:new', 'reject', 'rollback', 'restart:old']);
  assert.equal(state.serviceRuns, old);
  assert.equal(state.engines, 1, 'exactly one engine after the rollback');
});

test('a standby that cannot start restarts nothing; the running engine keeps serving', async t => {
  const { state, steps, engineDir, old } = fakeServiceManager(t, { standby: 'exited' });
  assert.equal(await updateServiceEngine(steps(engineDir('engine-new', 'v2'))), 'kept');
  assert.deepEqual(state.calls, ['standby', 'reject', 'rollback']);
  assert.equal(state.serviceRuns, old);
  assert.deepEqual(state.restarts, []);
});

test('a window-only update never touches the engine service', async t => {
  const { state, steps, engineDir, old } = fakeServiceManager(t);
  // A release whose engine is byte-for-byte the running build, staged in its own folder.
  const sameBuild = engineDir('engine-window-only', 'v1');
  assert.equal(sameEngineBuild(old, sameBuild), true);
  assert.equal(await updateServiceEngine(steps(sameBuild)), 'window-only');
  assert.deepEqual(state.calls, ['confirm']);
  assert.equal(state.standbys, 0);
  assert.deepEqual(state.restarts, []);
  assert.equal(state.serviceRuns, old);
});

const updateEnv = { BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB: '1', BRANCH_DESKTOP_READY_TIMEOUT_MS: '1500', BRANCH_DESKTOP_STANDBY_READY_TIMEOUT_MS: '8000' };

test('the app updates the service engine: standby beside it, then gateway restart from the new engine; one engine after', async t => {
  await serviceApp(t, idle, async ({ clickUpdate, publish, cliCalls, standbys, serviceRuns, runningRecord, desktopLog }) => {
    const fresh = publish('engine-v2', 'v2');
    clickUpdate();
    await eventually(() => desktopLog().includes('service update: the engine service runs the new engine'), 15000);
    assert.deepEqual(cliCalls(), ['gateway restart --force --json @engine-v2']);
    assert.equal(serviceRuns(), 'engine-v2');
    assert.equal(runningRecord(), fresh);
    assert.equal(standbys().length, 1, 'the new engine warmed once as a standby first');
    await eventually(() => standbys().every(pid => !alive(pid)));
    assert.doesNotMatch(desktopLog(), /gateway started from/, 'no child engine was started beside the service');
  }, updateEnv);
});

test('the app rolls the service back when the new engine fails readiness', async t => {
  await serviceApp(t, idle, async ({ root, clickUpdate, publish, cliCalls, serviceRuns, runningRecord, desktopLog }) => {
    publish('engine-broken', 'v2');
    clickUpdate();
    await eventually(() => desktopLog().includes('rolled back; the engine service runs the previous engine'), 15000);
    assert.deepEqual(cliCalls(), ['gateway restart --force --json @engine-broken', 'gateway restart --force --json @engine']);
    assert.equal(serviceRuns(), 'engine');
    assert.equal(runningRecord(), join(root, 'engine'));
    assert.doesNotMatch(desktopLog(), /gateway started from/);
  }, updateEnv);
});

test('the app applies a window-only update without touching the engine service', async t => {
  await serviceApp(t, idle, async ({ root, clickUpdate, publish, cliCalls, standbys, runningRecord, desktopLog }) => {
    publish('engine-window-only', 'service');
    clickUpdate();
    await eventually(() => desktopLog().includes('the engine build is unchanged; the engine service was not touched'), 15000);
    assert.deepEqual(cliCalls(), []);
    assert.deepEqual(standbys(), []);
    assert.equal(runningRecord(), join(root, 'engine'), 'the service still runs the folder it started from');
  }, updateEnv);
});
