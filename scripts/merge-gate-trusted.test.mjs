import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  GATE_SCRIPTS,
  HANDOFF_WORKFLOW_PATH,
  TRUSTED_CHECKOUT_REF,
  TRUSTED_WORKFLOW_PATH,
  coverageFromPrFiles,
  evaluateOtherChecks,
  evaluateTrustedGate,
  findForeignTrustedChecks,
  isPassingHandoffE2e,
  parseNamedTestList,
  formatGateChangeSummary,
  listCoreWorkflows,
  missingCoreWorkflows,
  nameStatusFromPrFiles,
  parsePullRequestTrigger,
  parseTrustedWorkflowPolicy,
  resolveWorkflowsForCheckRuns,
  summarizeGateFileChanges,
  trustedCheckoutRef,
  workflowAppliesToChanges,
  workflowFromActionsRun,
} from './merge-gate-trusted.mjs';

const CURRENT_RUN_ID = 303;
const SHA = 'abc123';
const PR_NUMBER = 627;
const BASE_REF = 'main';
const prContext = { sha: SHA, prNumber: PR_NUMBER, baseRef: BASE_REF };
const trustedWorkflow = {
  path: TRUSTED_WORKFLOW_PATH,
  name: 'Merge gate trusted',
  id: CURRENT_RUN_ID,
  event: 'pull_request_target',
  checkSuiteId: 203,
};
const mergeGateWorkflow = { path: '.github/workflows/merge-gate.yml', name: 'Merge gate', id: 301, event: 'pull_request' };
const earlierTrustedWorkflow = {
  ...trustedWorkflow,
  id: 304,
  checkSuiteId: 204,
  headSha: SHA,
  pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
};
const featureBatchWorkflow = {
  path: '.github/workflows/feature-batch-checks.yml',
  name: 'Feature batch checks',
  id: 302,
  event: 'pull_request',
};

const passCheckRuns = [
  {
    id: 101,
    app: { id: 15368 },
    name: 'merge-gate',
    status: 'completed',
    conclusion: 'success',
    check_suite: { id: 201 },
    details_url: 'https://github.com/example/repo/actions/runs/301/job/101',
  },
  {
    id: 102,
    app: { id: 15368 },
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

// API-recorded pair on PR #492, SHA 3093a8dd6ebf421c9cfddb34e35ba44d6ae22aea.
const realBuildPair = [
  { id: 112992933987, name: 'build', status: 'completed', conclusion: 'failure',
    app: { id: 15368 }, check_suite: { id: 102080051817 },
    details_url: 'https://github.com/KeepOak/Branch-Agent/actions/runs/37679904411/job/112992933987' },
  { id: 113023525061, name: 'build', status: 'completed', conclusion: 'success',
    app: { id: 15368 }, check_suite: { id: 102080051207 },
    details_url: 'https://github.com/KeepOak/Branch-Agent/actions/runs/37679904183/job/113023525061' },
];
const realBuildWorkflows = {
  112992933987: { path: '.github/workflows/visual-tour.yml', id: 37679904411 },
  113023525061: { path: '.github/workflows/engine-build-pr.yml', id: 37679904183 },
};

test('regression: real 3093a8dd build pair fails the trusted gate in both orders', () => {
  for (const pair of [realBuildPair, [...realBuildPair].reverse()]) {
    const result = evaluateTrustedGate({
      checkRuns: [passCheckRuns[0], ...pair],
      workflowsByCheckId: { ...passWorkflows, ...realBuildWorkflows },
      changedFiles: ['README.md'], coreWorkflows, currentRunId: CURRENT_RUN_ID,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.failed.map((check) => check.id), [112992933987]);
  }
});

test('regression: real 3093a8dd build pair fails the actual ordinary jq filter', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  const filter = yaml.match(/--jq '([^']+)'/)[1];
  const failedFilter = yaml.match(/failed=\$\(jq -r '([^']+)'/)[1];
  for (const pair of [realBuildPair, [...realBuildPair].reverse()]) {
    const runs = execFileSync('jq', [filter], {
      input: JSON.stringify({ check_runs: pair }), encoding: 'utf8', windowsHide: true,
    });
    const failed = execFileSync('jq', ['-r', failedFilter], {
      input: runs, encoding: 'utf8', windowsHide: true,
    });
    const result = { ok: failed.trim().length === 0 };
    assert.equal(result.ok, false);
    assert.equal(failed.trim(), 'build: failure');
  }
});

test('regression: newer forged merge-gate success cannot hide a genuine failure', () => {
  const genuine = { ...passCheckRuns[0], app: { id: 15368 }, conclusion: 'failure' };
  const forged = { ...genuine, id: 160, app: { id: 999 },
    conclusion: 'success', check_suite: { id: 999 }, details_url: genuine.details_url };
  for (const attribution of [{}, { 160: mergeGateWorkflow },
    { 160: { ...mergeGateWorkflow, path: '.github/workflows/foreign.yml' } }]) {
    const result = evaluateTrustedGate({
      checkRuns: [genuine, forged], workflowsByCheckId: { 101: mergeGateWorkflow, ...attribution },
      changedFiles: ['README.md'], coreWorkflows, currentRunId: CURRENT_RUN_ID,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.failed.map((check) => check.id), [101]);
  }
});

test('regression: current-run URL spoof must match the API current check suite', () => {
  const forged = { ...passCheckRuns[2], id: 160, check_suite: { id: 999 } };
  const checks = [passCheckRuns[0], passCheckRuns[2], forged];
  const workflowsByCheckId = resolveWorkflowsForCheckRuns('example/repo', 'unused', checks, {
    currentRunId: CURRENT_RUN_ID,
    resolveWorkflow: (_repo, _token, check) => check.id === 101
      ? mergeGateWorkflow : { ...trustedWorkflow, checkSuiteId: 203 },
  });
  const result = evaluateTrustedGate({
    checkRuns: checks, workflowsByCheckId, changedFiles: ['README.md'],
    coreWorkflows, currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.foreignTrusted.map((check) => check.id), [160]);
});

test('unidentified checks never collapse even with the same name and newer success', () => {
  const failed = { ...passCheckRuns[0], conclusion: 'failure' };
  const success = { ...failed, id: 160, conclusion: 'success' };
  for (const [checks, workflows] of [
    [[failed, success], {}],
    [[{ ...failed, app: undefined }, { ...success, app: undefined }],
      { 101: mergeGateWorkflow, 160: mergeGateWorkflow }],
  ]) {
    const result = evaluateTrustedGate({
      checkRuns: checks, workflowsByCheckId: workflows, changedFiles: ['README.md'], coreWorkflows,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.others.map((check) => check.id), [101, 160]);
    assert.ok(result.missingCore.some((item) => item.includes('merge-gate (status: completed, conclusion: failure)')));
  }
});

test('current trusted run fails closed for missing suite or incomplete API identity', () => {
  for (const workflow of [
    { ...trustedWorkflow, checkSuiteId: null },
    { ...trustedWorkflow, id: null },
    { ...trustedWorkflow, path: null },
    { ...trustedWorkflow, event: null },
  ]) {
    assert.deepEqual(findForeignTrustedChecks([passCheckRuns[2]], { 103: workflow }, {
      allowedRunId: CURRENT_RUN_ID,
    }).map((check) => check.id), [103]);
  }
  assert.equal(findForeignTrustedChecks([{ ...passCheckRuns[2], check_suite: undefined }], passWorkflows, {
    allowedRunId: CURRENT_RUN_ID,
  }).length, 1);
});

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
    104: { path: '.github/workflows/merge-gate.yml', name: 'Merge gate', id: 304, event: 'pull_request_target' },
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
  const checkRuns = [
    passCheckRuns[0],
    passCheckRuns[1],
    {
      ...passCheckRuns[2],
      details_url: 'https://github.com/example/repo/actions/runs/999/job/103',
    },
  ];
  const workflowsByCheckId = {
    101: mergeGateWorkflow,
    102: featureBatchWorkflow,
  };
  const foreign = findForeignTrustedChecks(checkRuns, workflowsByCheckId, {
    allowedRunId: CURRENT_RUN_ID,
  });
  assert.equal(foreign.length, 1);
  assert.equal(foreign[0].id, 103);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /unattributed/);
});

test('rate-limited current trusted check fails closed without API suite attribution', () => {
  const workflowsByCheckId = {
    101: mergeGateWorkflow,
  };
  const checkRuns = [passCheckRuns[0], passCheckRuns[2]];
  const foreign = findForeignTrustedChecks(checkRuns, workflowsByCheckId, {
    allowedRunId: CURRENT_RUN_ID,
  });
  assert.deepEqual(foreign.map((check) => check.id), [103]);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.foreignTrusted.length, 1);
  assert.equal(result.missingCore.length, 0);
});

test('merge-gate.yml path attribution is satisfied by the merge-gate job', () => {
  const missing = missingCoreWorkflows({
    checkRuns: [passCheckRuns[0]],
    workflowsByCheckId: {},
    changedFiles: ['README.md'],
    coreWorkflows,
  });
  assert.ok(!missing.some((item) => item.includes('merge-gate.yml')));
  assert.ok(!missing.some((item) => item.includes('merge-gate (not present)')));
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

test('two genuine trusted runs on the same SHA pass even when the earlier run was cancelled', () => {
  const earlier = {
    ...passCheckRuns[2],
    id: 104,
    status: 'completed',
    conclusion: 'cancelled',
    check_suite: { id: 204 },
    details_url: 'https://github.com/example/repo/actions/runs/304/job/104',
  };
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, earlier],
    workflowsByCheckId: { ...passWorkflows, 104: earlierTrustedWorkflow },
    ...prContext,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.foreignTrusted, []);
});

for (const [reason, checkPatch, workflowPatch] of [
  ['mismatched suite', { check_suite: { id: 999 } }, {}],
  ['missing PR', {}, { pullRequests: [{ number: 628, base: BASE_REF }] }],
  ['non-main base', {}, { pullRequests: [
    { number: PR_NUMBER, base: BASE_REF },
    { number: 628, base: 'old-base' },
  ] }],
  ['wrong head SHA', {}, { headSha: 'other-sha' }],
]) {
  test(`earlier trusted run rejects ${reason}`, () => {
    const earlier = {
      ...passCheckRuns[2],
      id: 104,
      check_suite: { id: 204 },
      details_url: 'https://github.com/example/repo/actions/runs/304/job/104',
      ...checkPatch,
    };
    const result = evaluateTrustedGate({
      checkRuns: [...passCheckRuns, earlier],
      workflowsByCheckId: { ...passWorkflows, 104: { ...earlierTrustedWorkflow, ...workflowPatch } },
      changedFiles: ['README.md'],
      coreWorkflows,
      currentRunId: CURRENT_RUN_ID,
      ...prContext,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.foreignTrusted.map((check) => check.id), [104]);
  });
}

test('reopened same SHA keeps newest check per App workflow and name over old cancelled checks', () => {
  const oldGate = { ...passCheckRuns[0], id: 90, conclusion: 'cancelled' };
  const oldFeature = { ...passCheckRuns[1], id: 91, conclusion: 'cancelled' };
  for (const checkRuns of [
    [oldGate, oldFeature, ...passCheckRuns],
    [...passCheckRuns, oldFeature, oldGate],
  ]) {
    const result = evaluateTrustedGate({
      checkRuns,
      workflowsByCheckId: { ...passWorkflows, 90: mergeGateWorkflow, 91: featureBatchWorkflow },
      changedFiles: ['engine/src/gateway/contacts.ts'],
      coreWorkflows,
      currentRunId: CURRENT_RUN_ID,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.others.map((check) => check.id).sort(), [101, 102]);
  }
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, { ...passCheckRuns[0], id: 110, conclusion: 'cancelled' }],
    workflowsByCheckId: { ...passWorkflows, 110: mergeGateWorkflow },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed[0].id, 110);
  const pending = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, { ...passCheckRuns[0], id: 110, status: 'queued', conclusion: null }],
    workflowsByCheckId: { ...passWorkflows, 110: mergeGateWorkflow },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(pending.ready, false);
  assert.equal(pending.pending[0].id, 110);
});

test('older forged trusted checks cannot be hidden by name deduplication', () => {
  const forged = { ...passCheckRuns[2], id: 90, details_url: 'https://github.com/example/repo/actions/runs/304/job/90' };
  const result = evaluateTrustedGate({
    checkRuns: [forged, ...passCheckRuns],
    workflowsByCheckId: { ...passWorkflows, 90: earlierTrustedWorkflow },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(result.ok, false);
  assert.equal(result.foreignTrusted[0].id, 90);
});

test('ordinary merge gate jq preserves all checks and its polling budget', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  const filter = yaml.match(/--jq '([^']+)'/)[1];
  const feature = passCheckRuns[1];
  for (const latest of [
    feature,
    { ...feature, id: 110, status: 'queued', conclusion: null },
    { ...feature, id: 110, status: 'completed', conclusion: 'failure' },
  ]) {
    const checks = [...passCheckRuns, latest, { ...feature, id: 90, conclusion: 'cancelled' }];
    const actual = JSON.parse(execFileSync('jq', [filter], {
      input: JSON.stringify({ check_runs: checks }), encoding: 'utf8', windowsHide: true,
    }));
    assert.deepEqual(actual, [feature, latest, { ...feature, id: 90, conclusion: 'cancelled' }]);
  }
  assert.match(yaml, /seq 1 64/);
  assert.match(yaml, /if \[ "\$attempt" -lt 64 \]; then sleep 30; fi/);
  assert.doesNotMatch(yaml, /sleep 10/);
});

test('Actions run attribution retains suite, head SHA and PR base refs', () => {
  assert.deepEqual(workflowFromActionsRun({
    path: TRUSTED_WORKFLOW_PATH,
    name: 'Merge gate trusted',
    id: 304,
    event: 'pull_request_target',
    check_suite_id: 204,
    head_sha: SHA,
    pull_requests: [{ number: PR_NUMBER, base: { ref: BASE_REF, sha: 'base-sha' } }],
  }), earlierTrustedWorkflow);
});

test('successful workflow attribution is cached across polls while new checks are resolved', () => {
  const attributionCache = new Map();
  const calls = [];
  const checks = [{ id: 501, name: 'feature', status: 'in_progress' }];
  const options = {
    currentRunId: CURRENT_RUN_ID,
    attributionCache,
    resolveWorkflow: (_repo, _token, check) => {
      calls.push(check.id);
      return featureBatchWorkflow;
    },
  };
  const first = resolveWorkflowsForCheckRuns('example/repo', 'unused', checks, options);
  const nextChecks = [
    { ...checks[0], status: 'completed', conclusion: 'failure' },
    { id: 502, name: 'new check' },
  ];
  const second = resolveWorkflowsForCheckRuns('example/repo', 'unused', nextChecks, options);
  assert.deepEqual(first, { 501: featureBatchWorkflow });
  assert.deepEqual(second, { 501: featureBatchWorkflow, 502: featureBatchWorkflow });
  assert.deepEqual(calls, [501, 502]);
  const result = evaluateTrustedGate({
    checkRuns: [passCheckRuns[0], nextChecks[0]],
    workflowsByCheckId: second,
    changedFiles: ['engine/src/gateway/contacts.ts'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed[0].id, 501);
  assert.deepEqual(result.missingCore, []);
});

test('failed or missing workflow lookups are retried instead of cached as unattributed', () => {
  for (const unavailable of [null, new Error('API rate limit exceeded for installation')]) {
    let calls = 0;
    const checks = [{ id: 501, name: 'merge-gate-trusted', check_suite: { id: 204 } }];
    const options = {
      currentRunId: CURRENT_RUN_ID,
      attributionCache: new Map(),
      resolveWorkflow: () => {
        calls += 1;
        if (calls === 1) {
          if (unavailable instanceof Error) throw unavailable;
          return unavailable;
        }
        return earlierTrustedWorkflow;
      },
    };
    const first = resolveWorkflowsForCheckRuns('example/repo', 'unused', checks, options);
    assert.equal(findForeignTrustedChecks(checks, first, { allowedRunId: CURRENT_RUN_ID }).length, 1);
    const second = resolveWorkflowsForCheckRuns('example/repo', 'unused', checks, options);
    assert.deepEqual(second, { 501: earlierTrustedWorkflow });
    assert.equal(findForeignTrustedChecks(checks, second, { allowedRunId: CURRENT_RUN_ID, ...prContext }).length, 0);
    assert.equal(calls, 2);
  }
});

test('current trusted run requires API suite attribution and caches it across polls', () => {
  let calls = 0;
  const options = {
    attributionCache: new Map(),
    resolveWorkflow: () => { calls += 1; return trustedWorkflow; },
  };
  const result = resolveWorkflowsForCheckRuns('example/repo', 'unused', [passCheckRuns[2]], {
    currentRunId: CURRENT_RUN_ID,
    ...options,
  });
  assert.deepEqual(result[103], trustedWorkflow);
  assert.deepEqual(resolveWorkflowsForCheckRuns('example/repo', 'unused', [passCheckRuns[2]], options), result);
  assert.equal(calls, 1);
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
  const workflows = listCoreWorkflows(fileURLToPath(new URL('../.github/workflows', import.meta.url)));
  assert.ok(workflows.some((item) => item.path === '.github/workflows/merge-gate.yml' && item.pullRequestPaths == null));
  assert.ok(workflows.some((item) =>
    item.path === '.github/workflows/feature-batch-checks.yml'
    && item.pullRequestPaths?.includes('engine/**')));
  assert.ok(workflows.some((item) =>
    item.path === '.github/workflows/visual-tour.yml'
    && item.pullRequestPaths?.includes('window/**')));
  assert.ok(workflows.some((item) =>
    item.path === HANDOFF_WORKFLOW_PATH
    && item.pullRequestPaths?.includes('engine/test/gateway-desktop-handoff.e2e.test.ts')
    && item.pullRequestPaths?.includes('desktop/src/main.ts')));
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

test('merge-gate does not retrigger on ready_for_review and cancel its waiting run', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^  pull_request:\s*$/m);
  assert.doesNotMatch(yaml, /^\s+types:.*ready_for_review/m);
});

test('merge-gate wait ignores merge-gate-trusted so the two gates cannot deadlock', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(yaml, /select\(\.name != "merge-gate" and \.name != "merge-gate-trusted"\)/);
});

const handoffPullRequestPaths = listCoreWorkflows(fileURLToPath(new URL('../.github/workflows', import.meta.url)))
  .find((item) => item.path === HANDOFF_WORKFLOW_PATH)?.pullRequestPaths;
if (!handoffPullRequestPaths?.length) {
  throw new Error(`${HANDOFF_WORKFLOW_PATH} must declare pull_request paths`);
}
const handoffCoreWorkflows = [
  ...coreWorkflows,
  { path: HANDOFF_WORKFLOW_PATH, pullRequestPaths: handoffPullRequestPaths },
];
const handoffWorkflow = {
  path: HANDOFF_WORKFLOW_PATH,
  name: 'Engine handoff checks',
  id: 401,
  event: 'pull_request',
};
const handoffCheck = {
  id: 201,
  app: { id: 15368 },
  name: 'Real-engine handoff turn-order on ubuntu-latest',
  status: 'completed',
  conclusion: 'success',
  check_suite: { id: 401 },
  details_url: 'https://github.com/example/repo/actions/runs/401/job/201',
};
const handoffRelevantFiles = ['desktop/src/main.ts', 'engine/src/process/session-handoff-lease-gate.ts'];

test('hand-over-relevant PR without a passing real-engine handoff run fails the trusted gate', () => {
  for (const handoff of [null, { ...handoffCheck, conclusion: 'skipped' }, {
    ...handoffCheck, name: 'build', conclusion: 'success',
  }]) {
    const checkRuns = [...passCheckRuns, ...(handoff ? [handoff] : [])];
    const result = evaluateTrustedGate({
      checkRuns,
      workflowsByCheckId: { ...passWorkflows, ...(handoff ? { 201: handoffWorkflow } : {}) },
      changedFiles: handoffRelevantFiles,
      coreWorkflows: handoffCoreWorkflows,
      currentRunId: CURRENT_RUN_ID,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /engine-handoff-checks\.yml/);
    assert.equal(handoff ? isPassingHandoffE2e(handoff) : false, false);
  }
});

test('hand-over-relevant PR with a passing real-engine handoff run passes the trusted gate', () => {
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, handoffCheck],
    workflowsByCheckId: { ...passWorkflows, 201: handoffWorkflow },
    changedFiles: handoffRelevantFiles,
    coreWorkflows: handoffCoreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, true);
  assert.equal(result.missingCore.length, 0);
  assert.equal(isPassingHandoffE2e(handoffCheck), true);
});

test('unrelated PR is unaffected when the real-engine handoff run is absent', () => {
  const result = evaluateTrustedGate({
    checkRuns: passCheckRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: ['README.md'],
    coreWorkflows: handoffCoreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, true);
  assert.equal(result.missingCore.length, 0);
  assert.equal(missingCoreWorkflows({
    checkRuns: passCheckRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: ['README.md'],
    coreWorkflows: handoffCoreWorkflows,
  }).length, 0);
});

test('trusted coverage counts the real-engine handoff e2e from engine-handoff-checks', () => {
  const files = [{ filename: 'engine/test/gateway-desktop-handoff.e2e.test.ts', status: 'modified' }];
  const desktop = readFileSync(new URL('../.github/workflows/desktop-checks.yml', import.meta.url), 'utf8');
  const without = coverageFromPrFiles(files, desktop);
  assert.ok(without.uncovered.includes('engine/test/gateway-desktop-handoff.e2e.test.ts'));
  const withHandoff = coverageFromPrFiles(
    files,
    desktop,
    [],
    readFileSync(new URL(`../${HANDOFF_WORKFLOW_PATH}`, import.meta.url), 'utf8'),
    readFileSync(new URL('../engine/test/vitest/vitest.desktop-handoff.config.ts', import.meta.url), 'utf8'),
  );
  assert.ok(!withHandoff.uncovered.includes('engine/test/gateway-desktop-handoff.e2e.test.ts'));
});

test('merge-gate recheck fires when Visual tour and Engine build complete', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate-recheck.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^\s+-\s+Visual tour\s*$/m);
  assert.match(yaml, /^\s+-\s+Engine build \(PR\)\s*$/m);
});
