import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateTrustedGate,
  workflowFromActionsRun,
} from './merge-gate-trusted.mjs';

// Runs whose Actions pull_requests list is empty (GitHub drops it after a rerun or a merge) still count as bound
// when they ran on this repo and this PR's head branch at this head SHA. Fixtures follow the #1907 supersede
// tests in merge-gate-trusted.test.mjs and are built through workflowFromActionsRun like the real attribution.

const REPO = 'KeepOak/Branch-Agent';
const FORK_REPO = 'someone/Branch-Agent';
const HEAD_BRANCH = 'trunk/example-gate-branch';
const SHA = 'e5de10dd00000000000000000000000000000000';
const PR_NUMBER = 2067;
const BASE_REF = 'main';
const CURRENT_RUN_ID = 9000;
const APP_ID = 15368;

const MERGE_GATE = { path: '.github/workflows/merge-gate.yml', name: 'Merge gate', job: 'merge-gate', event: 'pull_request' };
const COVERAGE = { path: '.github/workflows/changed-test-coverage.yml', name: 'Changed test coverage',
  job: 'changed-test-coverage', event: 'pull_request' };
const EMAILS = { path: '.github/workflows/commit-emails.yml', name: 'Commit emails', job: 'commit-emails',
  event: 'pull_request' };
const GATE_FILES = { path: '.github/workflows/gate-files-fresh.yml', name: 'Gate files fresh', job: 'gate-files-fresh',
  event: 'pull_request_target' };

const coreWorkflows = [{ path: '.github/workflows/merge-gate.yml', pullRequestPaths: null }];
const analyzeCheck = { id: 1, name: 'Analyze (actions)', status: 'completed', conclusion: 'success' };

// One Actions workflow run with one job: the check run plus the Actions run payload that attributes it.
function actionsJob(workflow, { runId, suite, conclusion, headRepo = REPO, headBranch = HEAD_BRANCH }) {
  const checkId = runId * 10;
  const checkRun = {
    id: checkId,
    app: { id: APP_ID },
    name: workflow.job,
    status: 'completed',
    conclusion,
    check_suite: { id: suite },
    details_url: `https://github.com/${REPO}/actions/runs/${runId}/job/${checkId}`,
  };
  const actionsRun = {
    path: workflow.path,
    name: workflow.name,
    id: runId,
    event: workflow.event,
    check_suite_id: suite,
    head_sha: SHA,
    head_branch: headBranch,
    head_repository: headRepo == null ? null : { full_name: headRepo },
    pull_requests: [],
  };
  return { checkRun, workflow: workflowFromActionsRun(actionsRun) };
}

// #2067 at e5de10dd: 11 runs, all with an empty pull_requests list. Older suites failed; the newest suite of
// each identity fully succeeded. merge-gate 4 runs, changed-test-coverage 3, commit-emails 3, gate-files-fresh 1.
function replay2067() {
  return [
    actionsJob(MERGE_GATE, { runId: 101, suite: 1101, conclusion: 'failure' }),
    actionsJob(MERGE_GATE, { runId: 102, suite: 1102, conclusion: 'timed_out' }),
    actionsJob(MERGE_GATE, { runId: 103, suite: 1103, conclusion: 'failure' }),
    actionsJob(MERGE_GATE, { runId: 104, suite: 1104, conclusion: 'success' }),
    actionsJob(COVERAGE, { runId: 201, suite: 1201, conclusion: 'failure' }),
    actionsJob(COVERAGE, { runId: 202, suite: 1202, conclusion: 'failure' }),
    actionsJob(COVERAGE, { runId: 203, suite: 1203, conclusion: 'success' }),
    actionsJob(EMAILS, { runId: 301, suite: 1301, conclusion: 'failure' }),
    actionsJob(EMAILS, { runId: 302, suite: 1302, conclusion: 'failure' }),
    actionsJob(EMAILS, { runId: 303, suite: 1303, conclusion: 'success' }),
    actionsJob(GATE_FILES, { runId: 401, suite: 1401, conclusion: 'success' }),
  ];
}

function withGateEnv(fn) {
  const saved = { REPO: process.env.REPO, HEAD_BRANCH: process.env.HEAD_BRANCH };
  process.env.REPO = REPO;
  process.env.HEAD_BRANCH = HEAD_BRANCH;
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function evaluate(jobs) {
  const checkRuns = [...jobs.map((job) => job.checkRun), analyzeCheck];
  const workflowsByCheckId = Object.fromEntries(jobs.map((job) => [job.checkRun.id, job.workflow]));
  return withGateEnv(() => evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    sha: SHA,
    prNumber: PR_NUMBER,
    baseRef: BASE_REF,
  }));
}

function ids(runs) {
  return runs.map((run) => run.id).sort((a, b) => a - b);
}

test('regression: #2067 replay with empty pull_requests passes once the newest suites are green', () => {
  const jobs = replay2067();
  assert.equal(jobs.every((job) => job.workflow.pullRequests.length === 0), true);
  for (const order of [jobs, [...jobs].reverse()]) {
    const result = evaluate(order);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.missingCore, []);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ready, true);
    assert.equal(result.ok, true);
    assert.deepEqual(ids(result.others), [1, 1040, 2030, 3030, 4010]);
  }
  // Attribution keeps the head repo and branch the rule compares.
  assert.equal(jobs.every((job) => job.workflow.headRepo === REPO && job.workflow.headBranch === HEAD_BRANCH), true);
});

// GitHub models this rerun as a newer workflow run in a newer check suite of the same identity, the same shape
// as the #1907 supersede tests.
test('regression: a timed-out run then a green rerun with empty pull_requests counts as green', () => {
  const jobs = [
    actionsJob(MERGE_GATE, { runId: 501, suite: 1501, conclusion: 'timed_out' }),
    actionsJob(MERGE_GATE, { runId: 502, suite: 1502, conclusion: 'success' }),
  ];
  for (const order of [jobs, [...jobs].reverse()]) {
    const result = evaluate(order);
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.missingCore, []);
    assert.equal(result.ok, true);
    assert.deepEqual(ids(result.others), [1, 5020]);
  }
});

test('regression: #2067 replay still fails when the newest suite of one identity is red', () => {
  const jobs = replay2067().map((job) => (job.checkRun.id === 3030
    ? { ...job, checkRun: { ...job.checkRun, conclusion: 'failure' } }
    : job));
  for (const order of [jobs, [...jobs].reverse()]) {
    const result = evaluate(order);
    assert.equal(result.ok, false);
    // Superseded failures of the green identities are gone; every commit-emails suite stays, so it fails.
    assert.deepEqual(ids(result.failed), [3010, 3020, 3030]);
    assert.match(result.errors.join('\n'), /commit-emails: failure/);
  }
});

test('regression: a green run from a fork on the same branch name does not supersede an older failure', () => {
  const jobs = replay2067().filter((job) => job.checkRun.id !== 2030);
  jobs.push(actionsJob(COVERAGE, { runId: 204, suite: 1204, conclusion: 'success', headRepo: FORK_REPO }));
  for (const order of [jobs, [...jobs].reverse()]) {
    const result = evaluate(order);
    assert.equal(result.ok, false);
    assert.deepEqual(ids(result.failed), [2010, 2020]);
    assert.match(result.errors.join('\n'), /changed-test-coverage: failure/);
  }
  // Same branch name and SHA; only the head repository differs.
  assert.equal(jobs.at(-1).workflow.headBranch, HEAD_BRANCH);
  assert.equal(jobs.at(-1).workflow.headRepo, FORK_REPO);
});
