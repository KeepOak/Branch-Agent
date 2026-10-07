import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  classifyChecks,
  evaluateChecks,
  ignoredCheckNames,
  timeoutMessage,
  timeoutMinutes,
  waitLoopBudgetSeconds,
} from './merge-gate-wait.mjs';

const script = fileURLToPath(new URL('./merge-gate-wait.mjs', import.meta.url));

function run(name, status, conclusion = null) {
  return { name, status, conclusion };
}

test('comment-only jobs are denylisted so merge-gate does not wait on visual-tour comment', () => {
  assert.ok(ignoredCheckNames.includes('comment'));
  const checks = [
    run('tour', 'completed', 'success'),
    run('build', 'completed', 'success'),
    run('Named feature tests on ubuntu-latest (1/10)', 'completed', 'success'),
    run('comment', 'queued', null),
    run('merge-gate', 'in_progress', null),
    run('wait-for-checks', 'in_progress', null),
    run('changed-test-coverage', 'completed', 'success'),
  ];
  const result = evaluateChecks(checks);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.pending.map((item) => item.name), []);
  assert.equal(classifyChecks(checks).relevant.some((item) => item.name === 'comment'), false);
});

test('a failed comment job does not fail merge-gate', () => {
  const result = evaluateChecks([
    run('tour', 'completed', 'success'),
    run('comment', 'completed', 'failure'),
  ]);
  assert.equal(result.status, 'ok');
});

test('a pending required check is still waited on', () => {
  const result = evaluateChecks([
    run('tour', 'in_progress', null),
    run('comment', 'queued', null),
    run('Named feature tests on ubuntu-latest (1/10)', 'completed', 'success'),
  ]);
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.pending.map((item) => item.name), ['tour']);
});

test('a failed required check still fails merge-gate', () => {
  const result = evaluateChecks([
    run('Named feature tests on ubuntu-latest (3/10)', 'completed', 'failure'),
    run('comment', 'in_progress', null),
  ]);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failed.map((item) => item.name), [
    'Named feature tests on ubuntu-latest (3/10)',
  ]);
});

test('timeout message names the pending check and says to re-run merge-gate, not merge main', () => {
  const message = timeoutMessage([
    run('tour', 'in_progress', null),
    run('Desktop on ubuntu-latest', 'queued', null),
  ]);
  assert.match(message, /Timed out waiting for: Desktop on ubuntu-latest, tour/);
  assert.match(message, /Re-run the merge-gate workflow on this commit/);
  assert.match(message, /do not merge main just to get a fresh run/);
  assert.doesNotMatch(message, /merge origin\/main|git merge main/i);
});

test('timeout message uses remaining required checks after dropping comment-only jobs', () => {
  const result = evaluateChecks({
    check_runs: [
      run('comment', 'queued', null),
      run('tour', 'in_progress', null),
    ],
  });
  const message = timeoutMessage(result.pending);
  assert.match(message, /Timed out waiting for: tour\./);
  assert.doesNotMatch(message, /\bcomment\b/);
  assert.match(message, /Re-run the merge-gate workflow/);
});

test('wait budget fits the 60-minute job timeout so the named message can print', () => {
  assert.equal(timeoutMinutes, 60);
  assert.ok(waitLoopBudgetSeconds() < timeoutMinutes * 60);
  assert.ok(waitLoopBudgetSeconds() > 35 * 60, 'must be longer than the old 35-minute waiter');
});

test('CLI evaluate ignores comment and timeout-message names the leftover check', () => {
  const payload = JSON.stringify({
    check_runs: [
      run('comment', 'queued', null),
      run('tour', 'in_progress', null),
    ],
  });
  const waiting = spawnSync(process.execPath, [script, 'evaluate'], {
    input: payload,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(waiting.status, 3);
  assert.equal(waiting.stdout, 'waiting\n1\ntour\n');

  const timeout = spawnSync(process.execPath, [script, 'timeout-message'], {
    input: payload,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(timeout.status, 1);
  assert.match(timeout.stdout, /Timed out waiting for: tour\./);
  assert.match(timeout.stdout, /Re-run the merge-gate workflow on this commit/);
  assert.match(timeout.stdout, /do not merge main just to get a fresh run/);
});
