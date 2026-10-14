import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url);
const { createGatewayCrashSupervisor, createServiceEngineWatch } = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'gateway-supervisor.js'));
const { restartStoppedServiceEngine } = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'engine-service.js'));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, ms = 1000) {
  const end = Date.now() + ms;
  while (!check()) { if (Date.now() > end) throw Error('Supervisor deadline'); await pause(5); }
}
class Child extends EventEmitter {
  exitCode = null;
  signalCode = null;
  exit() { this.exitCode = 1; this.emit('exit', 1, null); }
}

test('post-ready crashes restart with a bounded exponential budget', async () => {
  let current = new Child();
  const events = [], replacements = [];
  const supervisor = createGatewayCrashSupervisor({
    current: () => current,
    log: message => events.push(message),
    onExhausted: error => events.push(error.message),
    restart: async () => { current = new Child(); replacements.push(current); supervisor.observe(current).ready(); },
    policy: { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 20, stableAfterMs: 1000 },
  });
  try {
    supervisor.observe(current).ready();
    current.exit(); await eventually(() => replacements.length === 1);
    current.exit(); await eventually(() => replacements.length === 2);
    current.exit(); await eventually(() => events.some(message => message.includes('restart attempts exhausted')));
    assert.equal(replacements.length, 2);
    assert.ok(events.some(message => message.includes('attempt 1/2 in 10ms')));
    assert.ok(events.some(message => message.includes('attempt 2/2 in 20ms')));
  } finally { supervisor.close(); }
});

test('a stable replacement resets the crash budget', async () => {
  let current = new Child();
  let restarts = 0;
  const supervisor = createGatewayCrashSupervisor({
    current: () => current,
    log: () => {},
    restart: async () => { current = new Child(); restarts++; supervisor.observe(current).ready(); },
    policy: { maxAttempts: 1, initialDelayMs: 5, maxDelayMs: 5, stableAfterMs: 20 },
  });
  try {
    supervisor.observe(current).ready();
    current.exit(); await eventually(() => restarts === 1);
    await pause(40);
    current.exit(); await eventually(() => restarts === 2);
  } finally { supervisor.close(); }
});

test('a replacement that fails before ready consumes the next retry', async () => {
  let current = new Child();
  let restarts = 0, exhausted = false;
  const supervisor = createGatewayCrashSupervisor({
    current: () => current,
    log: () => {},
    onExhausted: () => { exhausted = true; },
    restart: async () => { restarts++; throw Error('replacement never became ready'); },
    policy: { maxAttempts: 2, initialDelayMs: 5, maxDelayMs: 5 },
  });
  try {
    supervisor.observe(current).ready();
    current.exit();
    await eventually(() => exhausted);
    assert.equal(restarts, 2);
  } finally { supervisor.close(); }
});

test('expected exits are ignored, failed stops resume supervision, and shutdown cancels restarts', async () => {
  let current = new Child();
  let restarts = 0;
  const supervisor = createGatewayCrashSupervisor({
    current: () => current,
    log: () => {},
    restart: async () => { restarts++; },
    policy: { initialDelayMs: 10 },
  });
  supervisor.observe(current).ready();
  supervisor.expectExit(current);
  current.exit();
  await pause(30);
  assert.equal(restarts, 0);
  current = new Child();
  supervisor.observe(current).ready();
  const resume = supervisor.expectExit(current);
  current.exit();
  resume();
  await eventually(() => restarts === 1);
  current = new Child();
  supervisor.observe(current).ready();
  current.exit();
  supervisor.close();
  await pause(30);
  assert.equal(restarts, 1);
});

test('an owner-initiated restart cancels a pending crash restart', async () => {
  let current = new Child();
  let restarts = 0;
  const supervisor = createGatewayCrashSupervisor({
    current: () => current,
    log: () => {},
    restart: async () => { restarts++; },
    policy: { initialDelayMs: 20, maxDelayMs: 20 },
  });
  try {
    supervisor.observe(current).ready();
    current.exit();
    supervisor.cancelPending();
    current = new Child();
    supervisor.observe(current).ready();
    await pause(40);
    assert.equal(restarts, 0);
  } finally { supervisor.close(); }
});

/** A stand-in engine service: answers /readyz while up; the service manager's start brings it back. */
function fakeService({ startWorks = true } = {}) {
  const service = { up: true, starts: 0 };
  service.steps = (log, quitting = () => false, stormed = () => false) => ({
    probe: async () => service.up,
    stormed,
    quitting,
    startService: async () => { service.starts++; if (startWorks) service.up = true; },
    waitForService: async () => service.up,
    log,
  });
  return service;
}

test('a dead engine service (no /readyz answer) is restarted through the service manager, never as a second engine', async () => {
  const service = fakeService();
  const events = [];
  const log = message => events.push(message);
  const supervisor = createGatewayCrashSupervisor({
    current: () => undefined,
    log,
    restart: async () => { await restartStoppedServiceEngine(service.steps(log)); },
    policy: { maxAttempts: 3, initialDelayMs: 5, maxDelayMs: 5, stableAfterMs: 1000 },
  });
  const watch = createServiceEngineWatch({ probe: async () => service.up, paused: () => false, down: error => supervisor.down(error), up: supervisor.up, log, misses: 2 });
  try {
    await watch.tick();
    assert.equal(service.starts, 0, 'an answering service is left alone');
    service.up = false; // the engine died and its manager did not bring it back
    await watch.tick();
    assert.equal(service.starts, 0, 'one missed check is not a verdict');
    await watch.tick();
    await eventually(() => service.starts === 1);
    assert.equal(service.up, true);
    assert.ok(events.some(message => message.includes('stopped answering /readyz (2 checks in a row)')));
    assert.ok(events.some(message => message.includes('gateway restart attempt 1/3')));
    assert.ok(events.some(message => message.includes('starting it through the service manager')));
    assert.ok(events.some(message => message.includes('answering again after a restart')));
  } finally { watch.stop(); supervisor.close(); }
});

test('an engine service that will not come back uses the bounded restart budget, then reports it', async () => {
  const service = fakeService({ startWorks: false });
  service.up = false;
  let exhausted;
  const supervisor = createGatewayCrashSupervisor({
    current: () => undefined,
    log: () => {},
    onExhausted: error => { exhausted = error; },
    restart: async () => { await restartStoppedServiceEngine(service.steps(() => {})); },
    policy: { maxAttempts: 2, initialDelayMs: 5, maxDelayMs: 10 },
  });
  try {
    supervisor.down(new Error('the engine service stopped answering /readyz'));
    supervisor.down(new Error('a second report while one restart is pending is absorbed'));
    await eventually(() => exhausted);
    assert.equal(service.starts, 2);
    assert.match(exhausted.message, /did not answer in time; see gateway\.log; restart attempts exhausted \(2\)/);
  } finally { supervisor.close(); }
});

test('a crash storm the engine stopped itself for, and an engine that answers again, are not restarted', async () => {
  const service = fakeService();
  service.up = false;
  const lines = [];
  assert.equal(await restartStoppedServiceEngine(service.steps(line => lines.push(line), () => false, () => true)), 'storm');
  assert.equal(service.starts, 0);
  assert.ok(lines.some(line => line.includes('crash storm')));
  service.up = true;
  assert.equal(await restartStoppedServiceEngine(service.steps(() => {})), 'answering');
  assert.equal(service.starts, 0);
});

test('quit: nothing restarts once quit begins, whether the engine is a child or the service', async () => {
  let current = new Child();
  let restarts = 0;
  const service = fakeService();
  let quitting = false;
  const supervisor = createGatewayCrashSupervisor({
    current: () => current,
    log: () => {},
    restart: async () => { restarts++; await restartStoppedServiceEngine(service.steps(() => {}, () => quitting)); },
    policy: { initialDelayMs: 5, maxDelayMs: 5 },
  });
  const watch = createServiceEngineWatch({ probe: async () => service.up, paused: () => quitting, down: error => supervisor.down(error), log: () => {}, misses: 1 });
  supervisor.observe(current).ready();
  // The owner quits: the app marks itself quitting and closes the supervisor and the watch (before-quit).
  quitting = true;
  supervisor.close();
  watch.stop();
  assert.equal(supervisor.closed, true);
  service.up = false;
  current.exit(); // the child engine stops as part of quit
  await watch.tick();
  supervisor.down(new Error('late report during quit'));
  await pause(30);
  assert.equal(restarts, 0);
  assert.equal(service.starts, 0);
  // A restart that was already running when quit began does not start the service either.
  assert.equal(await restartStoppedServiceEngine(service.steps(() => {}, () => true)), 'quitting');
  assert.equal(service.starts, 0);
});

test('the service watch pauses while an update restarts the service on purpose', async () => {
  let downs = 0, paused = true, up = false;
  const watch = createServiceEngineWatch({ probe: async () => up, paused: () => paused, down: () => { downs++; }, log: () => {}, misses: 2 });
  await watch.tick(); await watch.tick(); await watch.tick();
  assert.equal(downs, 0, 'checks during an update never count');
  paused = false;
  await watch.tick(); await watch.tick(); await watch.tick();
  assert.equal(downs, 1, 'reported once, not on every later miss');
  up = true; await watch.tick();
  up = false; await watch.tick(); await watch.tick();
  assert.equal(downs, 2, 'an engine that answered and died again is reported again');
  watch.stop();
});
