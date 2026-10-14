// Always on (Private #454 A+B): the app attaches to the engine service and never starts a second engine.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url);
const service = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'engine-service.js'));
const { acquireEngineStartLock, attachOrStartEngine, engineAnswers, engineServiceArgs, recordEngineMode, takeChildModeNotice, takeCrashStormNotice } = service;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function dataDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'branch-always-on-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
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

// #1053: a custom setup that the engine refuses the service to is said once in Settings, in the engine's plain words.
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
  assert.equal(takeChildModeNotice(dir), 'service management skipped: non-default state dir or config path');
  assert.equal(takeChildModeNotice(dir), undefined, 'Settings says it once');
});

test('the plain service reason keeps an OS refusal as it is', () => {
  assert.equal(service.plainServiceReason('gateway install failed: Access is denied.'), 'Access is denied');
  assert.equal(service.plainServiceReason('the background service could not be installed'), 'the background service could not be installed');
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
