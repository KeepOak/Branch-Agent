// Always on (Private #454 A+B): the app attaches to the engine service and never starts a second engine.
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url);
const service = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'engine-service.js'));
const fallback = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'fallback-engine.js'));
const records = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'engine-records.js'));
const { acquireEngineStartLock, attachOrStartEngine, engineAnswers, engineServiceArgs, recordEngineMode, takeChildModeNotice, takeCrashStormNotice } = service;
const { EXTERNAL_VOLUME_SERVICE_LINE, SERVICE_BLOCKED_LINE, childModeSettingsLine, parseLaunchdJob, readServiceLogsSince, serviceCannotRunReason, serviceLogPaths, serviceVolumeBlock } = service;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Windows keeps a directory locked until the process that used it as its cwd has exited. */
async function removeDataDir(dir) {
  const end = Date.now() + 5_000;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code) || Date.now() > end) throw error;
      await pause(50);
    }
  }
}

function dataDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'branch-always-on-'));
  t.after(() => removeDataDir(dir));
  return dir;
}

/** A loopback engine stand-in answering /readyz, on its own free port (never the app's 19031/19032). */
async function readyEngine(t) {
  const server = createServer((req, res) => { res.statusCode = req.url === '/readyz' ? 200 : 404; res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

/**
 * A fake service manager that is NOT idempotent: every start launches another engine, as a raw spawn would. Only the
 * app's own attach and start lock can keep it to one engine.
 */
function fakeServiceManager(options = {}) {
  const state = { installs: 0, starts: 0, engines: 0, children: 0 };
  const steps = dir => ({
    dataDir: dir,
    probe: async () => state.engines + state.children > 0,
    installService: async () => { state.installs++; await pause(30); if (options.installFails) throw Error('Access is denied.'); },
    startService: async () => { state.starts++; await pause(30); state.engines++; },
    waitForService: async () => options.neverAnswers ? false : state.engines > 0,
    spawnChild: async () => { state.children++; },
    log: () => undefined,
    lockTimeoutMs: 5_000,
  });
  return { state, steps };
}

test('with a service engine already healthy, launch attaches and spawns nothing', async t => {
  const port = await readyEngine(t);
  const dir = dataDir(t);
  let installs = 0, children = 0;
  const result = await attachOrStartEngine({
    dataDir: dir,
    probe: () => engineAnswers(port),
    installService: async () => { installs++; },
    startService: async () => { installs++; },
    waitForService: async () => true,
    spawnChild: async () => { children++; },
    log: () => undefined,
  });
  assert.deepEqual(result, { mode: 'service', via: 'attached' });
  assert.equal(installs, 0);
  assert.equal(children, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'engine-mode.json'), 'utf8')).mode, 'service');
});

test('with no engine running, launch installs and starts the service once, then attaches', async t => {
  const { state, steps } = fakeServiceManager();
  const result = await attachOrStartEngine(steps(dataDir(t)));
  assert.deepEqual(result, { mode: 'service', via: 'started' });
  assert.deepEqual(state, { installs: 1, starts: 1, engines: 1, children: 0 });
});

test('two launches racing still produce exactly one engine', async t => {
  const dir = dataDir(t);
  const { state, steps } = fakeServiceManager();
  const results = await Promise.all([attachOrStartEngine(steps(dir)), attachOrStartEngine(steps(dir))]);
  assert.equal(state.engines, 1, 'one service engine');
  assert.equal(state.starts, 1, 'one start');
  assert.equal(state.children, 0, 'no child engine');
  assert.deepEqual(results.map(result => result.via).sort(), ['attached', 'started']);
  assert.equal(existsSync(join(dir, 'engine-start.lock')), false, 'the start lock is released');
});

test('two app processes launching at once still produce exactly one engine', async t => {
  const dir = dataDir(t);
  const launch = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'engine-service-launch.cjs');
  const run = () => new Promise((resolve, reject) => execFile(process.execPath, [launch, process.env.BRANCH_DESKTOP_TEST_DIST, dir], { windowsHide: true },
    (error, stdout) => error ? reject(error) : resolve(JSON.parse(stdout))));
  const results = await Promise.all([run(), run(), run()]);
  assert.equal(readdirSync(join(dir, 'engines')).length, 1, 'one service engine');
  assert.equal(readdirSync(dir).filter(name => name.startsWith('child-')).length, 0, 'no child engine');
  assert.deepEqual(results.map(result => result.mode), ['service', 'service', 'service']);
  assert.equal(results.filter(result => result.via === 'started').length, 1);
});

test('the fallback path, when the service cannot be installed, spawns exactly one child and says so once', async t => {
  const dir = dataDir(t);
  const { state, steps } = fakeServiceManager({ installFails: true });
  const result = await attachOrStartEngine(steps(dir));
  assert.equal(result.mode, 'child');
  assert.match(result.reason, /Access is denied/);
  assert.equal(state.children, 1);
  assert.equal(state.engines, 0);
  assert.equal(state.starts, 0, 'a service that failed to install is never started');
  assert.match(takeChildModeNotice(dir), /Access is denied/);
  assert.equal(takeChildModeNotice(dir), undefined, 'Settings says it once');
  // A later launch that falls back again keeps the notice said.
  recordEngineMode(dir, 'child', 'Access is denied.');
  assert.equal(takeChildModeNotice(dir), undefined);
});

test('an installed service that never answers is an error, never a second engine', async t => {
  const { state, steps } = fakeServiceManager({ neverAnswers: true });
  await assert.rejects(attachOrStartEngine(steps(dataDir(t))), /did not answer in time/);
  assert.equal(state.children, 0);
  assert.equal(state.engines, 1);
});

test('a start lock left by a launcher that exited does not block the next launch', async t => {
  const dir = dataDir(t);
  writeFileSync(join(dir, 'engine-start.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, at: Date.now() }));
  const release = await acquireEngineStartLock(dir, async () => false, 2_000);
  assert.equal(typeof release, 'function');
  release();
  assert.equal(existsSync(join(dir, 'engine-start.lock')), false);
});

test('the service steps are the engine CLI (engine/src/daemon), with the token on stdin only', () => {
  assert.deepEqual(engineServiceArgs('install', 19031), ['branch.mjs', 'gateway', 'install', '--port', '19031', '--json']);
  assert.deepEqual(engineServiceArgs('start'), ['branch.mjs', 'gateway', 'start', '--json']);
  assert.deepEqual(engineServiceArgs('token'), ['branch.mjs', 'config', 'patch', '--stdin']);
});

test('the engine crash-storm marker is shown once', t => {
  const dir = dataDir(t);
  writeFileSync(join(dir, 'gateway-restart-storm.json'), JSON.stringify({ message: 'paused; run branch doctor --fix' }));
  assert.equal(takeCrashStormNotice(dir), 'paused; run branch doctor --fix');
  assert.equal(takeCrashStormNotice(dir), undefined);
});

// #1053: a custom setup that the engine refuses the service to is said once in Settings, in plain words; the engine's
// own reason stays in desktop.log.
const ENGINE_SKIP = 'gateway install failed: Gateway install blocked: Error: service management skipped: non-default state dir or config path. Rerun with HOME set to the OS account home, BRANCH_HOME either unset or pointing at that same home, and BRANCH_STATE_DIR and BRANCH_CONFIG_PATH either unset or pointing at the canonical paths for that account home and profile to install or rewrite the gateway service.';

test('a custom data folder the engine keeps off the service runs inside the app and says so once, plainly', async t => {
  const dir = dataDir(t);
  let children = 0;
  const logged = [];
  const result = await attachOrStartEngine({
    dataDir: dir,
    probe: async () => children > 0,
    installService: async () => { throw Error(ENGINE_SKIP); },
    startService: async () => assert.fail('a refused service is never started'),
    waitForService: async () => assert.fail('a refused service is never waited on'),
    spawnChild: async () => { children++; },
    log: line => logged.push(line),
    lockTimeoutMs: 5_000,
  });
  assert.equal(result.mode, 'child');
  assert.equal(children, 1);
  assert.match(logged.join('\n'), /Rerun with HOME/, 'the log keeps the engine\'s full answer');
  const notice = takeChildModeNotice(dir);
  assert.equal(notice, "Running inside the app: this copy isn't the standard install, so the background service stays off.");
  assert.equal(service.childModeSettingsLine(notice), "Running inside the app: this copy isn't the standard install, so the background service stays off. Quitting Branch stops your Trunks.");
  assert.doesNotMatch(service.childModeSettingsLine(notice), /service management|non-default|state dir|config path|BRANCH_|Rerun/, 'Settings never shows the engine\'s reason');
  assert.equal(takeChildModeNotice(dir), undefined, 'Settings says it once');
  // A record an earlier build wrote with the engine's own words is said plainly too.
  recordEngineMode(dir, 'service');
  recordEngineMode(dir, 'child', 'service management skipped: non-default state dir or config path');
  assert.equal(takeChildModeNotice(dir), notice);
});

test('the plain service reason keeps an OS refusal as it is', () => {
  assert.equal(service.plainServiceReason('gateway install failed: Access is denied.'), 'Access is denied');
  assert.equal(service.plainServiceReason('the background service could not be installed'), 'the background service could not be installed');
  assert.equal(service.childModeSettingsLine('Access is denied'), "Branch runs inside the app on this computer because its background service couldn't be installed (Access is denied). Quitting Branch stops your Trunks.");
});

test('a relative XDG_DATA_HOME or LOCALAPPDATA never moves the data folder off its standard place', t => {
  const config = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'config.js'));
  const saved = { BRANCH_DESKTOP_DATA: process.env.BRANCH_DESKTOP_DATA, XDG_DATA_HOME: process.env.XDG_DATA_HOME, LOCALAPPDATA: process.env.LOCALAPPDATA };
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  delete process.env.BRANCH_DESKTOP_DATA;
  process.env.XDG_DATA_HOME = 'relative-share';
  process.env.LOCALAPPDATA = 'relative-local';
  const dir = config.defaultDataDirectory();
  assert.ok(isAbsolute(dir), dir);
  assert.ok(!dir.includes('relative-'), dir);
});

/** A fake reader: paths map to devices (volumes), and a symlink maps a folder to its real location. */
function volumes(devices, links = {}) {
  return {
    realpath: async path => links[path] ?? path,
    deviceOf: async path => {
      if (!(path in devices)) throw Object.assign(Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return devices[path];
    },
  };
}
const HOME = '/Users/owner';
const APP_DATA = '/Users/owner/Library/Application Support/BranchAgent';
const EXTERNAL_DATA = '/Volumes/External/BranchAgent/data';

test('macOS data on another volume is found through the symlink, and home-volume data is not', async () => {
  const reader = volumes({ [HOME]: 1, [EXTERNAL_DATA]: 7, [`${HOME}/.branch`]: 1 }, { [APP_DATA]: EXTERNAL_DATA });
  assert.equal(await serviceVolumeBlock([APP_DATA], HOME, reader, 'darwin'), EXTERNAL_VOLUME_SERVICE_LINE);
  assert.equal(await serviceVolumeBlock([`${HOME}/.branch`], HOME, reader, 'darwin'), undefined);
  assert.equal(await serviceVolumeBlock([APP_DATA, `${HOME}/.branch`], HOME, reader, 'darwin'), EXTERNAL_VOLUME_SERVICE_LINE);
});

test('the volume check never blocks other platforms, and a folder not created yet counts as home', async () => {
  const reader = volumes({ [HOME]: 1, [EXTERNAL_DATA]: 7 }, { [APP_DATA]: EXTERNAL_DATA });
  assert.equal(await serviceVolumeBlock([APP_DATA], HOME, reader, 'linux'), undefined);
  assert.equal(await serviceVolumeBlock([APP_DATA], HOME, reader, 'win32'), undefined);
  assert.equal(await serviceVolumeBlock([`${HOME}/not-yet`], HOME, reader, 'darwin'), undefined);
});

const SERVICE_ENV = '/Volumes/External/BranchAgent/data/home/.branch/service-env';
const WRAPPER = `${SERVICE_ENV}/ai.branch.gateway-env-wrapper.sh`;
const NODE_BINARY = '/Volumes/External/BranchAgent/node';
const EXECUTABLES = [SERVICE_ENV, NODE_BINARY];

test('launchd cannot run the job: the shell cannot exec the wrapper, the wrapper or node is denied, or launchd exited 126/127', () => {
  assert.equal(serviceCannotRunReason('shell-init: error retrieving current directory: getcwd: cannot access parent directories: Operation not permitted\n', EXECUTABLES), SERVICE_BLOCKED_LINE);
  assert.equal(serviceCannotRunReason(`/bin/sh: ${WRAPPER}: Operation not permitted\n`, EXECUTABLES), SERVICE_BLOCKED_LINE);
  assert.equal(serviceCannotRunReason(`${WRAPPER}: Permission denied\n`, EXECUTABLES), SERVICE_BLOCKED_LINE);
  assert.equal(serviceCannotRunReason(`${NODE_BINARY}: Permission denied\n`, EXECUTABLES), SERVICE_BLOCKED_LINE);
  assert.equal(serviceCannotRunReason('', EXECUTABLES, { state: 'not running', lastExit: 126 }), SERVICE_BLOCKED_LINE);
  assert.equal(serviceCannotRunReason('', EXECUTABLES, { state: 'not running', lastExit: 127 }), SERVICE_BLOCKED_LINE);
});

test('a stale last exit 126 is not a launch failure while the job runs with a live pid: a slow service is never removed', () => {
  assert.equal(serviceCannotRunReason('', EXECUTABLES, { state: 'running', pid: 4242, lastExit: 126 }), undefined);
  assert.equal(serviceCannotRunReason('', EXECUTABLES, { state: 'running', lastExit: 127 }), undefined, 'a pid is what proves it is running');
  assert.equal(serviceCannotRunReason('', EXECUTABLES, { state: 'not running', pid: 4242, lastExit: 126 }), undefined, 'a live pid always wins');
});

test('launchctl print gives the job state, its live pid and its last exit code', () => {
  const running = parseLaunchdJob('gui/501/ai.branch.gateway = {\n\tstate = running\n\tpid = 4242\n\tlast exit code = 126\n}\n');
  assert.deepEqual(running, { state: 'running', pid: 4242, lastExit: 126 });
  const stopped = parseLaunchdJob('gui/501/ai.branch.gateway = {\n\tstate = not running\n\tlast exit code = 127\n}\n');
  assert.deepEqual(stopped, { state: 'not running', lastExit: 127 });
  assert.deepEqual(parseLaunchdJob('Could not find service "ai.branch.gateway"'), {});
});

test('an ordinary denial from the engine, a denial of an unrelated file, or a healthy exit is not a launch failure', () => {
  // An engine plugin reading a protected folder logs the same words, and a slow service must stay an error.
  assert.equal(serviceCannotRunReason('[plugins] read blocked: /Library/Containers/example/notes.db: Operation not permitted\n', EXECUTABLES), undefined);
  assert.equal(serviceCannotRunReason('/tmp/other-tool: Permission denied\n', EXECUTABLES), undefined);
  assert.equal(serviceCannotRunReason(`/bin/sh: ${WRAPPER}: No such file or directory\n`, EXECUTABLES), undefined);
  assert.equal(serviceCannotRunReason('gateway listening on 127.0.0.1:19031\ngateway start timed out after 45s\n', EXECUTABLES), undefined);
  assert.equal(serviceCannotRunReason('', EXECUTABLES, 0), undefined);
  assert.equal(serviceCannotRunReason('', EXECUTABLES, 1), undefined);
  assert.equal(serviceCannotRunReason('', EXECUTABLES), undefined);
});

test('a slow service that logs an unrelated denial is still an error: it is never removed or replaced by a child', async t => {
  const log = '[plugins] read blocked: /Library/Containers/example/notes.db: Operation not permitted\n';
  const { calls, steps } = fakeLaunch(t, { neverAnswers: true, cannotRun: serviceCannotRunReason(log, EXECUTABLES) });
  await assert.rejects(attachOrStartEngine(steps), /did not answer in time/);
  assert.deepEqual(calls, ['mark', 'install', 'start'], 'no uninstall, no child');
});

test('a slow but healthy service with a stale failed exit is still an error: a live job is never removed', async t => {
  const healthySlow = { state: 'running', pid: 4242, lastExit: 126 };
  const { calls, steps } = fakeLaunch(t, { neverAnswers: true, cannotRun: serviceCannotRunReason('', EXECUTABLES, healthySlow) });
  await assert.rejects(attachOrStartEngine(steps), /did not answer in time/);
  assert.deepEqual(calls, ['mark', 'install', 'start'], 'no uninstall, no child');
});

test('the service logs are read only from where this start began, and a rotated log is read from its start', async t => {
  const dir = dataDir(t);
  const [stdout, stderr] = serviceLogPaths(dir);
  mkdirSync(dirname(stdout), { recursive: true });
  writeFileSync(stdout, 'old run: Operation not permitted\n');
  writeFileSync(stderr, '');
  const { serviceLogSizes } = service;
  const mark = await serviceLogSizes([stdout, stderr]);
  assert.equal(await readServiceLogsSince([stdout, stderr], mark), '');
  writeFileSync(stdout, 'old run: Operation not permitted\nnew run: all good\n');
  assert.equal(await readServiceLogsSince([stdout, stderr], mark), 'new run: all good\n');
  writeFileSync(stdout, 'rotated\n');
  assert.equal(await readServiceLogsSince([stdout, stderr], mark), 'rotated\n');
});

/**
 * A fake launch with recorded calls. `up` is what answers the gateway port. Each option is one path through the flow.
 */
function fakeLaunch(t, options = {}) {
  const calls = [];
  const up = { engine: false, child: false };
  const steps = {
    dataDir: dataDir(t),
    probe: async () => up.engine || up.child,
    ...(options.volume ? { volumeBlock: async () => options.volume } : {}),
    logMark: async () => { calls.push('mark'); return [0, 0]; },
    cannotRunReason: async () => options.cannotRun,
    installService: async () => { calls.push('install'); if (options.installFails) throw Error('Access is denied.'); },
    startService: async () => { calls.push('start'); up.engine = !options.neverAnswers; },
    waitForService: async () => !options.neverAnswers,
    ...(options.noUninstall ? {} : { uninstallService: async () => { calls.push('uninstall'); if (options.uninstallFails) throw Error('launchctl bootout failed'); } }),
    spawnChild: async () => { calls.push('child'); up.child = true; },
    log: () => undefined,
    lockTimeoutMs: 2_000,
  };
  return { calls, steps };
}

test('a data folder on another volume chooses the child up front: the service is removed first and never installed', async t => {
  const { calls, steps } = fakeLaunch(t, { volume: EXTERNAL_VOLUME_SERVICE_LINE });
  const result = await attachOrStartEngine(steps);
  assert.deepEqual(calls, ['uninstall', 'child'], 'the service is removed before the one child starts');
  assert.deepEqual(result, { mode: 'child', reason: EXTERNAL_VOLUME_SERVICE_LINE });
  // Settings says the reason once, in full, and then stays quiet.
  assert.equal(takeChildModeNotice(steps.dataDir), EXTERNAL_VOLUME_SERVICE_LINE);
  assert.equal(takeChildModeNotice(steps.dataDir), undefined);
  assert.equal(childModeSettingsLine(EXTERNAL_VOLUME_SERVICE_LINE), `${EXTERNAL_VOLUME_SERVICE_LINE} Quitting Branch stops your Trunks.`);
});

test('a service that installed but cannot run is removed, confirmed gone, and replaced by the one child engine', async t => {
  const { calls, steps } = fakeLaunch(t, { neverAnswers: true, cannotRun: SERVICE_BLOCKED_LINE });
  const result = await attachOrStartEngine(steps);
  assert.deepEqual(calls, ['mark', 'install', 'start', 'uninstall', 'child'], 'uninstall comes before the child');
  assert.equal(result.mode, 'child');
  assert.equal(takeChildModeNotice(steps.dataDir), SERVICE_BLOCKED_LINE);
});

test('a silent service with no launchd failure in its logs is still an error, never a child beside it', async t => {
  const { calls, steps } = fakeLaunch(t, { neverAnswers: true });
  await assert.rejects(attachOrStartEngine(steps), /did not answer in time/);
  assert.deepEqual(calls, ['mark', 'install', 'start'], 'nothing is removed or started on a guess');
});

test('a service that cannot be removed is never replaced by a child, for either reason', async t => {
  const cannotRun = fakeLaunch(t, { neverAnswers: true, cannotRun: SERVICE_BLOCKED_LINE, uninstallFails: true });
  await assert.rejects(attachOrStartEngine(cannotRun.steps), /launchctl bootout failed/);
  assert.deepEqual(cannotRun.calls, ['mark', 'install', 'start', 'uninstall']);
  const volume = fakeLaunch(t, { volume: EXTERNAL_VOLUME_SERVICE_LINE, uninstallFails: true });
  await assert.rejects(attachOrStartEngine(volume.steps), /launchctl bootout failed/);
  assert.deepEqual(volume.calls, ['uninstall']);
});

test('an externally supervised launch never removes or installs a service, and a cannot-run service there is an error', async t => {
  const volume = fakeLaunch(t, { volume: EXTERNAL_VOLUME_SERVICE_LINE, noUninstall: true });
  const result = await attachOrStartEngine(volume.steps);
  assert.deepEqual(volume.calls, ['child'], 'no service call at all: the supervisor owns it');
  assert.equal(result.mode, 'child');
  const cannotRun = fakeLaunch(t, { neverAnswers: true, cannotRun: SERVICE_BLOCKED_LINE, noUninstall: true });
  await assert.rejects(attachOrStartEngine(cannotRun.steps), /managed outside Branch Agent/);
  assert.deepEqual(cannotRun.calls, ['mark', 'install', 'start']);
});

test('the uninstall action runs the engine uninstall, with the JSON answer the launch reads', () => {
  assert.deepEqual(engineServiceArgs('uninstall'), ['branch.mjs', 'gateway', 'uninstall', '--json']);
});

test('the fallback detaches when Keep working is on, and Keep working off stays on today\'s spawn', () => {
  const { fallbackEngineSurvivesQuit, fallbackEngineSpawnOptions, quitLeavesFallbackEngine } = fallback;
  assert.equal(fallbackEngineSurvivesQuit(true, true), true);
  assert.equal(fallbackEngineSurvivesQuit(true, false), false, 'Keep working off');
  assert.equal(fallbackEngineSurvivesQuit(false, true), false, 'Always on off');
  for (const platform of ['win32', 'darwin', 'linux']) {
    const on = fallbackEngineSpawnOptions({ platform, surviveQuit: true, env: {}, cwd: '/engine', logFd: 7 });
    assert.equal(on.detached, true, platform);
    assert.equal(on.windowsHide, true, platform);
    assert.deepEqual(on.stdio, ['ignore', 7, 7, 'ipc'], platform);
    const off = fallbackEngineSpawnOptions({ platform, surviveQuit: false, env: {}, cwd: '/engine', logFd: undefined });
    assert.equal(off.detached, platform !== 'win32', platform);
    assert.deepEqual(off.stdio, ['ignore', 'pipe', 'pipe', 'ipc'], platform);
    assert.equal(off.windowsHide, true, platform);
  }
  assert.throws(() => fallbackEngineSpawnOptions({ platform: 'win32', surviveQuit: true, env: {}, cwd: '/engine', logFd: undefined }), /gateway log/);
  assert.equal(quitLeavesFallbackEngine(true, true, false), true, 'quit leaves the detached fallback');
  assert.equal(quitLeavesFallbackEngine(true, false, false), false, 'Keep working off still stops it');
  assert.equal(quitLeavesFallbackEngine(false, true, false), false, 'a normal child is still stopped');
  assert.equal(quitLeavesFallbackEngine(true, true, true), false, 'a handoff in flight still stops it');
});

test('Keep working on, the one-time Settings line says the fallback will not restart after sign-out or reboot', () => {
  const notice = "Running inside the app: this copy isn't the standard install, so the background service stays off.";
  const line = childModeSettingsLine(notice, true);
  assert.equal(line, `${notice} Closing Branch leaves your Trunks running. They won't restart after you sign out or reboot.`);
  assert.equal(childModeSettingsLine('Access is denied', true),
    "Branch runs inside the app on this computer because its background service couldn't be installed (Access is denied). Closing Branch leaves your Trunks running. They won't restart after you sign out or reboot.");
  assert.doesNotMatch(line, /Quitting Branch stops/);
  assert.equal(childModeSettingsLine(notice), `${notice} Quitting Branch stops your Trunks.`, 'Keep working off keeps the old line');
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function stopPid(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else {
      try { process.kill(-pid, 'SIGKILL'); } catch { process.kill(pid, 'SIGKILL'); }
    }
  } catch { /* already gone */ }
}

/** Runs the quit stand-in. It starts the engine with production startGateway, then leaves or stops it. */
function runQuitUi(dir, port, keepWorking, alwaysOn) {
  const ui = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fallback-quit-ui.cjs');
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [ui, process.env.BRANCH_DESKTOP_TEST_DIST, dir, String(port), keepWorking ? '1' : '0', alwaysOn ? '1' : '0'],
      { windowsHide: true }, (error, stdout, stderr) => {
        if (error) reject(new Error(`quit stand-in failed: ${stderr || error.message}`));
        else resolve(Number(/pid (\d+)/.exec(stdout)?.[1]));
      });
  });
}

const ENGINE_SCRIPT = `import http from "node:http";
const port = Number(process.argv[4]);
http.createServer((req, res) => {
  res.statusCode = req.url === "/readyz" ? 200 : 404;
  res.end();
}).listen(port, "127.0.0.1");
`;

test('quit leaves the detached fallback, and the next launch attaches when that pid still owns the port', async t => {
  const { writeFileSync } = await import('node:fs');
  let pid;
  // Registered before dataDir's removal, so the child is dead before the folder is removed.
  t.after(async () => {
    stopPid(pid);
    const end = Date.now() + 5_000;
    while (pid && alive(pid) && Date.now() < end) await pause(50);
  });
  const dir = dataDir(t);
  writeFileSync(join(dir, 'branch.mjs'), ENGINE_SCRIPT);
  const port = await freePort();
  pid = await runQuitUi(dir, port, true, true);
  assert.ok(Number.isInteger(pid) && pid > 0);
  await pause(500);
  assert.equal(alive(pid), true, 'quit did not kill the fallback');
  assert.equal(await engineAnswers(port), true, 'it still answers /readyz');
  const survivor = await records.findSurvivingEngine(dir, port);
  assert.equal(survivor && survivor.pid, pid, 'the next launch attaches to the recorded engine');
  assert.equal(survivor.role, 'engine');
});

async function until(check, label, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(label);
    await pause(50);
  }
}

test('a stale fallback record is ignored when the pid is gone, does not own the port, or /readyz is not 200', async t => {
  const { spawn } = await import('node:child_process');
  const standin = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fallback-engine-standin.cjs');
  const port = await freePort();
  const other = await freePort();
  const child = spawn(process.execPath, [standin, String(port), '200'], { detached: true, windowsHide: true, stdio: 'ignore' });
  const sleeper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, windowsHide: true, stdio: 'ignore' });
  const notReady = spawn(process.execPath, [standin, String(other), '503'], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref(); sleeper.unref(); notReady.unref();
  t.after(() => { stopPid(child.pid); stopPid(sleeper.pid); stopPid(notReady.pid); });
  await until(() => engineAnswers(port), 'the ready stand-in did not answer');
  await until(async () => (await fetch(`http://127.0.0.1:${other}/readyz`).then(res => res.status, () => 0)) === 503, 'the 503 stand-in did not answer');

  const { findSurvivingEngine, recordEngine } = records;
  const dir = dataDir(t);
  recordEngine(dir, child, port, 'engine', process.execPath);
  const attached = await findSurvivingEngine(dir, port);
  assert.equal(attached && attached.pid, child.pid, 'a live owner that answers 200 is kept');

  const missed = dataDir(t);
  recordEngine(missed, sleeper, port, 'engine', process.execPath);
  assert.equal(await findSurvivingEngine(missed, port), undefined, 'a pid that does not own the port is ignored');

  const refusedDir = dataDir(t);
  recordEngine(refusedDir, notReady, other, 'engine', process.execPath);
  assert.equal(alive(notReady.pid), true);
  assert.equal(await findSurvivingEngine(refusedDir, other), undefined, 'a listener whose /readyz is not 200 is ignored');

  stopPid(child.pid);
  await until(async () => !alive(child.pid), 'the stand-in did not exit');
  assert.equal(await findSurvivingEngine(dir, port), undefined, 'a dead pid is ignored');
});

test('Keep working off, and Always on off, still stop the fallback on quit', async t => {
  const { writeFileSync } = await import('node:fs');
  const stopped = async (keepWorking, alwaysOn) => {
    const dir = dataDir(t);
    writeFileSync(join(dir, 'branch.mjs'), ENGINE_SCRIPT);
    const port = await freePort();
    const pid = await runQuitUi(dir, port, keepWorking, alwaysOn);
    t.after(() => stopPid(pid));
    const end = Date.now() + 5_000;
    while (alive(pid) && Date.now() < end) await pause(50);
    assert.equal(alive(pid), false, `keepWorking ${keepWorking} alwaysOn ${alwaysOn}`);
    assert.equal(await engineAnswers(port), false);
    assert.equal(await records.findSurvivingEngine(dir, port), undefined, 'a stopped engine is not attached to');
  };
  await stopped(false, true);
  await stopped(true, false);
});

