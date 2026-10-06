import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url);
const { createGatewayCrashSupervisor } = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'gateway-supervisor.js'));
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
