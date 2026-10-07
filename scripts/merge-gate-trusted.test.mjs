import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRUSTED_WORKFLOW_PATH,
  coverageFromPrFiles,
  evaluateOtherChecks,
  evaluateTrustedGate,
  findForeignTrustedChecks,
  formatGateChangeSummary,
  listCoreWorkflows,
  missingCoreWorkflows,
  nameStatusFromPrFiles,
  parsePullRequestTrigger,
  summarizeGateFileChanges,
  workflowAppliesToChanges,
} from './merge-gate-trusted.mjs';

const trustedWorkflow = { path: TRUSTED_WORKFLOW_PATH, name: 'Merge gate trusted' };
const mergeGateWorkflow = { path: '.github/workflows/merge-gate.yml', name: 'Merge gate' };
const featureBatchWorkflow = {
  path: '.github/workflows/feature-batch-checks.yml',
  name: 'Feature batch checks',
};

const passCheckRuns = [
  {
    id: 101,
    name: 'merge-gate',
    status: 'completed',
    conclusion: 'success',
    check_suite: { id: 201 },
    details_url: 'https://github.com/example/repo/actions/runs/301/job/101',
  },
  {
    id: 102,
    name: 'Named feature tests on ubuntu-latest (1/10)',
    status: 'completed',
    conclusion: 'success',
    check_suite: { id: 202 },
    details_url: 'https://github.com/example/repo/actions/runs/302/job/102',
  },
  {
    id: 103,
    name: 'merge-gate-trusted',
    status: 'in_progress',
    conclusion: null,
    check_suite: { id: 203 },
    details_url: 'https://github.com/example/repo/actions/runs/303/job/103',
  },
];

const passWorkflows = {
  101: mergeGateWorkflow,
  102: featureBatchWorkflow,
  103: trustedWorkflow,
};

const coreWorkflows = [
  { path: '.github/workflows/merge-gate.yml', pullRequestPaths: null },
  { path: '.github/workflows/feature-batch-checks.yml', pullRequestPaths: ['engine/**', 'window/**'] },
];

test('pass case: recorded check runs all succeed and core workflows are present', () => {
  const result = evaluateTrustedGate({
    checkRuns: passCheckRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: ['engine/src/gateway/contacts.ts'],
    coreWorkflows,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(result.failed.length, 0);
  assert.equal(result.foreignTrusted.length, 0);
  assert.equal(result.missingCore.length, 0);
  assert.equal(result.others.length, 2);
});

test('failed check: recorded unsuccessful conclusion fails the gate', () => {
  const checkRuns = [
    ...passCheckRuns.slice(0, 1),
    {
      id: 102,
      name: 'Named feature tests on ubuntu-latest (1/10)',
      status: 'completed',
      conclusion: 'failure',
      check_suite: { id: 202 },
      details_url: 'https://github.com/example/repo/actions/runs/302/job/102',
    },
    passCheckRuns[2],
  ];
  const snapshot = evaluateOtherChecks(checkRuns);
  assert.deepEqual(snapshot.failed.map((run) => `${run.name}: ${run.conclusion}`), [
    'Named feature tests on ubuntu-latest (1/10): failure',
  ]);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: ['engine/src/gateway/contacts.ts'],
    coreWorkflows,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Failed checks/);
});

test('duplicate-name forgery: merge-gate-trusted from another workflow fails', () => {
  const checkRuns = [
    ...passCheckRuns,
    {
      id: 104,
      name: 'merge-gate-trusted',
      status: 'completed',
      conclusion: 'success',
      check_suite: { id: 204 },
      details_url: 'https://github.com/example/repo/actions/runs/304/job/104',
    },
  ];
  const workflowsByCheckId = {
    ...passWorkflows,
    104: { path: '.github/workflows/merge-gate.yml', name: 'Merge gate' },
  };
  const foreign = findForeignTrustedChecks(checkRuns, workflowsByCheckId);
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].id, 104);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId,
    changedFiles: ['engine/src/gateway/contacts.ts'],
    coreWorkflows,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Forged or extra merge-gate-trusted/);
  assert.match(result.errors.join('\n'), /\.github\/workflows\/merge-gate\.yml/);
});

test('missing-core-workflow: absent merge-gate job fails', () => {
  const checkRuns = passCheckRuns.filter((run) => run.name !== 'merge-gate');
  const missing = missingCoreWorkflows({
    checkRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: ['README.md'],
    coreWorkflows,
  });
  assert.ok(missing.some((item) => item.includes('merge-gate (not present)')));
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: ['README.md'],
    coreWorkflows,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /merge-gate \(not present\)/);
});

test('missing-core-workflow: path-filtered workflow that should have run is required', () => {
  const checkRuns = passCheckRuns.filter((run) => run.id !== 102);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: ['engine/src/gateway/contacts.ts'],
    coreWorkflows,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /feature-batch-checks\.yml/);
});

test('parsePullRequestTrigger reads unfiltered and path-filtered pull_request workflows', () => {
  assert.deepEqual(parsePullRequestTrigger('on:\n  pull_request:\n'), { enabled: true, paths: null });
  assert.deepEqual(parsePullRequestTrigger([
    'on:',
    '  pull_request:',
    '    paths:',
    "      - 'engine/**'",
    "      - 'scripts/feature-batch-ci*'",
    '  push:',
    '    branches: [main]',
  ].join('\n')), {
    enabled: true,
    paths: ['engine/**', 'scripts/feature-batch-ci*'],
  });
  assert.deepEqual(parsePullRequestTrigger(
    "on:\n  pull_request:\n    paths: ['window/**', 'engine/**']\n",
  ), { enabled: true, paths: ['window/**', 'engine/**'] });
  assert.equal(parsePullRequestTrigger('on:\n  workflow_run:\n    workflows: [Merge gate]\n').enabled, false);
});

test('workflowAppliesToChanges uses GitHub-style path filters', () => {
  assert.equal(workflowAppliesToChanges(['engine/src/foo.ts'], ['engine/**']), true);
  assert.equal(workflowAppliesToChanges(['README.md'], ['engine/**']), false);
  assert.equal(workflowAppliesToChanges(['README.md'], null), true);
});

test('nameStatusFromPrFiles and coverageFromPrFiles treat API files as data', () => {
  const status = nameStatusFromPrFiles([
    { filename: 'engine/src/covered.test.ts', status: 'modified' },
    { filename: 'window/src/missing.test.tsx', status: 'added' },
    { filename: 'engine/src/deleted.test.ts', status: 'removed' },
  ]);
  assert.match(status, /M\tengine\/src\/covered\.test\.ts/);
  const { changed, uncovered } = coverageFromPrFiles([
    { filename: 'engine/src/covered.test.ts', status: 'modified' },
    { filename: 'window/src/missing.test.tsx', status: 'added' },
  ], '      - run: node --test scripts/none.test.mjs\n');
  assert.deepEqual(changed, ['engine/src/covered.test.ts', 'window/src/missing.test.tsx']);
  assert.ok(uncovered.includes('window/src/missing.test.tsx'));
});

test('summarizeGateFileChanges lists workflows, gate scripts, and package.json files', () => {
  const files = [
    '.github/workflows/merge-gate.yml',
    'scripts/merge-gate-trusted.mjs',
    'scripts/feature-batch-ci.mjs',
    'package.json',
    'engine/src/gateway/contacts.ts',
  ];
  assert.deepEqual(summarizeGateFileChanges(files), [
    '.github/workflows/merge-gate.yml',
    'package.json',
    'scripts/merge-gate-trusted.mjs',
  ]);
  assert.match(formatGateChangeSummary(['README.md']), /No /);
});

test('listCoreWorkflows reads main workflow path filters and skips the trusted gate', () => {
  const workflows = listCoreWorkflows(new URL('../.github/workflows', import.meta.url).pathname);
  assert.ok(workflows.some((item) => item.path === '.github/workflows/merge-gate.yml' && item.pullRequestPaths == null));
  assert.ok(workflows.some((item) =>
    item.path === '.github/workflows/feature-batch-checks.yml'
    && item.pullRequestPaths?.includes('engine/**')));
  assert.ok(workflows.some((item) =>
    item.path === '.github/workflows/visual-tour.yml'
    && item.pullRequestPaths?.includes('window/**')));
  assert.ok(!workflows.some((item) => item.path === TRUSTED_WORKFLOW_PATH));
});
