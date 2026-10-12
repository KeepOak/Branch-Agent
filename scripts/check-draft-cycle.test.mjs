import assert from 'node:assert/strict';
import test from 'node:test';
import { checkDraftCycle, draftCycleFailures } from './check-draft-cycle.mjs';

const sha = 'a'.repeat(40);
const pr = { number: 604, state: 'open', draft: false, head: { sha } };
const events = [
  { event: 'ready_for_review', created_at: '2026-01-01T00:00:00Z' },
  { event: 'convert_to_draft', created_at: '2026-01-01T00:01:00Z' },
  { event: 'ready_for_review', created_at: '2026-01-01T00:02:00Z' },
];
const run = {
  id: 3, path: '.github/workflows/desktop-checks.yml', event: 'pull_request',
  head_sha: sha, pull_requests: [{ number: 604 }],
  created_at: '2026-01-01T00:02:01Z', status: 'completed', conclusion: 'success',
};
const success = { status: 'completed', conclusion: 'success' };
const skipped = { status: 'completed', conclusion: 'skipped' };
const evaluate = (runs, jobsByRun = { 3: [success, skipped] }, extra = {}) =>
  draftCycleFailures({ pr, sha, events, runs, jobsByRun, ...extra });

test('ready, draft, ready on one SHA cannot reuse skipped or cancelled coverage', () => {
  const cancelled = { ...run, id: 1, created_at: events[0].created_at, conclusion: 'cancelled' };
  const draft = { ...run, id: 2, created_at: events[1].created_at, conclusion: 'success' };
  assert.ok(evaluate([cancelled, draft], { 2: [skipped] }).length);
  assert.ok(evaluate([cancelled, draft, { ...run, conclusion: 'cancelled' }]).length);
  assert.ok(evaluate([cancelled, draft, run], { 3: [skipped] }).length);
  assert.ok(evaluate([cancelled, draft, { ...run, status: 'queued', conclusion: null }]).length);
  assert.deepEqual(evaluate([cancelled, draft, run]), []);
});

test('older success cannot hide a cancelled latest ready run', () => {
  assert.ok(evaluate([{ ...run, id: 2 }, { ...run, conclusion: 'cancelled' }], { 2: [success] }).length);
});

test('ready workflows may skip conditional jobs but must execute a successful job', () => {
  assert.deepEqual(evaluate([run]), []);
  for (const jobs of [[], [skipped], [success, { status: 'completed', conclusion: 'failure' }],
    [success, { status: 'in_progress', conclusion: null }]]) {
    assert.ok(evaluate([run], { 3: jobs }).length);
  }
});

test('live draft, closed, and superseded heads fail even without timeline transitions', () => {
  for (const changed of [{ draft: true }, { state: 'closed' }, { head: { sha: 'old' } }]) {
    assert.ok(evaluate([], {}, { events: [], pr: { ...pr, ...changed } }).length);
  }
  assert.deepEqual(evaluate([], {}, { events: [] }), []);
});

test('foreign PR, head, event and the gate itself cannot replace stale coverage', () => {
  const stale = { ...run, id: 1, created_at: events[0].created_at };
  for (const changed of [{ pull_requests: [{ number: 605 }] }, { head_sha: 'other' },
    { event: 'push' }, { path: '.github/workflows/merge-gate.yml' }]) {
    assert.ok(evaluate([stale, { ...run, ...changed }]).length);
  }
});

test('missing or invalid lifecycle timestamps fail closed', () => {
  assert.ok(evaluate([{ ...run, created_at: undefined }]).length);
  assert.ok(evaluate([run], {}, { events: [{ event: 'ready_for_review' }] }).length);
  assert.ok(evaluate([{ ...run, pull_requests: [] }]).length);
});

test('API guard paginates lifecycle, runs and jobs, and rejects a late-page cancelled job', () => {
  const requests = [];
  const api = (_repo, _token, resource) => {
    requests.push(resource);
    if (resource === 'pulls/604') return pr;
    if (resource.includes('/events?')) return resource.endsWith('page=1') ? [...events.slice(0, 2), ...Array(98).fill({ event: 'commented' })] : events.slice(2);
    if (resource.startsWith('actions/runs?')) return { workflow_runs: [run] };
    assert.ok(resource.startsWith('actions/runs/3/jobs?filter=latest&per_page=100&page='));
    return { jobs: resource.endsWith('page=1') ? Array(100).fill(success) : [{ status: 'completed', conclusion: 'cancelled' }] };
  };
  assert.ok(checkDraftCycle({ repo: 'example/repo', token: 'unused', prNumber: 604, sha, api }).length);
  assert.equal(requests.length, 6);
});
