import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url), Module = require('node:module');
const originalLoad = Module._load, originalFetch = globalThis.fetch;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); return port;
}
async function eventually(predicate, ms = 5000) {
  const end = Date.now() + ms;
  while (!await predicate()) { if (Date.now() > end) throw Error('Fixture deadline'); await pause(20); }
}
function electronFixture() {
  let window, tray, quitting = false; const app = new EventEmitter();
  Object.assign(app, { getVersion: () => 'fixture', setPath() {}, setAppUserModelId() {},
    requestSingleInstanceLock: () => true, whenReady: async () => {}, quit() {
      if (quitting) return; quitting = true;
      app.emit('before-quit'); window?.close(); app.emit('will-quit');
    } });
  class BrowserWindow extends EventEmitter {
    constructor() { super(); window = this; this.hidden = false; this.destroyed = false; this.loads = [];
      this.webContents = new EventEmitter(); Object.assign(this.webContents, { getURL: () => this.url,
        setWindowOpenHandler() {}, send() {}, reload() { assert.fail('Reopen must not reload private drafts'); } }); }
    async loadURL(url) { this.url = url; this.loads.push(url); this.webContents.emit('did-finish-load'); }
    close() { const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', event); if (!event.prevented) { this.destroyed = true; app.emit('window-all-closed'); } return event; }
    hide() { this.hidden = true; } show() { this.hidden = false; } focus() { this.focused = true; }
    isMinimized() { return this.minimized ?? false; } restore() { this.minimized = false; }
    setMenuBarVisibility() {}
    maximize() {} isMaximized() { return false; } isDestroyed() { return false; } getNormalBounds() { return { x: 0, y: 0, width: 1280, height: 840 }; }
  }
  class Tray extends EventEmitter { constructor() { super(); tray = this; }
    setToolTip(value) { this.tooltip = value; } setContextMenu(value) { this.menu = value; }
    destroy() { this.destroyed = true; } }
  return { app, get window() { return window; }, get tray() { return tray; }, electron: { app, BrowserWindow, Tray,
    Menu: { buildFromTemplate: value => value }, screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [], getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 1280, height: 840 } }) }), ipcMain: Object.assign(new EventEmitter(), { handle() {} }), dialog: { showErrorBox: assert.fail },
    session: { defaultSession: { setPermissionRequestHandler() {} } }, shell: { openExternal() {} } } };
}
async function fixture(run, hidden = false) {
  const temp = join(tmpdir(), 'Codex-session-files'); await mkdir(temp, { recursive: true });
  const root = await mkdtemp(join(temp, 'branch-resident-policy-'));
  const engine = join(root, 'engine'), windowDir = join(root, 'window');
  await mkdir(join(engine, 'dist'), { recursive: true }); await mkdir(windowDir);
  await writeFile(join(engine, 'dist/build-info.json'), '{"version":"fixture"}');
  await writeFile(join(engine, 'branch.mjs'), 'import http from "node:http";http.createServer((q,r)=>r.writeHead(200).end()).listen(Number(process.argv.at(-1)),"127.0.0.1");');
  await writeFile(join(windowDir, 'index.html'), '<html>fixture</html>');
  const cfg = { dataDir: root, engineDir: engine, windowDir, nodePath: process.execPath,
    gatewayPort: await freePort(), windowPort: await freePort() };
  await writeFile(join(root, 'desktop.json'), JSON.stringify(cfg));
  const previousData = process.env.BRANCH_DESKTOP_DATA, previousHidden = process.env.BRANCH_DESKTOP_HIDDEN;
  process.env.BRANCH_DESKTOP_DATA = root; process.env.BRANCH_DESKTOP_HIDDEN = hidden ? '1' : '0';
  const runtime = electronFixture();
  Module._load = function(name, ...args) {
    if (name === 'electron') return runtime.electron;
    const loaded = originalLoad.call(this, name, ...args);
    if (name !== './resident-window') return loaded;
    return { ...loaded, keepWindowResident(app, window, icon, options) {
      return loaded.keepWindowResident(app, window, icon, { ...options, platform: 'win32' });
    } };
  };
  globalThis.fetch = (url, options) => String(url).startsWith('https://github.com/') ? Promise.resolve(new Response('', { status: 404 })) : originalFetch(url, options);
  for (const name of ['main.js', 'config.js', 'resident-window.js']) {
    const path = join(process.env.BRANCH_DESKTOP_TEST_DIST, name); delete require.cache[path];
  }
  try {
    require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'main.js'));
    await eventually(async () => { try { return (await readFile(join(root, 'desktop.log'), 'utf8')).includes('gateway ready after'); } catch { return false; } });
    const pid = Number(await readFile(join(root, 'gateway.pid'), 'utf8'));
    await run({ ...runtime, window: runtime.window, tray: runtime.tray, root, pid });
  } finally {
    runtime.app.quit(); Module._load = originalLoad; globalThis.fetch = originalFetch;
    if (previousData === undefined) delete process.env.BRANCH_DESKTOP_DATA; else process.env.BRANCH_DESKTOP_DATA = previousData;
    if (previousHidden === undefined) delete process.env.BRANCH_DESKTOP_HIDDEN; else process.env.BRANCH_DESKTOP_HIDDEN = previousHidden;
    await rm(root, { recursive: true, force: true });
  }
}

test('actual desktop close hides the window and retains its owned running gateway', () => fixture(async ({ window, pid }) => {
  assert.equal(window.close().prevented, true); assert.equal(window.hidden, true); assert.equal(window.destroyed, false);
  assert.doesNotThrow(() => process.kill(pid, 0));
}));
test('the window title follows the page title', () => fixture(async ({ window }) => {
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  window.emit('page-title-updated', event, 'Library · Branch Agent', true);
  assert.equal(event.prevented, false);
}));
test('actual second instance and tray Open reuse the same window, gateway and in-memory draft', () => fixture(async ({ app, window, tray, root, pid }) => {
  window.draft = { text: 'private draft', attachment: new Uint8Array([1, 2, 3]) }; const draft = window.draft;
  const loads = window.loads.length; window.close(); window.minimized = true; app.emit('second-instance');
  assert.equal(window.hidden, false); assert.equal(window.minimized, false); assert.equal(window.focused, true);
  window.close(); tray.menu.find(item => item.label === 'Open Branch').click();
  window.close(); tray.emit('click'); assert.equal(window.hidden, false);
  window.close(); tray.emit('double-click'); assert.equal(window.hidden, false);
  assert.equal(window.hidden, false); assert.equal(window.draft, draft); assert.equal(window.loads.length, loads);
  assert.equal(Number(await readFile(join(root, 'gateway.pid'), 'utf8')), pid);
  assert.equal((await readFile(join(root, 'desktop.log'), 'utf8')).match(/gateway started from/g).length, 1);
}));
test('Dock activate restores the resident window without restarting its gateway or losing its draft', () => fixture(async ({ app, window, root, pid }) => {
  window.draft = { text: 'private draft' }; const draft = window.draft;
  const loads = window.loads.length; window.close(); window.minimized = true; app.emit('activate');
  assert.equal(window.hidden, false); assert.equal(window.minimized, false); assert.equal(window.focused, true);
  assert.equal(window.draft, draft); assert.equal(window.loads.length, loads);
  assert.equal(Number(await readFile(join(root, 'gateway.pid'), 'utf8')), pid);
  assert.equal((await readFile(join(root, 'desktop.log'), 'utf8')).match(/gateway started from/g).length, 1);
}));
test('tray Quit and session end perform normal owned-child shutdown', () => fixture(async ({ tray, window, pid }) => {
  assert.ok(tray); tray.menu.find(item => item.label === 'Quit Branch').click();
  assert.equal(window.destroyed, true); assert.equal(tray.destroyed, true);
  await eventually(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
}));
test('session-end quits instead of hiding a dying OS session', () => fixture(async ({ window, pid }) => {
  window.emit('session-end'); assert.equal(window.destroyed, true);
  await eventually(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
}));
test('hidden native fixtures retain close policy without creating a visible tray', () => fixture(async ({ app, tray, window, pid }) => {
  assert.equal(tray, undefined); assert.equal(window.close().prevented, true);
  app.quit(); assert.equal(window.destroyed, true);
  await eventually(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
}, true));
test('usage-off setTrayUsage restores the darwin template and never branch-48.png', async () => {
  const desktop = join(process.env.BRANCH_DESKTOP_TEST_DIST, '..');
  const main = await readFile(join(desktop, 'src/main.ts'), 'utf8');
  const osSource = await readFile(join(desktop, 'src/desktop-os.ts'), 'utf8');
  assert.match(main, /desktopOs\(app, cfg, \(\) => tray, TRAY_ICON\)/);
  assert.match(osSource, /t\.setImage\(menuBarIcon\(icon, process\.platform\)\)/);
  const template = join(desktop, 'assets', 'brand', 'linux', 'branchTemplate.png');
  Module._load = function (name, ...args) {
    if (name !== 'electron') return originalLoad.call(this, name, ...args);
    return {
      nativeImage: {
        createFromPath: (file) => ({ path: file, template: false, setTemplateImage(on) { this.template = on; } }),
        createFromBitmap: () => ({ kind: 'ring' }),
      },
      powerSaveBlocker: { start: () => 1, isStarted: () => false, stop() {} },
      shell: { openExternal() {} },
      Menu: { buildFromTemplate: value => value },
      Tray: class {},
    };
  };
  const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
  const modules = ['resident-window.js', 'desktop-os.js', 'desktop-controls.js'].map(name => join(dist, name));
  for (const path of modules) delete require.cache[path];
  const root = await mkdtemp(join(tmpdir(), 'branch-tray-template-'));
  try {
    const { menuBarIcon } = require(modules[0]);
    const restored = menuBarIcon(template, 'darwin');
    assert.equal(restored.template, true);
    assert.match(restored.path, /branchTemplate\.png$/);
    assert.doesNotMatch(restored.path, /branch-48\.png/);
    const { desktopOs } = require(modules[1]);
    const { createDesktopControls } = require(modules[2]);
    const seen = [];
    const controls = createDesktopControls(desktopOs(
      { getLoginItemSettings: () => ({ openAtLogin: false }) },
      { dataDir: root },
      () => ({ setImage(value) { seen.push(value); }, setToolTip() {} }),
      template,
    ));
    controls.trayUsage(40);
    await controls.set('trayUsage', true);
    controls.trayUsage(12);
    await controls.set('trayUsage', false);
    assert.equal(seen.length, 4);
    for (const value of [seen[0], seen[3]]) {
      const path = typeof value === 'string' ? value : value.path;
      assert.match(path, /branchTemplate\.png$/);
      assert.doesNotMatch(path, /branch-48\.png/);
      if (value && typeof value === 'object') assert.equal(value.template, true);
    }
    for (const value of [seen[1], seen[2]]) assert.equal(value.kind, 'ring');
    assert.equal(JSON.stringify(seen).includes('branch-48.png'), false);
  } finally {
    Module._load = originalLoad;
    await rm(root, { recursive: true, force: true });
  }
});

test('macOS and Linux keep the gateway resident after the window closes', () => {
  const { keepWindowResident } = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'resident-window.js'));
  for (const platform of ['darwin', 'linux']) {
    const app = new EventEmitter(), window = new EventEmitter();
    let hidden = false;
    window.hide = () => { hidden = true; };
    keepWindowResident(app, window, 'unused.ico', { platform, hidden: true });
    const close = { prevented: false, preventDefault() { this.prevented = true; } };
    window.emit('close', close);
    assert.equal(close.prevented, true);
    assert.equal(hidden, true);
    app.emit('before-quit');
    const quitClose = { prevented: false, preventDefault() { this.prevented = true; } };
    window.emit('close', quitClose);
    assert.equal(quitClose.prevented, false);
  }
});
