import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  GATE_SCRIPTS,
  TRUSTED_CHECKOUT_REF,
  TRUSTED_WORKFLOW_PATH,
  coverageFromPrFiles,
  evaluateOtherChecks,
  evaluateTrustedGate,
  findForeignTrustedChecks,
  parseNamedTestList,
  formatGateChangeSummary,
  listCoreWorkflows,
  missingCoreWorkflows,
  nameStatusFromPrFiles,
  parsePullRequestTrigger,
  parseTrustedWorkflowPolicy,
  summarizeGateFileChanges,
  trustedCheckoutRef,
  workflowAppliesToChanges,
} from './merge-gate-trusted.mjs';

const CURRENT_RUN_ID = 303;
const trustedWorkflow = {
  path: TRUSTED_WORKFLOW_PATH,
  name: 'Merge gate trusted',
  id: CURRENT_RUN_ID,
  event: 'pull_request_target',
};
const mergeGateWorkflow = { path: '.github/workflows/merge-gate.yml', name: 'Merge gate', id: 301, event: 'pull_request' };
const featureBatchWorkflow = {
  path: '.github/workflows/feature-batch-checks.yml',
  name: 'Feature batch checks',
  id: 302,
  event: 'pull_request',
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
    currentRunId: CURRENT_RUN_ID,
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
    currentRunId: CURRENT_RUN_ID,
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
    104: { path: '.github/workflows/merge-gate.yml', name: 'Merge gate', id: 304, event: 'pull_request' },
  };
  const foreign = findForeignTrustedChecks(checkRuns, workflowsByCheckId, {
    allowedRunId: CURRENT_RUN_ID,
  });
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].id, 104);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId,
    changedFiles: ['engine/src/gateway/contacts.ts'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
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
    currentRunId: CURRENT_RUN_ID,
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
    currentRunId: CURRENT_RUN_ID,
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

test('same-path merge-gate-trusted from another run with pull_request event fails', () => {
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
    104: {
      path: TRUSTED_WORKFLOW_PATH,
      name: 'Merge gate trusted',
      id: 304,
      event: 'pull_request',
    },
  };
  const foreign = findForeignTrustedChecks(checkRuns, workflowsByCheckId, {
    allowedRunId: CURRENT_RUN_ID,
  });
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].id, 104);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /Forged or extra merge-gate-trusted/);
  assert.match(result.errors.join('\n'), /run 304 event pull_request/);
});

test('unattributed merge-gate-trusted check fails closed', () => {
  const workflowsByCheckId = {
    101: mergeGateWorkflow,
    102: featureBatchWorkflow,
  };
  const foreign = findForeignTrustedChecks(passCheckRuns, workflowsByCheckId, {
    allowedRunId: CURRENT_RUN_ID,
  });
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].id, 103);
  const result = evaluateTrustedGate({
    checkRuns: passCheckRuns,
    workflowsByCheckId,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /unattributed/);
});

test('current run alone is accepted as the trusted check', () => {
  const checkRuns = [passCheckRuns[0], passCheckRuns[2]];
  const foreign = findForeignTrustedChecks(checkRuns, passWorkflows, {
    allowedRunId: CURRENT_RUN_ID,
  });
  assert.deepEqual(foreign, []);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, true);
  assert.equal(result.foreignTrusted.length, 0);
});

test('PR-only named list entry covers a changed test', () => {
  const files = [{ filename: 'engine/src/pr-only.test.ts', status: 'added' }];
  const workflow = '      - run: node --test scripts/none.test.mjs\n';
  const without = coverageFromPrFiles(files, workflow);
  assert.ok(without.uncovered.includes('engine/src/pr-only.test.ts'));
  const extraNamed = parseNamedTestList('engine:src/pr-only.test.ts\n# comment\n');
  assert.deepEqual(extraNamed, [{ lane: 'engine', file: 'src/pr-only.test.ts' }]);
  const withList = coverageFromPrFiles(files, workflow, extraNamed);
  assert.ok(!withList.uncovered.includes('engine/src/pr-only.test.ts'));
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

test('old-base PR still runs the trusted check from the default branch', () => {
  const yaml = readFileSync(new URL(`../${TRUSTED_WORKFLOW_PATH}`, import.meta.url), 'utf8');
  const policy = parseTrustedWorkflowPolicy(yaml);
  assert.equal(policy.checkoutRef, TRUSTED_CHECKOUT_REF);
  assert.equal(policy.checksOutDefaultBranch, true);
  assert.equal(policy.checksOutPrBaseSha, false);
  assert.equal(policy.checksOutPrHead, false);
  assert.equal(policy.persistCredentialsFalse, true);

  const oldYaml = [
    '      - name: Check out the base ref only',
    '        with:',
    '          ref: ${{ github.event.pull_request.base.sha }}',
    '          persist-credentials: false',
  ].join('\n');
  const oldPolicy = parseTrustedWorkflowPolicy(oldYaml);
  assert.equal(oldPolicy.checksOutPrBaseSha, true);
  assert.equal(oldPolicy.checksOutDefaultBranch, false);

  const oldBaseEvent = {
    repository: { default_branch: 'main' },
    pull_request: {
      base: { sha: '83a339cbaf00ef46e3dfe81499ce8eeff8c40fd9' },
      head: { sha: '9dcd18243f05dac9b2a7fd26727aa039d1afa019' },
    },
  };
  const checkout = trustedCheckoutRef(oldBaseEvent);
  assert.equal(checkout, 'main');
  assert.notEqual(checkout, oldBaseEvent.pull_request.base.sha);
  assert.notEqual(checkout, oldBaseEvent.pull_request.head.sha);

  const filesAtOldBase = new Set([
    'scripts/changed-test-coverage.mjs',
    'scripts/check-merge-command.mjs',
  ]);
  assert.equal(filesAtOldBase.has('scripts/merge-gate-trusted.test.mjs'), false);
  assert.ok(GATE_SCRIPTS.includes('scripts/merge-gate-trusted.test.mjs'));
});

test('merge-gate also queues on ready_for_review', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(yaml, /types:\s*\[.*ready_for_review.*\]/);
});

test('merge-gate recheck fires when Visual tour and Engine build complete', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate-recheck.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^\s+-\s+Visual tour\s*$/m);
  assert.match(yaml, /^\s+-\s+Engine build \(PR\)\s*$/m);
});
