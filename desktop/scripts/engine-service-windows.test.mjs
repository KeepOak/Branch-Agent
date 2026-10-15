// Always on (Private #454 A), Windows only: the engine service survives the app quitting. Node and Electron share
// libuv's job object (KILL_ON_JOB_CLOSE), so a fake app here proves what the real one does. Runs on the Windows CI
// leg and on a Windows machine; skipped elsewhere. It registers one throwaway per-user task and always deletes it.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRequire } from 'node:module';

const windows = process.platform === 'win32';
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const dist = process.env.BRANCH_DESKTOP_TEST_DIST;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

function runUi(args) {
  return new Promise((resolve, reject) => {
    const ui = spawn(process.execPath, [join(fixtures, 'engine-service-ui.cjs'), ...args], { windowsHide: true, stdio: 'ignore' });
    ui.once('error', reject);
    ui.once('exit', code => resolve(code));
  });
}

function stopByPidFile(pidFile) {
  if (!existsSync(pidFile)) return;
  const pid = readFileSync(pidFile, 'utf8').trim();
  try { execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* already gone */ }
}

test('the engine started through the service outlives the app; a plain child of the app dies with it', { skip: !windows && 'Windows job objects only (run on the Windows CI leg or a Windows machine)' }, async t => {
  if (!dist) throw Error('Compile the exact desktop source before testing');
  const { engineAnswers } = createRequire(import.meta.url)(join(dist, 'engine-service.js'));
  const dir = mkdtempSync(join(tmpdir(), 'branch-job-'));
  const standin = join(fixtures, 'engine-service-standin.cjs');
  const taskName = `BranchAgentJobTest-${process.pid}-${Date.now()}`;
  const servicePort = await freePort();
  const servicePid = join(dir, 'service.pid');
  // The task starts the stand-in hidden, as the engine's own hidden task launcher does.
  const vbs = join(dir, 'launch.vbs');
  const quote = value => `""${value}""`;
  writeFileSync(vbs, `CreateObject("WScript.Shell").Run "${quote(process.execPath)} ${quote(standin)} ${servicePort} ${quote(servicePid)}", 0, False\r\n`);
  t.after(() => {
    stopByPidFile(servicePid);
    try { execFileSync('schtasks', ['/Delete', '/TN', taskName, '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* not created */ }
    rmSync(dir, { recursive: true, force: true });
  });
  execFileSync('schtasks', ['/Create', '/TN', taskName, '/SC', 'ONCE', '/ST', '23:59', '/RL', 'LIMITED', '/TR', `wscript.exe //B //Nologo "${vbs}"`, '/F'], { windowsHide: true, stdio: 'ignore' });

  assert.equal(await runUi(['service', dist, taskName, process.execPath, standin, String(servicePort), servicePid]), 0, 'the app saw the service engine answer');
  await pause(2_000);
  assert.equal(await engineAnswers(servicePort), true, 'the service engine keeps serving after the app quit');

  // Negative control: the same stand-in as the app's own plain child is killed with the app's job.
  const childPort = await freePort();
  const childPid = join(dir, 'child.pid');
  t.after(() => stopByPidFile(childPid));
  assert.equal(await runUi(['child', dist, taskName, process.execPath, standin, String(childPort), childPid]), 0, 'the child engine answered while the app ran');
  await pause(2_000);
  assert.equal(await engineAnswers(childPort), false, 'a plain child engine dies with the app (job object)');
});
