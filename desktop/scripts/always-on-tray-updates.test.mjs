// Always on (Private #454 C+E): closing hides the window while the service engine keeps working, the tray shows the
// engine's live state with Pause all work and Quit (which stops Branch completely), and engine updates restart the SERVICE through
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
const { resetQuitIntent } = require(join(dist, 'quit-intent.js'));
const { sameEngineBuild, updateServiceEngine, TRUNKS_STILL_WORKING } = require(join(dist, 'service-update.js'));
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
    session: { fromPartition() { return { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {} }; }, defaultSession: { setPermissionRequestHandler() {} } }, shell: { openExternal() {} } } };
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
async function serviceApp(t, work, run, env = {}, setup = () => undefined) {
  const root = tempDir(t, 'branch-always-on-app-');
  const windowDir = join(root, 'window'), profile = join(root, 'profile');
  for (const dir of [windowDir, profile]) mkdirSync(dir, { recursive: true });
  const engine = fakeEngine(root, 'engine', 'service');
  writeFileSync(join(windowDir, 'index.html'), '<html>fixture</html>');
  const runs = () => { try { return readFileSync(join(root, 'service-runs.txt'), 'utf8'); } catch { return 'engine'; } };
  const gatewayPort = await listen(t, (req, res) => {
    // A fake Trunk run: it answers its first line now and finishes later, unless the service restarted under it.
    if (req.url === '/run') {
      res.write('working');
      setTimeout(() => { if (runs() === 'engine') res.end(' done'); else res.destroy(); }, 600);
      return;
    }
    res.statusCode = req.url === '/readyz' && runs() !== 'engine-broken' ? 200 : 503; res.end();
  });
  const windowPort = await freePort();
  writeFileSync(join(root, 'desktop.json'), JSON.stringify({ dataDir: root, engineDir: engine, windowDir, nodePath: process.execPath,
    gatewayPort, windowPort, alwaysOn: true }));
  setup(root);
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

test('close hides the window and the service engine keeps running; Quit asks first, then stops the service too', async t => {
  await serviceApp(t, () => ({ pendingApprovals: 0, streaming: false, unsavedDraftFiles: false, workingTrunks: 2 }), async ({ app, window, tray, gatewayPort, cliCalls, dialogs }) => {
    assert.equal(window.close().prevented, true);
    assert.equal(window.hidden, true);
    assert.equal(window.destroyed, false);
    assert.equal(app.quitCalls ?? 0, 0);
    assert.equal(await serving(gatewayPort), true, 'closing the window leaves the engine service answering');
    assert.deepEqual(cliCalls(), [], 'closing the window installs, starts or stops nothing');
    assert.ok(item(tray, 'Open Branch') && item(tray, 'Pause all work') && item(tray, 'Quit'), 'the tray offers Open Branch, Pause all work and Quit');
    assert.equal(item(tray, 'Stop Branch completely'), undefined, 'Quit is the one way to stop Branch');
    await eventually(() => tray.tooltip === 'Branch Agent · 2 Trunks working');
    item(tray, 'Quit').click();
    await eventually(() => (app.quitCalls ?? 0) === 1);
    assert.equal(window.destroyed, true);
    // The first close's one-time notice (this stand-in has no system notifications), then Quit's one question.
    assert.deepEqual(dialogs.filter(d => d[0] === 'warn').map(d => d[1]), ['Branch closes to the tray.', 'Quit while 2 Trunks are working?']);
    assert.deepEqual(cliCalls(), ['gateway stop --force --json @engine'], 'Quit stops the engine service through the engine CLI');
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

test('Quit warns once while work runs, then stops the service through the engine CLI and quits', async t => {
  await serviceApp(t, () => ({ pendingApprovals: 1, streaming: true, unsavedDraftFiles: false, workingTrunks: 1 }), async ({ app, tray, dialogs, cliCalls }) => {
    await eventually(() => tray.tooltip === 'Branch Agent · Waiting on you (1)');
    item(tray, 'Quit').click();
    await eventually(() => (app.quitCalls ?? 0) === 1);
    assert.deepEqual(dialogs.filter(d => d[0] === 'warn').map(d => d[1]), ['Quit while 1 Trunk is working?'], 'one question, never a second one');
    assert.deepEqual(cliCalls(), ['gateway stop --force --json @engine']);
  });
});

test('Quit with nothing running asks nothing and still stops the service through the engine CLI', async t => {
  await serviceApp(t, idle, async ({ app, tray, dialogs, cliCalls }) => {
    await eventually(() => tray.tooltip === 'Branch Agent · Ready');
    assert.equal(item(tray, 'Stop Branch completely'), undefined);
    item(tray, 'Quit').click();
    await eventually(() => (app.quitCalls ?? 0) === 1);
    assert.deepEqual(dialogs.filter(d => d[0] === 'warn').map(d => d[1]), [], 'nothing runs, so Quit does not ask');
    assert.deepEqual(cliCalls(), ['gateway stop --force --json @engine'], 'Quit keeps what Stop Branch completely did');
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
  const labels = trayMenu({ running: true, workingTrunks: 0, waitingOnYou: 0 }, { open() {}, pauseAll() {}, quit() {} }).map(i => i.label ?? '-');
  assert.deepEqual(labels, ['Ready', '-', 'Open Branch', 'Pause all work', '-', 'Quit']);
});

test('Stop Branch completely: no warning when idle, nothing stopped when the warning is declined', async () => {
  // The Quit tests above chose Quit in this process; this checks the step on its own.
  resetQuitIntent();
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
  assert.deepEqual(engineServiceArgs('restart'), ['branch.mjs', 'gateway', 'restart', '--json']);
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
    assert.deepEqual(cliCalls(), ['gateway restart --json @engine-v2']);
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
    assert.deepEqual(cliCalls(), ['gateway restart --json @engine-broken', 'gateway restart --json @engine']);
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

// FIX on 65c355d (Private #454 E with #1038's rule): an update restart never cuts off running Trunk work.

test('the update restart never forces: no --force (it would cut off work) and no --safe (it skips the definition rewrite); Stop completely keeps --force', () => {
  const restart = engineServiceArgs('restart');
  assert.equal(restart.includes('--force'), false, 'the update restart never begins at once over running work');
  assert.equal(restart.includes('--safe'), false, '--safe restarts the running engine over RPC and keeps the old service definition');
  assert.deepEqual(restart.slice(1, 3), ['gateway', 'restart']);
  assert.deepEqual(engineServiceArgs('stop'), ['branch.mjs', 'gateway', 'stop', '--force', '--json']);
});

test('a busy engine refuses the service update before the standby and before any restart, and after a standby that warmed while work started', async t => {
  const busy = { activeRuns: 1, pendingApprovals: 0, streaming: false };
  const idleWork = { activeRuns: 0, pendingApprovals: 0, streaming: false };
  for (const work of [busy, { ...idleWork, pendingApprovals: 1 }, { ...idleWork, streaming: true }]) {
    const { state, steps, engineDir, old } = fakeServiceManager(t);
    await assert.rejects(updateServiceEngine({ ...steps(engineDir('engine-new', 'v2')), workRunning: async () => work }), { message: TRUNKS_STILL_WORKING });
    assert.deepEqual(state.calls, [], 'no standby, no restart, nothing rejected or rolled back');
    assert.equal(state.serviceRuns, old);
  }
  // Idle when the update starts, busy once the standby warmed: the restart still never runs.
  const { state, steps, engineDir, old } = fakeServiceManager(t);
  const reads = [idleWork, busy];
  await assert.rejects(updateServiceEngine({ ...steps(engineDir('engine-new', 'v2')), workRunning: async () => reads.shift() ?? busy }), { message: TRUNKS_STILL_WORKING });
  assert.deepEqual(state.calls, ['standby']);
  assert.deepEqual(state.restarts, []);
  assert.equal(state.serviceRuns, old);
});

test('a running Trunk run survives an Update click in service mode: refused, no gateway CLI call, the run still answers', async t => {
  await serviceApp(t, () => ({ pendingApprovals: 0, streaming: true, unsavedDraftFiles: false, workingTrunks: 1 }), async ({ gatewayPort, clickUpdate, publish, cliCalls, standbys, serviceRuns, dialogs, desktopLog }) => {
    const run = originalFetch(`http://127.0.0.1:${gatewayPort}/run`).then(r => r.text());
    publish('engine-v2', 'v2');
    clickUpdate();
    await eventually(() => desktopLog().includes(`update failed: ${TRUNKS_STILL_WORKING}`), 15000);
    assert.match(desktopLog(), /service update: waiting for 1 active runs, 0 approvals, streaming reply before the update; the engine service was not touched/);
    assert.deepEqual(cliCalls(), [], 'no gateway restart (or any service) CLI call');
    assert.deepEqual(standbys(), [], 'not even a standby');
    assert.equal(serviceRuns(), 'engine');
    assert.deepEqual(dialogs.filter(d => d[0] === 'error').map(d => d[2]), [TRUNKS_STILL_WORKING]);
    assert.equal(await run, 'working done', 'the fake Trunk run finished on the engine it started on');
  }, updateEnv);
});

const pending = root => writeFileSync(join(root, 'component-update-pending.json'), JSON.stringify({ phase: 'pending', version: '9.9.9' }));
const autoEnv = { ...updateEnv, BRANCH_DESKTOP_UPDATE_FREE_DISK: '0.9', BRANCH_DESKTOP_UPDATE_FREE_MEMORY: '0.9' };

test('auto-apply in service mode reads the run count from the engine: the tick waits on the runs, no "activity check failed", no restart', async t => {
  await serviceApp(t, () => ({ pendingApprovals: 0, streaming: false, unsavedDraftFiles: false, workingTrunks: 2 }), async ({ cliCalls, standbys, serviceRuns, desktopLog }) => {
    await eventually(() => /auto-apply: waiting for 2 active runs, 0 approvals; no standby to hand off to for 9\.9\.9/.test(desktopLog()), 100000);
    assert.doesNotMatch(desktopLog(), /activity check failed/, 'the service engine answers the run count');
    assert.deepEqual(cliCalls(), []);
    assert.deepEqual(standbys(), []);
    assert.equal(serviceRuns(), 'engine');
  }, autoEnv, pending);
});

test('auto-apply in service mode: the handoff attempt makes no restart call and falls back to the idle drain', async t => {
  await serviceApp(t, idle, async ({ cliCalls, standbys, serviceRuns, desktopLog }) => {
    await eventually(() => /auto-apply: handoff unavailable; falling back to idle drain for 9\.9\.9/.test(desktopLog()), 15000);
    await eventually(() => /auto-apply: idle hold for 9\.9\.9/.test(desktopLog()), 15000);
    assert.doesNotMatch(desktopLog(), /activity check failed/);
    assert.deepEqual(cliCalls(), [], 'the handoff attempt made no gateway restart call');
    assert.deepEqual(standbys(), [], 'nor warmed a standby');
    assert.equal(serviceRuns(), 'engine');
  }, autoEnv, pending);
});

// Close and Quit (Private #1095, walkthrough B-102, B-103, B-104). The window's close button hides Branch to the tray
// and says so once; Quit, from the tray, the Branch menu or Ctrl/Cmd Q, stops the app, its engine and every process the
// engine started, even the fallback engine that Keep working leaves running after other quits. Temp folders, a loopback
// stand-in engine with one worker of its own, and a recording Electron stand-in only.
const killGroup = pid => { if (!pid) return; try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } } };

/** Electron stand-in: one window, a recording tray, dialogs that answer `answer`, and recorded notifications. */
function quitElectronFixture(answer = 0) {
  let window, tray, quitting = false;
  const app = new EventEmitter(), ipcMain = Object.assign(new EventEmitter(), { handle() {} });
  const dialogs = [], notices = [];
  Object.assign(app, { getVersion: () => 'fixture', setPath() {}, setAppUserModelId() {},
    requestSingleInstanceLock: () => true, whenReady: async () => {}, quit() {
      if (quitting) return; quitting = true; app.quitCalls = (app.quitCalls ?? 0) + 1;
      app.emit('before-quit'); window?.close(); app.emit('will-quit');
    } });
  class BrowserWindow extends EventEmitter {
    static fromWebContents(sender) { return window?.webContents === sender ? window : null; }
    constructor() {
      super(); window = this; this.hidden = false; this.destroyed = false;
      const wc = this.webContents = new EventEmitter();
      Object.assign(wc, { mainFrame: { url: '' }, getURL: () => this.url, setWindowOpenHandler() {}, isDestroyed: () => this.destroyed, reload() {}, send() {} });
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
  class Notification extends EventEmitter { static isSupported() { return true; }
    constructor(options) { super(); this.options = options; } show() { notices.push(this.options); } }
  return { app, dialogs, notices, get window() { return window; }, get tray() { return tray; }, electron: { app, BrowserWindow, Tray, ipcMain, Notification,
    Menu: { buildFromTemplate: value => value },
    screen: { getAllDisplays: () => [], getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 840 } }) },
    dialog: { showErrorBox: (...args) => dialogs.push(['error', ...args]),
      showMessageBox: async options => { dialogs.push(['ask', options.message, options.buttons]); return { response: answer }; } },
    session: { fromPartition() { return { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {} }; }, defaultSession: { setPermissionRequestHandler() {} } },
    shell: { openExternal() {} } } };
}

/**
 * A fake engine folder. The service CLI fails the way it does on a computer with no service manager, so the app runs
 * the engine itself (the fallback). The engine answers /readyz and starts one worker process of its own.
 */
function fallbackEngineFolder(root) {
  const dir = join(root, 'engine');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'build-info.json'), JSON.stringify({ version: 'fixture' }));
  writeFileSync(join(dir, 'branch.mjs'), `import fs from "node:fs"; import http from "node:http"; import { spawn } from "node:child_process";
const root = ${JSON.stringify(root)}, args = process.argv.slice(2);
if (args[0] === "gateway" && (args[1] === "--port" || args[1] === "--dev")) {
  const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  fs.writeFileSync(root + "/worker.pid", String(worker.pid));
  fs.writeFileSync(root + "/engine.pid", String(process.pid));
  http.createServer((q, r) => { r.statusCode = q.url === "/readyz" ? 200 : 404; r.end(); }).listen(Number(args[args.indexOf("--port") + 1]), "127.0.0.1");
} else {
  fs.appendFileSync(root + "/cli-calls.txt", args.join(" ") + "\\n");
  console.error("No supported service manager detected");
  process.exit(1);
}`);
  return dir;
}

/** The real main.js with Always on and Keep working on, on a computer whose service cannot be installed. */
async function fallbackApp(t, run) {
  const root = tempDir(t, 'branch-quit-fallback-');
  const windowDir = join(root, 'window'), profile = join(root, 'profile');
  for (const dir of [windowDir, profile]) mkdirSync(dir, { recursive: true });
  const engine = fallbackEngineFolder(root);
  writeFileSync(join(windowDir, 'index.html'), '<html>fixture</html>');
  const gatewayPort = await freePort(), windowPort = await freePort();
  writeFileSync(join(root, 'desktop.json'), JSON.stringify({ dataDir: root, engineDir: engine, windowDir, nodePath: process.execPath,
    gatewayPort, windowPort, alwaysOn: true }));
  const vars = { BRANCH_DESKTOP_DATA: root, BRANCH_DESKTOP_HIDDEN: '0', BRANCH_DESKTOP_ENGINE_PROFILE: profile };
  const saved = Object.fromEntries(Object.keys(vars).map(key => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const runtime = quitElectronFixture();
  Module._load = function(name, ...args) {
    if (name === 'electron') return runtime.electron;
    const loaded = originalLoad.call(this, name, ...args);
    if (name !== './resident-window') return loaded;
    return { ...loaded, keepWindowResident(app, window, icon, options) {
      return loaded.keepWindowResident(app, window, icon, { ...options, platform: 'linux' });
    } };
  };
  globalThis.fetch = (url, options) => String(url).startsWith('https://') ? Promise.resolve(new Response('', { status: 404 })) : originalFetch(url, options);
  for (const name of ['main.js', 'config.js', 'resident-window.js']) delete require.cache[join(dist, name)];
  const desktopLog = () => { try { return readFileSync(join(root, 'desktop.log'), 'utf8'); } catch { return ''; } };
  const pid = file => { try { return Number(readFileSync(join(root, file), 'utf8')); } catch { return 0; } };
  let engineRan = 0, workerRan = 0;
  // Registered before the folder's removal: whatever this test left running is gone before the folder is.
  t.after(async () => { killGroup(engineRan); killGroup(workerRan); await pause(100); });
  try {
    require(join(dist, 'main.js'));
    await eventually(() => desktopLog().includes('running the engine inside the app') && pid('worker.pid') > 0 && desktopLog().includes('gateway ready after'));
    engineRan = pid('engine.pid'); workerRan = pid('worker.pid');
    await run({ ...runtime, window: runtime.window, tray: runtime.tray, root, gatewayPort, desktopLog, engine: engineRan, worker: workerRan });
  } finally {
    runtime.app.quit(); Module._load = originalLoad; globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await pause(50);
  }
}

test('tray Quit stops the fallback engine and the worker it started, even with Keep working on: nothing is left running', { skip: process.platform === 'win32' && 'process groups (the Windows leg checks the job tree)' }, async t => {
  await fallbackApp(t, async ({ app, window, tray, engine, worker, gatewayPort, root }) => {
    assert.ok(alive(engine) && alive(worker), 'the engine and its worker run');
    assert.equal(window.close().prevented, true, 'the close button only hides the window');
    assert.equal(alive(engine), true, 'closing the window keeps the engine working');
    const quit = tray.menu.find(entry => /^Quit/.test(entry.label ?? ''));
    quit.click();
    await eventually(() => (app.quitCalls ?? 0) === 1);
    await eventually(() => !alive(engine) && !alive(worker), 5_000).catch(() => undefined);
    assert.equal(alive(engine), false, 'Quit stopped the engine');
    assert.equal(alive(worker), false, 'Quit stopped the engine\'s worker: no orphan');
    assert.equal(await originalFetch(`http://127.0.0.1:${gatewayPort}/readyz`).then(r => r.status, () => 0), 0, 'nothing answers on the engine port');
    const { findSurvivingEngine } = require(join(dist, 'engine-records.js'));
    assert.equal(await findSurvivingEngine(root, gatewayPort), undefined, 'the next launch has nothing to attach to');
  });
});

/** keepWindowResident on its own, with a recording Electron stand-in. */
function residentFixture({ userData, answer = 0, platform = 'linux' } = {}) {
  const notices = [], dialogs = [];
  let tray, appMenu;
  const electron = {
    Menu: { buildFromTemplate: value => value, setApplicationMenu: value => { appMenu = value; } },
    Tray: class extends EventEmitter { constructor() { super(); tray = this; } setToolTip(value) { this.tooltip = value; } setContextMenu(value) { this.menu = value; } destroy() {} },
    Notification: class extends EventEmitter { static isSupported() { return true; } constructor(options) { super(); this.options = options; } show() { notices.push(this.options); } },
    dialog: { showMessageBox: async options => { dialogs.push(options); return { response: answer }; } },
    nativeImage: { createFromPath: () => ({ setTemplateImage() {} }) },
  };
  Module._load = function(name, ...args) { return name === 'electron' ? electron : originalLoad.call(this, name, ...args); };
  delete require.cache[join(dist, 'resident-window.js')];
  const { keepWindowResident, showTrayStatus } = require(join(dist, 'resident-window.js'));
  Module._load = originalLoad;
  const app = Object.assign(new EventEmitter(), { quitCalls: 0, quit() { this.quitCalls++; }, getPath: () => userData });
  const window = Object.assign(new EventEmitter(), { hidden: false, webContents: new EventEmitter(),
    hide() { this.hidden = true; }, show() { this.hidden = false; }, focus() {}, isMinimized: () => false, restore() {} });
  const calls = [];
  keepWindowResident(app, window, 'unused.png', { platform, keepRunning: () => true, pauseAll: () => calls.push('pause'), stopCompletely: () => calls.push('stop') });
  const close = () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; window.emit('close', event); return event; };
  return { app, window, notices, dialogs, calls, close, get tray() { return tray; }, get appMenu() { return appMenu; }, status: state => showTrayStatus(tray, state) };
}

test('the first close shows the one-time notice in the preview\'s words, exactly once, and never again after a relaunch', t => {
  const userData = tempDir(t, 'branch-close-notice-');
  const first = residentFixture({ userData });
  assert.equal(first.close().prevented, true);
  assert.equal(first.window.hidden, true);
  assert.deepEqual(first.notices.map(n => n.title), ['Branch closes to the tray.']);
  assert.equal(first.notices[0].body, 'It keeps working there. To stop it, choose Quit in the tray menu.');
  first.window.show(); first.close(); first.window.show(); first.close();
  assert.equal(first.notices.length, 1, 'later closes stay quiet');
  const relaunched = residentFixture({ userData });
  relaunched.close();
  assert.equal(relaunched.notices.length, 0, 'remembered across launches');
  const mac = residentFixture({ userData: tempDir(t, 'branch-close-notice-mac-'), platform: 'darwin' });
  mac.close();
  assert.equal(mac.notices[0].body, 'It keeps working there. To stop it, choose Quit Branch in the Branch menu.');
});

test('Quit asks in the preview\'s words while work runs; Keep it running in the tray stops nothing', async t => {
  const kept = residentFixture({ userData: tempDir(t, 'branch-quit-keep-'), answer: 1 });
  assert.deepEqual(kept.tray.menu.map(i => i.label ?? '-'), ['Open Branch', 'Pause all work', '-', 'Quit']);
  kept.status({ running: true, workingTrunks: 2, waitingOnYou: 0 });
  kept.tray.menu.find(i => i.label === 'Quit').click();
  await eventually(() => kept.window.hidden);
  assert.equal(kept.dialogs.length, 1);
  assert.equal(kept.dialogs[0].message, 'Quit while 2 Trunks are working?');
  assert.equal(kept.dialogs[0].detail, 'If you quit, they stop and pick up next time you open Branch. Keep Branch in the tray to let them finish.');
  assert.deepEqual(kept.dialogs[0].buttons, ['Quit anyway', 'Keep it running in the tray']);
  assert.deepEqual(kept.calls, [], 'nothing was stopped');
  const { fullStopRequested } = require(join(dist, 'quit-intent.js'));
  assert.equal(fullStopRequested(), false);

  const quit = residentFixture({ userData: tempDir(t, 'branch-quit-anyway-'), answer: 0 });
  quit.status({ running: true, workingTrunks: 1, waitingOnYou: 0 });
  quit.tray.menu.find(i => i.label === 'Quit').click();
  await eventually(() => quit.calls.includes('stop'));
  assert.equal(quit.dialogs[0].message, 'Quit while 1 Trunk is working?');
  assert.equal(quit.dialogs[0].detail, 'If you quit, it stops and picks up next time you open Branch. Keep Branch in the tray to let it finish.');
  assert.equal(fullStopRequested(), true, 'the engine stops with the app');

  const idle = residentFixture({ userData: tempDir(t, 'branch-quit-idle-') });
  idle.status({ running: true, workingTrunks: 0, waitingOnYou: 0 });
  idle.tray.menu.find(i => i.label === 'Quit').click();
  await eventually(() => idle.calls.includes('stop'));
  assert.equal(idle.dialogs.length, 0, 'nothing runs, so Quit does not ask');
});

test('Branch › Quit Branch (Cmd Q) on a Mac, and Ctrl Q in the window elsewhere, reach the same Quit', async t => {
  const mac = residentFixture({ userData: tempDir(t, 'branch-menu-mac-'), platform: 'darwin' });
  const branch = mac.appMenu?.[0];
  assert.equal(branch?.label, 'Branch');
  const item = branch.submenu.find(i => i.label === 'Quit Branch');
  assert.equal(item.accelerator, 'Command+Q');
  assert.ok(branch.submenu.some(i => i.label === 'About Branch'));
  assert.deepEqual(mac.appMenu.slice(1).map(m => m.role), ['fileMenu', 'editMenu', 'viewMenu', 'windowMenu'], 'copy, paste and Close Window keep working');
  mac.status({ running: true, workingTrunks: 0, waitingOnYou: 0 });
  item.click();
  await eventually(() => mac.calls.includes('stop'));

  const linux = residentFixture({ userData: tempDir(t, 'branch-menu-linux-') });
  assert.equal(linux.appMenu, undefined, 'Windows and Linux keep their hidden menu bar');
  linux.status({ running: true, workingTrunks: 0, waitingOnYou: 0 });
  const key = (input) => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; linux.window.webContents.emit('before-input-event', event, input); return event; };
  assert.equal(key({ type: 'keyDown', key: 'q', control: true, shift: true }).prevented, false, 'Ctrl Shift Q is left to the page');
  assert.equal(key({ type: 'keyDown', key: 'a', control: true }).prevented, false);
  assert.deepEqual(linux.calls, []);
  assert.equal(key({ type: 'keyDown', key: 'q', control: true }).prevented, true);
  await eventually(() => linux.calls.includes('stop'));
});

test('a signal (Ctrl C in a terminal, kill) quits the same way; the question has a plain answer for every state', () => {
  const { quitOnSignals } = require(join(dist, 'quit-intent.js'));
  const source = new EventEmitter(), seen = [];
  quitOnSignals(source, signal => seen.push(signal));
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGTERM']) source.emit(signal);
  assert.deepEqual(seen, ['SIGTERM', 'SIGINT', 'SIGHUP'], 'once each; a second signal falls through to the system');
  const { quitQuestion } = require(join(dist, 'tray-status.js'));
  assert.equal(quitQuestion({ running: true, workingTrunks: 0, waitingOnYou: 0 }), undefined);
  assert.equal(quitQuestion({ running: false, workingTrunks: 0, waitingOnYou: 0 }), undefined);
  assert.equal(quitQuestion(undefined).message, 'Quit while Branch may still be working?');
  assert.equal(quitQuestion({ running: true, workingTrunks: 0, waitingOnYou: 1 }).message, 'Quit while 1 request is waiting on you?');
  assert.equal(quitQuestion({ running: true, workingTrunks: 0, waitingOnYou: 3 }).message, 'Quit while 3 requests are waiting on you?');
});
