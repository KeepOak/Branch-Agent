import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { recheckPlan } from './merge-gate-recheck.mjs';

const byWorkflow = (plan) => Object.fromEntries(plan.map((step) => [step.workflow, step.action]));

test('a content check that did not succeed reruns nothing', () => {
  const plan = recheckPlan({ triggerConclusion: 'failure', runs: [{ workflow: 'merge-gate.yml', id: 1, status: 'completed', conclusion: 'cancelled' }] });
  assert.deepEqual(byWorkflow(plan), { 'merge-gate.yml': 'skip', 'merge-gate-trusted.yml': 'skip' });
});

test('a trusted gate that failed early is rerun after a content success, the case the old recheck missed', () => {
  const runs = [
    { workflow: 'merge-gate.yml', id: 10, status: 'completed', conclusion: 'success' },
    { workflow: 'merge-gate-trusted.yml', id: 20, status: 'completed', conclusion: 'failure' },
  ];
  const plan = recheckPlan({ triggerConclusion: 'success', runs });
  assert.equal(byWorkflow(plan)['merge-gate-trusted.yml'], 'rerun');
  assert.equal(plan.find((s) => s.workflow === 'merge-gate-trusted.yml').id, 20);
  assert.equal(byWorkflow(plan)['merge-gate.yml'], 'skip');
});

test('a gate still running is left alone, because it will see the result itself', () => {
  const runs = [{ workflow: 'merge-gate-trusted.yml', id: 21, status: 'in_progress', conclusion: null }];
  const plan = recheckPlan({ triggerConclusion: 'success', runs });
  assert.equal(byWorkflow(plan)['merge-gate-trusted.yml'], 'wait');
});

test('a merge gate that ended cancelled is rerun, and a missing run is skipped', () => {
  const runs = [{ workflow: 'merge-gate.yml', id: 11, status: 'completed', conclusion: 'cancelled' }];
  const plan = recheckPlan({ triggerConclusion: 'success', runs });
  assert.equal(byWorkflow(plan)['merge-gate.yml'], 'rerun');
  assert.equal(byWorkflow(plan)['merge-gate-trusted.yml'], 'skip');
});

test('gates that already passed are not rerun', () => {
  const runs = [
    { workflow: 'merge-gate.yml', id: 12, status: 'completed', conclusion: 'success' },
    { workflow: 'merge-gate-trusted.yml', id: 22, status: 'completed', conclusion: 'success' },
  ];
  assert.deepEqual(byWorkflow(recheckPlan({ triggerConclusion: 'success', runs })), { 'merge-gate.yml': 'skip', 'merge-gate-trusted.yml': 'skip' });
});

test('the recheck workflow calls the tested script and no longer reruns merge-gate in bash', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate-recheck.yml', import.meta.url), 'utf8');
  assert.match(yaml, /node scripts\/merge-gate-recheck\.mjs/);
  assert.doesNotMatch(yaml, /gh run rerun "\$id"/);
  assert.match(yaml, /TRIGGER_CONCLUSION/);
});

test('the trusted gate fails fast on its own wait, and the recheck picks it up when content finishes', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate-trusted.yml', import.meta.url), 'utf8');
  const wait = /MERGE_GATE_WAIT_SECONDS: '(\d+)'/.exec(yaml.slice(yaml.indexOf('Wait for checks')));
  assert.ok(wait && Number(wait[1]) <= 720, 'the trusted wait is at most 12 minutes');
});
