// The next launch attaches only to a recorded engine that is still the same process, owns the port and answers /readyz.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url);
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const { engineSpawnOptions } = require(join(dist, 'engine-spawn.js'));
const { findSurvivingEngine, recordEngine } = require(join(dist, 'engine-records.js'));
const standin = fileURLToPath(new URL('./fixtures/engine-standin.cjs', import.meta.url));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function eventually(check, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw Error('timed out waiting for the engine record');
    await pause(200);
  }
}

test('a recorded engine that still serves its port is attached to, and stops being one when it exits', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'branch-engine-attach-'));
  const port = await freePort();
  const logFd = openSync(join(dataDir, 'gateway.log'), 'a');
  const child = spawn(process.execPath, [standin, String(port)], engineSpawnOptions({
    platform: process.platform, detachedEngine: true, env: process.env, cwd: dataDir, logFd,
  }));
  closeSync(logFd);
  child.unref();
  try {
    await eventually(() => fetch(`http://127.0.0.1:${port}/readyz`).then((r) => r.status === 200, () => false));
    recordEngine(dataDir, child, port, 'engine', process.execPath);
    const survivor = await eventually(() => findSurvivingEngine(dataDir, port));
    assert.equal(survivor.pid, child.pid);
    assert.equal(survivor.role, 'engine');
    child.kill('SIGKILL');
    await eventually(async () => (await findSurvivingEngine(dataDir, port)) === undefined, 15000);
  } finally {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    rmSync(dataDir, { recursive: true, force: true });
  }
});
