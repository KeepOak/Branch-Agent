// Always on (Private #454 D and F): the sleep blocker is held only while a run is active and never on battery by
// default; approvals and "done" raise a notification while the window is closed (and "done" reaches a paired phone);
// the tray says degraded with the engine's reason; Linux linger goes through the engine's linger path; the power
// source reaches the engine. Nothing here takes a real sleep blocker, shows a notification, runs loginctl or touches
// a service: spawn, notifications and the engine CLI are fakes, and the engine is a loopback stand-in.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url);
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const { createRunKeepAwake, sleepBlockerCommand, writePowerState, POWER_STATE_FILE, claimServiceKeepAwake, handOffKeepAwake, appHoldsSleepBlock, KEEP_AWAKE_OWNER_FILE, DESKTOP_KEEP_AWAKE_FRESH_MS, SERVICE_KEEP_AWAKE_CLAIM_MS, KEEP_AWAKE_LEASE_MS } = require(join(dist, 'keep-awake.js'));
const { createClosedWindowNotifier, readEngineLiveState, trayLabel, workNotices } = require(join(dist, 'tray-status.js'));
const { engineLingerArgs, parseLingerAnswer, readEngineHealth } = require(join(dist, 'engine-service.js'));
const { createDesktopControls } = require(join(dist, 'desktop-controls.js'));

function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'branch-always-on-df-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A fake spawn: records each blocker it starts and whether it was killed. */
function fakeSpawn() {
  const started = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    const entry = { file, args, options, killed: false, child };
    child.kill = () => { entry.killed = true; child.emit('exit', null, 'SIGTERM'); return true; };
    started.push(entry);
    return child;
  };
  return { spawn, started, held: () => started.filter(entry => !entry.killed) };
}

function fakeClock(start = 1_000) {
  let now = start;
  const timers = [];
  let nextId = 1;
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      const index = timers.findIndex(timer => timer.id === id);
      if (index >= 0) timers.splice(index, 1);
    },
    advance(ms) {
      now += ms;
      for (;;) {
        const due = timers.filter(timer => timer.at <= now).sort((a, b) => a.at - b.at);
        if (!due.length) return;
        for (const timer of due) {
          const index = timers.indexOf(timer);
          if (index < 0) continue;
          timers.splice(index, 1);
          timer.fn();
        }
      }
    },
  };
}

function keepAwakeFixture(over = {}) {
  const power = { onBattery: false, enabled: true, onBatteryToo: false, ...over };
  const fake = fakeSpawn();
  const lines = [];
  const clock = over.clock ?? fakeClock();
  const keepAwake = createRunKeepAwake({
    platform: 'darwin', appPid: 4242, spawn: fake.spawn,
    enabled: () => power.enabled, onBatteryToo: () => power.onBatteryToo, onBattery: () => power.onBattery,
    log: line => lines.push(line), now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  return { keepAwake, power, fake, lines, clock };
}

test('the sleep blocker is held only while a fake run is active and released the moment it ends', () => {
  const { keepAwake, fake } = keepAwakeFixture();
  keepAwake.update(false);
  assert.equal(fake.started.length, 0, 'nothing is held while no Trunk works');
  keepAwake.update(true);
  keepAwake.update(true);
  assert.equal(fake.held().length, 1, 'one blocker while the run is active');
  assert.deepEqual([fake.started[0].file, ...fake.started[0].args], ['caffeinate', '-i', '-w', '4242']);
  assert.equal(keepAwake.held(), true);
  keepAwake.update(false);
  assert.equal(fake.held().length, 0, 'released when the run ends');
  assert.equal(keepAwake.held(), false);
  keepAwake.update(true);
  keepAwake.dispose();
  assert.equal(fake.held().length, 0, 'quitting releases it at once');
  keepAwake.update(true);
  assert.equal(fake.held().length, 0, 'never taken again after quit');
});

test('on battery the blocker is not taken by default, and plugging in takes it for the running Trunk', () => {
  const { keepAwake, power, fake } = keepAwakeFixture({ onBattery: true });
  keepAwake.update(true);
  assert.equal(fake.started.length, 0, 'not on battery by default');
  power.onBattery = false;
  keepAwake.refresh();
  assert.equal(fake.held().length, 1, 'plugged in mid-run: held');
  power.onBattery = true;
  keepAwake.refresh();
  assert.equal(fake.held().length, 0, 'unplugged mid-run: released');
  power.onBatteryToo = true;
  keepAwake.refresh();
  assert.equal(fake.held().length, 1, '"Also on battery" holds it on battery too');
  power.enabled = false;
  keepAwake.refresh();
  assert.equal(fake.held().length, 0, 'turning the switch off releases it');
});

test('a blocker the OS cannot run is reported and never left marked as held', () => {
  const { keepAwake, fake, lines } = keepAwakeFixture();
  keepAwake.update(true);
  assert.equal(keepAwake.held(), true);
  // This computer has no such command: spawn reports an error event.
  fake.started[0].child.emit('error', new Error('spawn caffeinate ENOENT'));
  assert.equal(keepAwake.held(), false);
  assert.ok(lines.some(line => line.includes('could not run (spawn caffeinate ENOENT)')));
  // The spawn options never tie the app to the blocker's window or console.
  assert.deepEqual(fake.started[0].options, { stdio: 'ignore', windowsHide: true, detached: false });
});

test('each OS uses its own sleep blocker, tied to the app process', () => {
  assert.deepEqual(sleepBlockerCommand('darwin', 7), { file: 'caffeinate', args: ['-i', '-w', '7'] });
  const linux = sleepBlockerCommand('linux', 7);
  assert.equal(linux.file, 'systemd-inhibit');
  assert.ok(linux.args.includes('--what=idle:sleep') && linux.args.includes('--pid=7'));
  const windows = sleepBlockerCommand('win32', 7);
  assert.equal(windows.file, 'powershell.exe');
  assert.match(windows.args.at(-1), /SetThreadExecutionState\(\[uint32\]2147483649\)/);
  assert.match(windows.args.at(-1), /Wait-Process -Id 7/);
  assert.equal(sleepBlockerCommand('freebsd', 7), undefined);
});

test('with the window closed, approvals and "done" raise a notification and "done" reaches a paired phone', () => {
  const shown = [], phone = [];
  let windowShown = false;
  const notifier = createClosedWindowNotifier({ windowShown: () => windowShown, show: n => shown.push(n), phone: n => phone.push(n) });
  const state = (workingTrunks, waitingOnYou) => ({ running: true, workingTrunks, waitingOnYou });
  notifier.observe(state(2, 0));
  notifier.observe(state(2, 1));
  assert.deepEqual(shown.map(n => [n.kind, n.title]), [['approval', 'Waiting on you']]);
  notifier.observe(state(1, 0));
  assert.deepEqual(shown.map(n => n.kind), ['approval', 'done']);
  assert.equal(shown[1].body, 'A Trunk finished its work.');
  assert.deepEqual(phone.map(n => n.kind), ['done'], 'approvals already reach the phone from the engine itself');
  // With the window on screen nothing is raised.
  windowShown = true;
  notifier.observe(state(0, 1));
  assert.equal(shown.length, 2);
  // A stopped engine is not "done".
  windowShown = false;
  assert.deepEqual(workNotices(state(3, 0), { running: false, workingTrunks: 0, waitingOnYou: 0 }), []);
});

test('the tray and /health say degraded with the reason, never Ready, while an agent cannot answer', async t => {
  let health = { ok: false, status: 'degraded', reason: "an agent's database is not admitting work: main (owned by another install)" };
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') { res.end(JSON.stringify(health)); return; }
    res.statusCode = 503; res.end('{}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const reading = await readEngineHealth(port);
  assert.deepEqual(reading, { answered: true, degraded: health.reason });
  // /readyz says not ready, but the engine answers: running and degraded, not "Stopped".
  const state = await readEngineLiveState({ engineUp: async () => false, health: () => readEngineHealth(port), window: async () => undefined });
  assert.equal(state.running, true);
  assert.equal(trayLabel(state), `Needs attention: ${health.reason}`);
  health = { ok: true, status: 'live' };
  const ready = await readEngineLiveState({ engineUp: async () => true, health: () => readEngineHealth(port), window: async () => ({ pendingApprovals: 0, streaming: false, workingTrunks: 0 }) });
  assert.equal(trayLabel(ready), 'Ready');
  assert.deepEqual(await readEngineHealth(1), { answered: false });
});

test('Linux "Keep working when nobody is signed in" goes through the engine linger path', async t => {
  const dir = tempDir(t);
  const lingerCalls = [];
  let linger = false;
  const deps = {
    settingsFile: join(dir, 'desktop-settings.json'),
    login: { get: () => true, set: () => {} },
    cli: { installed: async () => false, install: async () => {}, uninstall: async () => {} },
    tray: { usage: () => {} },
    openExternal: async () => {},
    linger: { get: async () => { lingerCalls.push('status'); return linger; }, set: async on => { lingerCalls.push(on ? 'on' : 'off'); linger = on; } },
    notes: () => ({ keepWorking: 'Branch runs inside the app on this computer.' }),
  };
  const controls = createDesktopControls(deps);
  const first = await controls.get();
  assert.equal(first.keepWorkingSignedOut, false);
  assert.deepEqual(first.notes, { keepWorking: 'Branch runs inside the app on this computer.' });
  assert.equal((await controls.set('keepWorkingSignedOut', true)).keepWorkingSignedOut, true);
  assert.equal((await controls.set('keepWorkingSignedOut', false)).keepWorkingSignedOut, false);
  assert.deepEqual(lingerCalls, ['status', 'on', 'off'], 'read once, then each change goes to the engine');
  // Elsewhere there is no such switch.
  const elsewhere = createDesktopControls({ ...deps, linger: undefined, notes: undefined });
  assert.equal('keepWorkingSignedOut' in await elsewhere.get(), false);
  await assert.rejects(elsewhere.set('keepWorkingSignedOut', true), /Linux/);
  // The engine command and its answer.
  assert.deepEqual(engineLingerArgs('on'), ['branch.mjs', 'gateway', 'linger', 'on', '--json']);
  assert.deepEqual(engineLingerArgs('off'), ['branch.mjs', 'gateway', 'linger', 'off', '--json']);
  assert.equal(parseLingerAnswer('{"ok":true,"user":"pat","linger":"yes"}\n'), true);
  assert.throws(() => parseLingerAnswer('{"ok":false,"error":"Access denied. Run sudo loginctl enable-linger pat once in a terminal."}'), /sudo loginctl/);
});

test('the power source reaches the engine, for its battery politeness', t => {
  const dir = tempDir(t);
  writePowerState(dir, true, 1234);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, POWER_STATE_FILE), 'utf8')), { onBattery: true, at: 1234 });
  writePowerState(dir, false, 5678);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, POWER_STATE_FILE), 'utf8')), { onBattery: false, at: 5678 });
});

test('a stale keep-awake hold with no live run expires, and an active run keeps the machine awake', () => {
  const { keepAwake, fake, lines, clock } = keepAwakeFixture();
  keepAwake.update(true);
  assert.equal(keepAwake.held(), true);
  clock.advance(KEEP_AWAKE_LEASE_MS - 1);
  keepAwake.update(true);
  clock.advance(KEEP_AWAKE_LEASE_MS - 1);
  assert.equal(keepAwake.held(), true, 'a live run renews the hold');
  assert.equal(fake.held().length, 1);
  clock.advance(KEEP_AWAKE_LEASE_MS);
  assert.equal(keepAwake.held(), false, 'no renewing run: the hold expires');
  assert.equal(fake.held().length, 0);
  assert.ok(lines.some(line => line.includes('released (no live Trunk run)')), lines.join('\n'));
  keepAwake.dispose();
});

test('the open app does not hold a second blocker, and quit hands sleep and power to the service engine', t => {
  const dir = tempDir(t);
  assert.equal(appHoldsSleepBlock(true), false, 'service path: the engine holds the blocker');
  assert.equal(appHoldsSleepBlock(false), true, 'child engine: this app still holds it');
  assert.equal(SERVICE_KEEP_AWAKE_CLAIM_MS < DESKTOP_KEEP_AWAKE_FRESH_MS, true);
  claimServiceKeepAwake(dir, 1000);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, KEEP_AWAKE_OWNER_FILE), 'utf8')), { sleep: 'engine', power: 'desktop', at: 1000 });
  let disposed = false;
  handOffKeepAwake(dir, { dispose: () => { disposed = true; } }, 2000);
  assert.equal(disposed, true, 'quit releases any blocker this app held before the engine takes it');
  assert.deepEqual(JSON.parse(readFileSync(join(dir, KEEP_AWAKE_OWNER_FILE), 'utf8')), { sleep: 'engine', power: 'engine', at: 2000 });
});
