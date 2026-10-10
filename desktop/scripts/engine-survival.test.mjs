// Proof that the engine outlives the UI process that started it, using the production spawn options.
// On Windows the flag-off child is put in the UI's KILL_ON_JOB_CLOSE job and must die with the UI (negative control);
// the flag-on child must survive. On macOS and Linux both survive, because a detached child leaves the UI's session.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const dist = join(process.env.BRANCH_DESKTOP_TEST_DIST, 'engine-spawn.js');
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
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

function probe(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/readyz', timeout: 1000 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('error', () => resolve(false));
    request.on('timeout', () => { request.destroy(); resolve(false); });
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

/** Runs the fake UI to completion; it exits as soon as the engine stand-in answers /readyz. */
function runUi(port, detachedEngine, logPath) {
  return new Promise((resolve, reject) => {
    const ui = spawn(process.execPath, [join(fixtures, 'engine-survival-ui.cjs'), dist, join(fixtures, 'engine-standin.cjs'), String(port), detachedEngine ? '1' : '0', logPath], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    ui.stdout.on('data', (chunk) => { out += chunk; });
    ui.stderr.on('data', (chunk) => { err += chunk; });
    ui.once('error', reject);
    ui.once('exit', (code) => {
      if (code !== 0) reject(new Error(`fake UI exited ${code}: ${err}`));
      else resolve(Number(/pid (\d+)/.exec(out)?.[1]));
    });
  });
}

for (const detachedEngine of [true, false]) {
  test(`engine ${detachedEngine ? 'with' : 'without'} detachedEngine survives the UI exit exactly as the platform requires`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'branch-engine-survival-'));
    const port = await freePort();
    let pid;
    try {
      pid = await runUi(port, detachedEngine, join(dir, 'gateway.log'));
      assert.ok(Number.isInteger(pid) && pid > 0, 'the stand-in reported its pid');
      await pause(2000);
      const survived = alive(pid) && await probe(port);
      // Windows without the flag: the UI's job kills the child. Every other case: the engine keeps serving.
      const expectSurvival = detachedEngine || process.platform !== 'win32';
      assert.equal(survived, expectSurvival, `platform ${process.platform}, detachedEngine ${detachedEngine}`);
    } finally {
      if (pid !== undefined && alive(pid)) {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
