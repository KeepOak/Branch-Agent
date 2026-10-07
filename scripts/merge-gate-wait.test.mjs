import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  classifyChecks,
  evaluateChecks,
  fetchCheckRunPages,
  isVisualTourWorkflow,
  mergeCheckRunPages,
  ownCheckNames,
  resolveWorkflowForCheckRun,
  shouldIgnoreCheck,
  timeoutMessage,
  timeoutMinutes,
  visualTourWorkflowName,
  visualTourWorkflowPath,
  waitLoopBudgetSeconds,
  workflowRunIdFromCheckRun,
} from './merge-gate-wait.mjs';

const script = fileURLToPath(new URL('./merge-gate-wait.mjs', import.meta.url));
const visualTour = { path: visualTourWorkflowPath, name: visualTourWorkflowName };
const otherWorkflow = { path: '.github/workflows/other.yml', name: 'Other' };

function run(name, status, conclusion = null, extra = {}) {
  return { id: extra.id ?? name, name, status, conclusion, ...extra };
}

test('visual-tour comment is skipped only when the workflow resolves to visual-tour', () => {
  const comment = run('comment', 'queued', null, {
    workflow: visualTour,
    details_url: 'https://github.com/example/repo/actions/runs/11/job/1',
  });
  assert.equal(shouldIgnoreCheck(comment, visualTour), true);
  assert.equal(isVisualTourWorkflow(visualTour), true);
  const checks = [
    run('tour', 'completed', 'success'),
    run('build', 'completed', 'success'),
    run('Named feature tests on ubuntu-latest (1/10)', 'completed', 'success'),
    comment,
    run('merge-gate', 'in_progress', null),
    run('wait-for-checks', 'in_progress', null),
    run('changed-test-coverage', 'completed', 'success'),
  ];
  const result = evaluateChecks(checks);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.pending.map((item) => item.name), []);
  assert.equal(classifyChecks(checks).relevant.some((item) => item.name === 'comment'), false);
});

test('a failed visual-tour comment job does not fail merge-gate', () => {
  const result = evaluateChecks([
    run('tour', 'completed', 'success'),
    run('comment', 'completed', 'failure', { workflow: visualTour }),
  ]);
  assert.equal(result.status, 'ok');
});

test('a comment job from a different workflow still gates when pending', () => {
  const result = evaluateChecks([
    run('tour', 'completed', 'success'),
    run('comment', 'queued', null, { workflow: otherWorkflow, id: 'other-comment' }),
  ]);
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.pending.map((item) => item.name), ['comment']);
});

test('a comment job from a different workflow still gates when it fails', () => {
  const result = evaluateChecks([
    run('tour', 'completed', 'success'),
    run('comment', 'completed', 'failure', { workflow: otherWorkflow, id: 'other-comment' }),
  ]);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failed.map((item) => item.name), ['comment']);
});

test('an unresolved comment job is not skipped (fail closed)', () => {
  const pending = evaluateChecks([
    run('tour', 'completed', 'success'),
    run('comment', 'in_progress', null, { id: 'bare-comment' }),
  ]);
  assert.equal(shouldIgnoreCheck(pending.pending[0], null), false);
  assert.equal(pending.status, 'waiting');
  assert.deepEqual(pending.pending.map((item) => item.name), ['comment']);

  const failed = evaluateChecks([
    run('tour', 'completed', 'success'),
    run('comment', 'completed', 'failure', { id: 'bare-comment-fail' }),
  ]);
  assert.equal(failed.status, 'failed');
  assert.deepEqual(failed.failed.map((item) => item.name), ['comment']);
});

test('a pending required check is still waited on', () => {
  const result = evaluateChecks([
    run('tour', 'in_progress', null),
    run('comment', 'queued', null, { workflow: visualTour }),
    run('Named feature tests on ubuntu-latest (1/10)', 'completed', 'success'),
  ]);
  assert.equal(result.status, 'waiting');
  assert.deepEqual(result.pending.map((item) => item.name), ['tour']);
});

test('a failed required check still fails merge-gate', () => {
  const result = evaluateChecks([
    run('Named feature tests on ubuntu-latest (3/10)', 'completed', 'failure'),
    run('comment', 'in_progress', null, { workflow: visualTour }),
  ]);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failed.map((item) => item.name), [
    'Named feature tests on ubuntu-latest (3/10)',
  ]);
});

test('empty relevant set after only own jobs keeps waiting', () => {
  const result = evaluateChecks(ownCheckNames.map((name) => run(name, 'completed', 'success')));
  assert.equal(result.status, 'waiting');
  assert.equal(result.relevant.length, 0);
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

test('timeout message uses remaining required checks after dropping visual-tour comment', () => {
  const result = evaluateChecks({
    check_runs: [
      run('comment', 'queued', null, { workflow: visualTour }),
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

test('pagination includes a failure on page 2 among more than 100 check runs', () => {
  const page1 = {
    total_count: 101,
    check_runs: Array.from({ length: 100 }, (_, index) =>
      run(`ok-${index}`, 'completed', 'success', { id: index + 1 })),
  };
  const page2 = {
    total_count: 101,
    check_runs: [run('Named feature tests on ubuntu-latest (9/10)', 'completed', 'failure', { id: 101 })],
  };
  const merged = mergeCheckRunPages([page1, page2]);
  assert.equal(merged.checkRuns.length, 101);
  assert.equal(merged.complete, true);
  const result = evaluateChecks([page1, page2]);
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.failed.map((item) => item.name), [
    'Named feature tests on ubuntu-latest (9/10)',
  ]);
});

test('a short first page is fail-closed when total_count is higher', () => {
  const page1 = {
    total_count: 224,
    check_runs: Array.from({ length: 100 }, (_, index) =>
      run(`ok-${index}`, 'completed', 'success', { id: index + 1 })),
  };
  const merged = mergeCheckRunPages(page1);
  assert.equal(merged.complete, false);
  assert.equal(merged.collectedCount ?? merged.checkRuns.length, 100);
  const result = evaluateChecks(page1);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.totalCount, 224);
  assert.equal(result.collectedCount, 100);
});

test('workflow run id comes from details_url; suite lookup is the fallback', () => {
  assert.equal(workflowRunIdFromCheckRun({
    details_url: 'https://github.com/example/repo/actions/runs/555/job/9',
  }), '555');
  const calls = [];
  const workflow = resolveWorkflowForCheckRun('o/r', 'token', {
    check_suite: { id: 77 },
  }, (repo, token, requestPath) => {
    calls.push(requestPath);
    return { workflow_runs: [{ path: visualTourWorkflowPath, name: visualTourWorkflowName, id: 3 }] };
  });
  assert.deepEqual(calls, ['actions/runs?check_suite_id=77&per_page=1']);
  assert.equal(isVisualTourWorkflow(workflow), true);
});

test('fetchCheckRunPages uses gh --paginate --slurp and flattens page objects', () => {
  const pages = fetchCheckRunPages('o/r', 'abc', 'token', (repo, token, requestPath, opts) => {
    assert.equal(requestPath, 'commits/abc/check-runs?per_page=100');
    assert.equal(opts.paginate, true);
    assert.equal(opts.slurp, true);
    return [
      { total_count: 2, check_runs: [run('a', 'completed', 'success')] },
      { total_count: 2, check_runs: [run('b', 'completed', 'success')] },
    ];
  });
  assert.equal(mergeCheckRunPages(pages).checkRuns.length, 2);
});

test('CLI evaluate ignores visual-tour comment and timeout-message names the leftover check', () => {
  const payload = JSON.stringify({
    check_runs: [
      run('comment', 'queued', null, { workflow: visualTour }),
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

test('CLI evaluate keeps a foreign comment pending and fails a foreign comment failure', () => {
  const pending = spawnSync(process.execPath, [script, 'evaluate'], {
    input: JSON.stringify({
      check_runs: [run('comment', 'queued', null, { workflow: otherWorkflow })],
    }),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(pending.status, 3);
  assert.match(pending.stdout, /^waiting\n1\ncomment\n/);

  const failed = spawnSync(process.execPath, [script, 'evaluate'], {
    input: JSON.stringify({
      check_runs: [run('comment', 'completed', 'failure', { workflow: otherWorkflow })],
    }),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(failed.status, 2);
  assert.match(failed.stdout, /^failed\ncomment: failure\n/);
});

test('CLI evaluate does not pass a page-2 failure among more than 100 check runs', () => {
  const pages = [
    {
      total_count: 101,
      check_runs: Array.from({ length: 100 }, (_, index) =>
        run(`ok-${index}`, 'completed', 'success', { id: index + 1 })),
    },
    {
      total_count: 101,
      check_runs: [run('shard-fail', 'completed', 'failure', { id: 101 })],
    },
  ];
  const result = spawnSync(process.execPath, [script, 'evaluate'], {
    input: JSON.stringify(pages),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^failed\nshard-fail: failure\n/);
});
