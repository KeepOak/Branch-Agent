import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import {
  RECHECK_RATE_LIMIT_BUDGET_SECONDS,
  recheckPlan,
  runGh,
  runRecheck,
  summarizeRuns,
} from './merge-gate-recheck.mjs';

const run = (workflowName, status, conclusion, id = 1, createdAt = '2026-10-10T02:00:00Z') => ({ id, workflowName, status, conclusion, createdAt });
const actions = (plan) => Object.fromEntries(plan.map((step) => [step.gate, step.action]));
const content = (conclusion = 'success') => (conclusion === 'in_progress'
  ? run('Feature batch checks', 'in_progress', null, 9)
  : run('Feature batch checks', 'completed', conclusion, 9));
const gate = (conclusion, status = 'completed', id = 50) => run('Merge gate', status, conclusion, id);
const trusted = (conclusion, status = 'completed', id = 60) => run('Merge gate trusted', status, conclusion, id);

test('a content check that did not succeed reruns nothing', () => {
  const plan = recheckPlan({ trigger: { kind: 'content', conclusion: 'failure' }, runs: [gate('cancelled'), content('failure')] });
  assert.deepEqual(actions(plan), { 'Merge gate': 'skip', 'Merge gate trusted': 'skip' });
});

test('a gate that ended unsuccessfully is rerun once every other check has passed', () => {
  const runs = [gate('cancelled'), trusted('failure'), content('success')];
  const plan = recheckPlan({ trigger: { kind: 'content', conclusion: 'success' }, runs });
  assert.equal(actions(plan)['Merge gate'], 'rerun');
  assert.equal(plan.find((step) => step.gate === 'Merge gate').id, 50);
});

test('the trusted gate reruns only after Merge gate has passed', () => {
  const runs = [gate('success', 'completed', 51), trusted('failure'), content('success')];
  const plan = recheckPlan({ trigger: { kind: 'gate', conclusion: 'success', attempt: 2, name: 'Merge gate' }, runs });
  assert.equal(actions(plan)['Merge gate trusted'], 'rerun');
  assert.equal(plan.find((step) => step.gate === 'Merge gate trusted').id, 60);
});

test('regression: the two-gate rerun sequence cannot strand the trusted gate', () => {
  // 1. Content passes; both gates failed on attempt 1. Ordinary reruns, trusted waits for it.
  const first = recheckPlan({
    trigger: { kind: 'content', conclusion: 'success' },
    runs: [gate('failure'), trusted('failure'), content('success')],
  });
  assert.equal(actions(first)['Merge gate'], 'rerun');
  assert.equal(actions(first)['Merge gate trusted'], 'wait');
  // 2. The ordinary rerun (attempt 2) passes. Its completion reruns the trusted gate, not the other way.
  const second = recheckPlan({
    trigger: { kind: 'gate', conclusion: 'success', attempt: 2, name: 'Merge gate' },
    runs: [gate('success', 'completed', 51), trusted('failure'), content('success')],
  });
  assert.equal(actions(second)['Merge gate trusted'], 'rerun');
  // 3. The trusted rerun (attempt 2) fails. It is a rerun, so it is not rerun again.
  const third = recheckPlan({
    trigger: { kind: 'gate', conclusion: 'failure', attempt: 2, name: 'Merge gate trusted' },
    runs: [gate('success', 'completed', 51), trusted('failure', 'completed', 61), content('success')],
  });
  assert.equal(actions(third)['Merge gate trusted'], 'skip');
  assert.equal(actions(third)['Merge gate'], 'skip');
});

test('a gate rerun does not stop the other gate from its own rerun', () => {
  const plan = recheckPlan({
    trigger: { kind: 'gate', conclusion: 'failure', attempt: 2, name: 'Merge gate trusted' },
    runs: [gate('failure'), trusted('failure', 'completed', 61), content('success')],
  });
  assert.equal(actions(plan)['Merge gate trusted'], 'skip');
  assert.equal(actions(plan)['Merge gate'], 'rerun');
});

test('the race: a gate still running when the last check passes is left to its own completion', () => {
  const runs = [gate('failure', 'in_progress'), content('success')];
  const plan = recheckPlan({ trigger: { kind: 'content', conclusion: 'success' }, runs });
  assert.equal(actions(plan)['Merge gate'], 'wait');
});

test('the race, other order: a gate that fails while checks are still pending waits, and the last check rechecks it', () => {
  const runs = [gate('failure'), content('in_progress')];
  const gatePlan = recheckPlan({ trigger: { kind: 'gate', conclusion: 'failure', attempt: 1, name: 'Merge gate' }, runs });
  assert.equal(actions(gatePlan)['Merge gate'], 'wait');
  const lastPlan = recheckPlan({ trigger: { kind: 'content', conclusion: 'success' }, runs: [gate('failure'), content('success')] });
  assert.equal(actions(lastPlan)['Merge gate'], 'rerun');
});

test('a gate that fails after every check passed is rerun on its own completion', () => {
  const runs = [gate('failure'), content('success')];
  assert.equal(actions(recheckPlan({ trigger: { kind: 'gate', conclusion: 'failure', attempt: 1 }, runs }))['Merge gate'], 'rerun');
});

test('a gate that is itself a rerun is never rerun again: no loop', () => {
  const runs = [gate('failure'), content('success')];
  assert.equal(actions(recheckPlan({ trigger: { kind: 'gate', conclusion: 'failure', attempt: 2 }, runs }))['Merge gate'], 'skip');
});

test('a red commit is not rerun: a failed check settles it', () => {
  const runs = [gate('failure'), content('failure')];
  assert.equal(actions(recheckPlan({ trigger: { kind: 'gate', conclusion: 'failure', attempt: 1 }, runs }))['Merge gate'], 'skip');
});

test('a gate that passed, or has no run, is skipped', () => {
  assert.equal(actions(recheckPlan({ trigger: { kind: 'content', conclusion: 'success' }, runs: [gate('success'), content('success')] }))['Merge gate'], 'skip');
  assert.equal(actions(recheckPlan({ trigger: { kind: 'content', conclusion: 'success' }, runs: [content('success')] }))['Merge gate'], 'skip');
});

test('the newest gate run is the one that decides', () => {
  const older = run('Merge gate', 'completed', 'failure', 1, '2026-10-10T01:00:00Z');
  const newer = run('Merge gate', 'completed', 'success', 2, '2026-10-10T02:00:00Z');
  assert.equal(summarizeRuns([older, newer, content('success')]).gates['Merge gate'].id, 2);
});

// The workflows that produce pull request checks, read from the files: the names a workflow_run trigger must list.
function pullRequestWorkflowNames() {
  const dir = new URL('../.github/workflows/', import.meta.url);
  const names = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.yml') || file === 'merge-gate-recheck.yml') continue;
    const text = readFileSync(new URL(file, dir), 'utf8');
    const name = /^name:\s*(.+?)\s*$/m.exec(text)?.[1].replace(/^['"]|['"]$/g, '');
    const onBlock = /^on:\s*\n((?:[ \t]+.*\n|\n)*)/m.exec(text)?.[1] ?? '';
    const inline = /^on:\s*(.*)$/m.exec(text)?.[1] ?? '';
    const triggersOnPr = /^\s{2}(pull_request|pull_request_target):/m.test(onBlock) || /pull_request/.test(inline);
    if (triggersOnPr && name) names.push(name);
  }
  return names.sort();
}

function recheckWorkflowNames() {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate-recheck.yml', import.meta.url), 'utf8');
  const list = /^\s+workflows:\n((?:\s+- .+\n)+)/m.exec(yaml)?.[1] ?? '';
  return list.split('\n').map((line) => line.replace(/^\s+- /, '').trim()).filter(Boolean).sort();
}

// GitHub rejects a workflow_run trigger with no workflows list ("workflow file issue"), and the docs do not
// promise glob patterns, so the list is explicit. This fails when a pull_request workflow is missing from it.
test('the recheck lists every pull_request workflow by name, and nothing that does not trigger on one', () => {
  const listed = recheckWorkflowNames();
  const wanted = pullRequestWorkflowNames();
  assert.ok(listed.length > 0, 'merge-gate-recheck.yml must list its workflows');
  const missing = wanted.filter((name) => !listed.includes(name));
  assert.deepEqual(missing, [], `pull_request workflows missing from the recheck trigger: ${missing.join(', ')}`);
  const extra = listed.filter((name) => !wanted.includes(name) && name !== 'CodeQL');
  assert.deepEqual(extra, [], `listed but not triggered on pull_requests: ${extra.join(', ')}`);
  assert.equal(listed.includes('Merge gate recheck'), false, 'the recheck never rechecks itself');
});

test('the recheck workflow reacts to completed runs of its listed workflows, and calls the script', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate-recheck.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^\s+workflows:\n/m);
  assert.match(yaml, /types: \[completed\]/);
  assert.match(yaml, /node scripts\/merge-gate-recheck\.mjs/);
  assert.match(yaml, /group: merge-gate-recheck-\$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
  assert.match(yaml, /cancel-in-progress: true/);
  assert.match(yaml, /timeout-minutes: 15/);
  assert.match(yaml, /MERGE_GATE_API_WAIT_SECONDS: '600'/);
  assert.match(yaml, /workflow_run\.name != 'Merge gate recheck'/);
  assert.match(yaml, /TRIGGER_KIND: content|TRIGGER_KIND: \$\{\{/);
  assert.doesNotMatch(yaml, /gh run rerun "\$id"/);
  const source = readFileSync(new URL('./merge-gate-recheck.mjs', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/merge-gate-rate-limit\.mjs'/);
  assert.match(source, /withRateLimitRetry/);
  assert.match(source, /runGh\(\['run', 'list'/);
  assert.match(source, /runGh\(\['run', 'rerun'/);
});

// Dedupe: a burst of completions must reach the listing once. Skip-only triggers never start the job (so they cannot
// cancel a settling run), and the settle sleep comes before the listing, inside the cancel-in-progress group.
test('the recheck job skips content failures before it starts and settles before it lists runs', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate-recheck.yml', import.meta.url), 'utf8');
  const condition = /^\s+if: (.+)$/m.exec(yaml.slice(yaml.indexOf('  recheck:')))?.[1] ?? '';
  assert.match(condition, /workflow_run\.conclusion == 'success'/);
  assert.match(condition, /workflow_run\.name == 'Merge gate trusted'/);
  const settle = yaml.indexOf('run: sleep 30');
  const list = yaml.indexOf('run: node scripts/merge-gate-recheck.mjs');
  assert.ok(settle > 0 && settle < list, 'the settle sleep must run before the listing script');
  assert.ok(yaml.indexOf('cancel-in-progress: true') < settle);
});

test('the recheck and the trusted gate log the core API budget once per run, before and after', () => {
  for (const file of ['merge-gate-recheck.yml', 'merge-gate-trusted.yml']) {
    const yaml = readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert.equal((yaml.match(/node scripts\/github-api-budget\.mjs before/g) ?? []).length, 1, file);
    assert.equal((yaml.match(/node scripts\/github-api-budget\.mjs after/g) ?? []).length, 1, file);
    assert.match(yaml, /if: always\(\)\n\s+env:\n(?:.*\n)*?\s+run: node scripts\/github-api-budget\.mjs after/, file);
  }
});

test('regression: a cancelled older run of a check does not count once its newer run passed', () => {
  const older = { id: 70, workflowName: 'Feature batch checks', status: 'completed', conclusion: 'cancelled', createdAt: '2026-10-10T01:00:00Z' };
  const newer = { id: 71, workflowName: 'Feature batch checks', status: 'completed', conclusion: 'success', createdAt: '2026-10-10T02:00:00Z' };
  const plan = recheckPlan({
    trigger: { kind: 'content', conclusion: 'success' },
    runs: [gate('failure'), older, newer],
  });
  assert.equal(actions(plan)['Merge gate'], 'rerun');
});

test('a newer cancelled run does not hide an older success of the same workflow', () => {
  const older = { id: 70, workflowName: 'Feature batch checks', status: 'completed', conclusion: 'success', createdAt: '2026-10-10T01:00:00Z' };
  const newer = { id: 71, workflowName: 'Feature batch checks', status: 'completed', conclusion: 'cancelled', createdAt: '2026-10-10T02:00:00Z' };
  const plan = recheckPlan({
    trigger: { kind: 'content', conclusion: 'success' },
    runs: [gate('failure'), older, newer],
  });
  assert.equal(summarizeRuns([older, newer]).contentFailed, false);
  assert.equal(actions(plan)['Merge gate'], 'rerun');
});

test('a check that is only cancelled still fails the recheck, and a real failure still fails', () => {
  const cancelled = { id: 70, workflowName: 'Feature batch checks', status: 'completed', conclusion: 'cancelled', createdAt: '2026-10-10T01:00:00Z' };
  const cancelledOnly = recheckPlan({
    trigger: { kind: 'content', conclusion: 'success' },
    runs: [gate('failure'), cancelled],
  });
  assert.equal(summarizeRuns([cancelled]).contentFailed, true);
  assert.equal(actions(cancelledOnly)['Merge gate'], 'skip');

  const failed = { id: 71, workflowName: 'Feature batch checks', status: 'completed', conclusion: 'failure', createdAt: '2026-10-10T02:00:00Z' };
  const withFailure = recheckPlan({
    trigger: { kind: 'content', conclusion: 'success' },
    runs: [gate('failure'), cancelled, failed],
  });
  assert.equal(summarizeRuns([cancelled, failed]).contentFailed, true);
  assert.equal(actions(withFailure)['Merge gate'], 'skip');
});

test('an outage listing the runs reports "Attribution lookup failed" and does not crash or rerun', () => {
  const logged = [];
  const reruns = [];
  const code = runRecheck({
    repo: 'example/repo',
    sha: 'abc123',
    trigger: { kind: 'content', conclusion: 'success' },
    list: () => { throw new Error('gh: HTTP 401 Bad credentials'); },
    rerun: (_repo, id) => reruns.push(id),
    log: (line) => logged.push(line),
    error: (line) => logged.push(line),
  });
  assert.equal(code, 1);
  assert.match(logged.join('\n'), /Attribution lookup failed/);
  assert.deepEqual(reruns, []);
});

test('runGh waits out a rate-limit 403/429 then returns, and fails other statuses immediately', () => {
  for (const message of [
    'gh: API rate limit exceeded for installation (HTTP 403)',
    'HTTP 429: You have exceeded a secondary rate limit',
  ]) {
    let calls = 0;
    const waits = [];
    const out = runGh(['run', 'list'], {}, {
      exec: () => {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error(message), { stderr: message });
        }
        return '[]';
      },
      sleep: (seconds) => waits.push(seconds),
      budget: { startedAt: null },
    });
    assert.equal(out, '[]');
    assert.equal(calls, 2);
    assert.equal(waits.length, 1);
  }

  const forbidden = Object.assign(new Error('HTTP 403 Forbidden'), {
    httpStatus: 403,
    headers: { 'x-ratelimit-remaining': '12' },
    stderr: 'HTTP 403 Forbidden',
  });
  assert.throws(() => runGh(['run', 'list'], {}, {
    exec: () => { throw forbidden; },
    sleep: () => { throw new Error('must not wait on a generic 403'); },
    budget: { startedAt: null },
  }), /HTTP 403/);
});

test('rate-limit waits share one job deadline across listing and rerun', () => {
  let clock = 1_000_000;
  const now = () => clock;
  const waits = [];
  const sleep = (seconds) => {
    waits.push(seconds);
    clock += seconds * 1000;
  };
  const budget = { startedAt: null };
  const limited = () => {
    throw Object.assign(new Error('gh: API rate limit exceeded for installation (HTTP 403)'), {
      stderr: 'gh: API rate limit exceeded for installation (HTTP 403)',
    });
  };
  const options = { exec: limited, sleep, now, budget };
  assert.throws(() => runGh(['run', 'list'], {}, options), /rate limit/);
  const afterFirst = waits.reduce((total, seconds) => total + seconds, 0);
  assert.throws(() => runGh(['run', 'rerun', '50'], {}, options), /rate limit/);
  const total = waits.reduce((sum, seconds) => sum + seconds, 0);
  assert.ok(total <= RECHECK_RATE_LIMIT_BUDGET_SECONDS, `waited ${total}s, over the ${RECHECK_RATE_LIMIT_BUDGET_SECONDS}s job budget`);
  assert.equal(total, afterFirst, 'the second call had no budget left to wait with');
});

test('the trusted gate and the aggregator are single-shot: no poll loop in either workflow', () => {
  const merge = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(merge, /for attempt in \$\(seq 1 1\); do/);
  assert.doesNotMatch(merge, /seq 1 64/);
  const trustedYaml = readFileSync(new URL('../.github/workflows/merge-gate-trusted.yml', import.meta.url), 'utf8');
  assert.match(trustedYaml, /MERGE_GATE_WAIT_SECONDS: '0'/);
});

test('regression: an in-progress recheck run is not content, so the last real check still reruns the gate', () => {
  const ownRecheck = { id: 99, workflowName: 'Merge gate recheck', status: 'in_progress', conclusion: null, createdAt: '2026-10-10T03:00:00Z' };
  const plan = recheckPlan({
    trigger: { kind: 'content', conclusion: 'success' },
    runs: [gate('failure'), ownRecheck, content('success')],
  });
  assert.equal(actions(plan)['Merge gate'], 'rerun');
});

test('the current recheck run is excluded by its id even when its name differs', () => {
  const reruns = [];
  const code = runRecheck({
    repo: 'example/repo',
    sha: 'abc123',
    trigger: { kind: 'content', conclusion: 'success' },
    currentRunId: '99',
    list: () => [gate('failure'), { id: 99, workflowName: 'Feature batch checks', status: 'in_progress', conclusion: null, createdAt: '2026-10-10T03:00:00Z' }, content('success')],
    rerun: (_repo, id) => reruns.push(id),
    log: () => {},
    error: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(reruns, [50]);
});

test('a content check that did not succeed lists nothing and reruns nothing (no API call spent)', () => {
  const listed = [];
  const reruns = [];
  const logged = [];
  const code = runRecheck({
    repo: 'o/r', sha: 'abc', trigger: { kind: 'content', conclusion: 'failure', name: 'Desktop checks' },
    currentRunId: 1, list: (...args) => { listed.push(args); return []; }, rerun: (...args) => reruns.push(args),
    log: (line) => logged.push(line), error: () => {},
  });
  assert.equal(code, 0);
  assert.equal(listed.length, 0);
  assert.equal(reruns.length, 0);
  assert.deepEqual(logged, [
    'Merge gate: skip (the triggering check did not succeed)',
    'Merge gate trusted: skip (the triggering check did not succeed)',
  ]);
});

test('a successful content check lists the runs once, then reruns only what the plan says', () => {
  let listCalls = 0;
  const reruns = [];
  const code = runRecheck({
    repo: 'o/r', sha: 'abc', trigger: { kind: 'content', conclusion: 'success', name: 'Desktop checks' },
    currentRunId: 1,
    list: () => { listCalls += 1; return [gate('cancelled'), trusted('failure'), content('success')]; },
    rerun: (repo, id) => reruns.push(id), log: () => {}, error: () => {},
  });
  assert.equal(code, 0);
  assert.equal(listCalls, 1);
  assert.deepEqual(reruns, [50]);
});
