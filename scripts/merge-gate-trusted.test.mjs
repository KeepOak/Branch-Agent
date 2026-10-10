import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as gate from './merge-gate-trusted.mjs';
import { fileURLToPath } from 'node:url';
import {
  COLLAPSIBLE_CHECK_EVENTS,
  COMMENT_JOB_NAME,
  PASS_CONCLUSIONS,
  GATE_SCRIPTS,
  HANDOFF_WORKFLOW_PATH,
  TIMEOUT_RERUN_LINE,
  TRUSTED_CHECKOUT_REF,
  TRUSTED_WORKFLOW_PATH,
  VISUAL_TOUR_WORKFLOW_PATH,
  PATH_FILTER_NO_CHECK_RUN,
  coverageFromPrFiles,
  newestChecksByIdentity,
  resolvePrDesktopWorkflow,
  trustedDesktopWorkflow,
  evaluateOtherChecks,
  evaluateTrustedGate,
  fetchCheckRuns,
  findForeignTrustedChecks,
  formatTimeoutMessage,
  isPassingHandoffE2e,
  isSkippableVisualTourComment,
  mergeCheckRunPages,
  parseNamedTestList,
  formatGateChangeSummary,
  formatGateChangeReviewSummary,
  changedFilesFromPrFiles,
  evaluateGateChangeReview,
  BUTTON_CRAWL_BASELINE,
  buttonCrawlBaselineGrew,
  buttonCrawlBaselineGrowth,
  GATE_CHANGE_REVIEW_REQUIRED,
  loadProtectedGatePaths,
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
import {
  PASS_CONCLUSIONS as ORDINARY_PASS_CONCLUSIONS,
  evaluateOrdinaryChecks,
  fetchOrdinaryCheckRuns,
  formatOrdinaryTimeout,
  pollOrdinaryGate,
} from './merge-gate-rate-limit.mjs';
import { listedGateFiles } from './check-gate-files-fresh.mjs';

function ordinaryYaml() {
  return readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
}

function ordinaryCheckRunsFilter(yaml) {
  const match = yaml.match(/--jq '(\[.check_runs\[\][^\']*)'/)
    ?? yaml.match(/jq '(\[.check_runs\[\][^\']*)'/);
  if (!match) throw new Error('ordinary merge-gate name filter not found');
  return match[1];
}

function ordinaryCommentSkipFilter(yaml) {
  const match = yaml.match(/jq --argjson paths "\$comment_paths" --arg tour '[^']+' '\s*([^']+?)\s*'/);
  if (!match) throw new Error('ordinary merge-gate visual-tour comment filter not found');
  return match[1];
}

function ordinaryIdentityFilter(yaml) {
  const match = yaml.match(/identity_filter='([^']+)'/);
  if (!match) throw new Error('ordinary identity filter not found');
  return match[1];
}

function ordinaryDuplicateIdsFilter(yaml) {
  const match = yaml.match(/dup_ids=\$\(jq -c '([^']+)'/);
  if (!match) throw new Error('ordinary duplicate id filter not found');
  return match[1];
}

function ordinaryCollapseFilter(yaml) {
  const match = yaml.match(/jq --argjson attrs "\$attrs" --arg sha "\$SHA" --arg pr "\$PR_NUMBER" --arg base "\$BASE_REF" '\n([\s\S]*?)\n\s*' <<<"\$runs"/);
  if (!match) throw new Error('ordinary collapse filter not found');
  return match[1];
}

function jqProgram(filter, input, args = []) {
  return execFileSync('jq', [...args, filter], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    windowsHide: true,
  });
}

function collapsedByYaml(runs, workflows, context) {
  const yaml = ordinaryYaml();
  const named = JSON.parse(jqProgram(ordinaryCheckRunsFilter(yaml), { check_runs: runs }));
  return JSON.parse(execFileSync('jq', [
    '--argjson', 'attrs', JSON.stringify(workflows),
    '--arg', 'sha', context.sha ?? '',
    '--arg', 'pr', context.prNumber == null ? '' : String(context.prNumber),
    '--arg', 'base', context.baseRef ?? '',
    ordinaryCollapseFilter(yaml),
  ], {
    input: JSON.stringify(named),
    encoding: 'utf8',
    windowsHide: true,
  }));
}

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
const mergeGateWorkflow = { path: '.github/workflows/merge-gate.yml', name: 'Merge gate', id: 301,
  event: 'pull_request', checkSuiteId: 201, headSha: SHA,
  pullRequests: [{ number: PR_NUMBER, base: BASE_REF }] };
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
  checkSuiteId: 202,
  headSha: SHA,
  pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
};

const analyzeCheck = { id: 105, name: 'Analyze (actions)', status: 'completed', conclusion: 'success' };

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
  analyzeCheck,
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
  const yaml = ordinaryYaml();
  const filter = ordinaryCheckRunsFilter(yaml);
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
  assert.equal(result.others.length, 3);
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

test('rate-limited current trusted check stays pending without API suite attribution', () => {
  const workflowsByCheckId = {
    101: mergeGateWorkflow,
  };
  const checkRuns = [passCheckRuns[0], passCheckRuns[2], analyzeCheck];
  const foreign = findForeignTrustedChecks(checkRuns, workflowsByCheckId, {
    allowedRunId: CURRENT_RUN_ID,
  });
  assert.deepEqual(foreign, []);
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ready, false);
  assert.equal(result.foreignTrusted.length, 0);
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
  const checkRuns = [passCheckRuns[0], passCheckRuns[2], analyzeCheck];
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
  ['empty PR list', {}, { pullRequests: [] }],
  ['non-main base', {}, { pullRequests: [
    { number: PR_NUMBER, base: BASE_REF },
    { number: 628, base: 'old-base' },
  ] }],
  ['wrong head SHA', {}, { headSha: 'other-sha' }],
]) {
  test(`earlier trusted run ignores ${reason} on pull_request_target`, () => {
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
    assert.equal(result.ok, true);
    assert.deepEqual(result.foreignTrusted, []);
  });
}

test('reopened same SHA keeps newest check per App workflow and name over old cancelled checks', () => {
  const oldGate = { ...passCheckRuns[0], id: 90, conclusion: 'cancelled', check_suite: { id: 190 } };
  const oldFeature = { ...passCheckRuns[1], id: 91, conclusion: 'cancelled', check_suite: { id: 191 } };
  for (const checkRuns of [
    [oldGate, oldFeature, ...passCheckRuns],
    [...passCheckRuns, oldFeature, oldGate],
  ]) {
    const result = evaluateTrustedGate({
      checkRuns,
      workflowsByCheckId: { ...passWorkflows,
        90: { ...mergeGateWorkflow, id: 290, checkSuiteId: 190 },
        91: { ...featureBatchWorkflow, id: 291, checkSuiteId: 191 } },
      changedFiles: ['engine/src/gateway/contacts.ts'],
      coreWorkflows,
      currentRunId: CURRENT_RUN_ID,
      ...prContext,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.others.map((check) => check.id).sort(), [101, 102, 105]);
  }
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, { ...passCheckRuns[0], id: 110, conclusion: 'cancelled' }],
    workflowsByCheckId: { ...passWorkflows, 110: mergeGateWorkflow },
    ...prContext,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failed[0].id, 110);
  const pending = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, { ...passCheckRuns[0], id: 110, status: 'queued', conclusion: null }],
    workflowsByCheckId: { ...passWorkflows, 110: mergeGateWorkflow },
    ...prContext,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(pending.ready, false);
  assert.equal(pending.pending[0].id, 110);
});

test('reopened same SHA keeps a newer green run over an older failure from the same workflow', () => {
  const oldFeature = {
    ...passCheckRuns[1],
    id: 91,
    conclusion: 'failure',
    check_suite: { id: 191 },
  };
  for (const event of COLLAPSIBLE_CHECK_EVENTS) {
    for (const checkRuns of [
      [oldFeature, ...passCheckRuns],
      [...passCheckRuns, oldFeature],
    ]) {
      const result = evaluateTrustedGate({
        checkRuns,
        workflowsByCheckId: {
          ...passWorkflows,
          91: { ...featureBatchWorkflow, id: 291, checkSuiteId: 191, event },
          102: { ...featureBatchWorkflow, event },
        },
        changedFiles: ['engine/src/gateway/contacts.ts'],
        coreWorkflows,
        currentRunId: CURRENT_RUN_ID,
        ...prContext,
      });
      assert.equal(result.ok, true, event);
      assert.equal(result.failed.some((check) => check.id === 91), false);
      assert.ok(result.others.some((check) => check.id === 102));
    }
  }
});

test('regression: fully attributed 3093a8dd build pair still fails both gates', () => {
  const fullWorkflows = {
    112992933987: {
      path: '.github/workflows/visual-tour.yml',
      event: 'pull_request',
      headSha: SHA,
      checkSuiteId: 102080051817,
      pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
    },
    113023525061: {
      path: '.github/workflows/engine-build-pr.yml',
      event: 'pull_request',
      headSha: SHA,
      checkSuiteId: 102080051207,
      pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
    },
  };
  for (const pair of [realBuildPair, [...realBuildPair].reverse()]) {
    const trustedResult = evaluateTrustedGate({
      checkRuns: [passCheckRuns[0], passCheckRuns[2], analyzeCheck, ...pair],
      workflowsByCheckId: { ...passWorkflows, ...fullWorkflows },
      changedFiles: ['README.md'],
      coreWorkflows,
      currentRunId: CURRENT_RUN_ID,
      ...prContext,
    });
    assert.equal(trustedResult.ok, false);
    assert.deepEqual(trustedResult.failed.map((check) => check.id), [112992933987]);

    const ordinary = evaluateOrdinaryChecks(pair, {
      workflowsByCheckId: fullWorkflows,
      ...prContext,
    });
    assert.deepEqual(ordinary.failed.map((check) => check.id), [112992933987]);
  }
});

function desktopIdentityRun(id, suite, patch = {}) {
  return {
    id,
    app: { id: 15368 },
    name: 'Desktop on windows-latest',
    status: 'completed',
    conclusion: 'success',
    check_suite: { id: suite },
    ...patch,
  };
}

function desktopIdentityWorkflow(suite) {
  return {
    path: '.github/workflows/desktop-checks.yml',
    event: 'pull_request',
    headSha: SHA,
    checkSuiteId: suite,
    pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
  };
}

function assertOrdinaryAgreesWithYaml(runs, workflows) {
  const ordinary = evaluateOrdinaryChecks(runs, { workflowsByCheckId: workflows, ...prContext });
  const collapsed = collapsedByYaml(runs, workflows, prContext);
  const ids = (items) => items.map((run) => run.id).sort((left, right) => left - right);
  assert.deepEqual(ids(collapsed), ids(ordinary.others));
  const failedFilter = ordinaryYaml().match(/failed=\$\(jq -r '([^']+)'/)[1];
  const failed = execFileSync('jq', ['-r', failedFilter], {
    input: JSON.stringify(collapsed),
    encoding: 'utf8',
    windowsHide: true,
  }).trim().split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(failed, ordinary.failed.map((run) => `${run.name}: ${run.conclusion}`).sort());
  return ordinary;
}

test('same-suite failed and success stay together and the gate is not ready', () => {
  const failed = desktopIdentityRun(90, 501, { conclusion: 'failure' });
  const success = desktopIdentityRun(110, 501);
  const workflows = { 90: desktopIdentityWorkflow(501), 110: desktopIdentityWorkflow(501) };
  const runs = [failed, success, analyzeCheck];
  const ordinary = assertOrdinaryAgreesWithYaml(runs, workflows);
  assert.equal(ordinary.ready, false);
  assert.deepEqual(ordinary.failed.map((run) => run.id), [failed.id]);
  assert.deepEqual(ordinary.others.map((run) => run.id).sort((left, right) => left - right), [failed.id, analyzeCheck.id, success.id].sort((left, right) => left - right));
  const trustedResult = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, failed, success],
    workflowsByCheckId: { ...passWorkflows, ...workflows },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(trustedResult.ok, false);
  assert.deepEqual(trustedResult.failed.map((check) => check.id), [failed.id]);
});

test('same-suite in_progress and success stay pending', () => {
  const running = desktopIdentityRun(90, 501, { status: 'in_progress', conclusion: null });
  const success = desktopIdentityRun(110, 501);
  const workflows = { 90: desktopIdentityWorkflow(501), 110: desktopIdentityWorkflow(501) };
  const ordinary = assertOrdinaryAgreesWithYaml([running, success, analyzeCheck], workflows);
  assert.equal(ordinary.ready, false);
  assert.deepEqual(ordinary.failed, []);
  assert.deepEqual(ordinary.pending.map((run) => run.id), [running.id]);
  const trustedResult = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, running, success],
    workflowsByCheckId: { ...passWorkflows, ...workflows },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(trustedResult.ready, false);
  assert.equal(trustedResult.ok, false);
  assert.deepEqual(trustedResult.pending.map((check) => check.id), [running.id]);
});

test('newer skipped run does not hide an older failure', () => {
  const failed = desktopIdentityRun(90, 490, { conclusion: 'failure' });
  const skipped = desktopIdentityRun(110, 501, { conclusion: 'skipped' });
  const workflows = { 90: desktopIdentityWorkflow(490), 110: desktopIdentityWorkflow(501) };
  const ordinary = assertOrdinaryAgreesWithYaml([failed, skipped, analyzeCheck], workflows);
  assert.equal(ordinary.ready, false);
  assert.deepEqual(ordinary.failed.map((run) => run.id), [failed.id]);
  assert.equal(ordinary.others.some((run) => run.id === skipped.id), true);
  const trustedResult = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, failed, skipped],
    workflowsByCheckId: { ...passWorkflows, ...workflows },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(trustedResult.ok, false);
  assert.deepEqual(trustedResult.failed.map((check) => check.id), [failed.id]);
});

test('newer neutral run does not hide an older failure', () => {
  const failed = desktopIdentityRun(90, 490, { conclusion: 'failure' });
  const neutral = desktopIdentityRun(110, 501, { conclusion: 'neutral' });
  const workflows = { 90: desktopIdentityWorkflow(490), 110: desktopIdentityWorkflow(501) };
  const ordinary = assertOrdinaryAgreesWithYaml([failed, neutral, analyzeCheck], workflows);
  assert.equal(ordinary.ready, false);
  assert.deepEqual(ordinary.failed.map((run) => run.id), [failed.id]);
  assert.equal(ordinary.others.some((run) => run.id === neutral.id), true);
  const trustedResult = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, failed, neutral],
    workflowsByCheckId: { ...passWorkflows, ...workflows },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(trustedResult.ok, false);
  assert.deepEqual(trustedResult.failed.map((check) => check.id), [failed.id]);
});

// PR #767 harvest pair: concurrency cancelled run 37791522434 (higher suite
// id) while run 37791522096 finished with select=success and two skipped jobs.
const harvestApp = { id: 15368 };
const harvestCancelledSuite = 102385772354;
const harvestPassingSuite = 102385771625;
const harvestCancelledRun = 37791522434;
const harvestPassingRun = 37791522096;
function harvestJob(id, name, suite, runId, conclusion) {
  return {
    id,
    app: harvestApp,
    name,
    status: 'completed',
    conclusion,
    check_suite: { id: suite },
    details_url: `https://github.com/KeepOak/Branch-Agent/actions/runs/${runId}/job/${id}`,
  };
}
const harvestCancelledChecks = [
  harvestJob(113359874720, 'select', harvestCancelledSuite, harvestCancelledRun, 'cancelled'),
  harvestJob(113359886668, 'Harvest ${{ matrix.lane }} ${{ matrix.shard }}',
    harvestCancelledSuite, harvestCancelledRun, 'cancelled'),
  harvestJob(113359887083, 'report-nightly', harvestCancelledSuite, harvestCancelledRun, 'cancelled'),
];
const harvestPassingChecks = [
  harvestJob(113359901237, 'select', harvestPassingSuite, harvestPassingRun, 'success'),
  harvestJob(113360430916, 'Harvest ${{ matrix.lane }} ${{ matrix.shard }}',
    harvestPassingSuite, harvestPassingRun, 'skipped'),
  harvestJob(113360432533, 'report-nightly', harvestPassingSuite, harvestPassingRun, 'skipped'),
];
function harvestWorkflow(suite, runId) {
  return {
    path: '.github/workflows/harvest-checks.yml',
    name: 'Harvest checks',
    id: runId,
    event: 'pull_request',
    headSha: SHA,
    checkSuiteId: suite,
    pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
  };
}
const harvestWorkflows = {
  113359874720: harvestWorkflow(harvestCancelledSuite, harvestCancelledRun),
  113359886668: harvestWorkflow(harvestCancelledSuite, harvestCancelledRun),
  113359887083: harvestWorkflow(harvestCancelledSuite, harvestCancelledRun),
  113359901237: harvestWorkflow(harvestPassingSuite, harvestPassingRun),
  113360430916: harvestWorkflow(harvestPassingSuite, harvestPassingRun),
  113360432533: harvestWorkflow(harvestPassingSuite, harvestPassingRun),
};

function assertHarvestPairPasses(checkRuns) {
  const ordinary = assertOrdinaryAgreesWithYaml(
    [...checkRuns, analyzeCheck],
    harvestWorkflows,
  );
  assert.equal(ordinary.ready, true);
  assert.deepEqual(ordinary.failed, []);
  assert.deepEqual(
    ordinary.others.filter((run) => harvestWorkflows[run.id]).map((run) => run.id).sort((a, b) => a - b),
    harvestPassingChecks.map((run) => run.id).sort((a, b) => a - b),
  );
  const trustedResult = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, ...checkRuns],
    workflowsByCheckId: { ...passWorkflows, ...harvestWorkflows },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(trustedResult.ok, true);
  assert.deepEqual(trustedResult.failed, []);
  const kept = newestChecksByIdentity(
    checkRuns,
    harvestWorkflows,
    prContext,
  ).map((run) => run.id).sort((a, b) => a - b);
  assert.deepEqual(kept, harvestPassingChecks.map((run) => run.id).sort((a, b) => a - b));
}

test('regression: #767 cancelled harvest suite is superseded by skipped+success replacement', () => {
  for (const pair of [
    [...harvestCancelledChecks, ...harvestPassingChecks],
    [...harvestPassingChecks, ...harvestCancelledChecks],
  ]) {
    assertHarvestPairPasses(pair);
  }
});

test('regression: cancelled harvest suite with no replacement still fails both gates', () => {
  const ordinary = assertOrdinaryAgreesWithYaml(
    [...harvestCancelledChecks, analyzeCheck],
    harvestWorkflows,
  );
  assert.equal(ordinary.ready, false);
  assert.deepEqual(
    ordinary.failed.map((run) => `${run.name}: ${run.conclusion}`).sort(),
    harvestCancelledChecks.map((run) => `${run.name}: cancelled`).sort(),
  );
  const trustedResult = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, ...harvestCancelledChecks],
    workflowsByCheckId: { ...passWorkflows, ...harvestWorkflows },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(trustedResult.ok, false);
  assert.deepEqual(
    trustedResult.failed.map((run) => `${run.name}: ${run.conclusion}`).sort(),
    harvestCancelledChecks.map((run) => `${run.name}: cancelled`).sort(),
  );
});

test('regression: older harvest failure plus newer skipped suite still fails both gates', () => {
  for (const conclusion of ['failure', 'timed_out', 'action_required', 'startup_failure']) {
    const failedSelect = harvestJob(90, 'select', 490, 90, conclusion);
    const skippedSelect = harvestJob(110, 'select', harvestPassingSuite, harvestPassingRun, 'skipped');
    const workflows = {
      90: harvestWorkflow(490, 90),
      110: harvestWorkflow(harvestPassingSuite, harvestPassingRun),
    };
    const ordinary = assertOrdinaryAgreesWithYaml(
      [failedSelect, skippedSelect, analyzeCheck],
      workflows,
    );
    assert.equal(ordinary.ready, false, conclusion);
    assert.deepEqual(ordinary.failed.map((run) => run.id), [90]);
    assert.equal(ordinary.others.some((run) => run.id === 110), true);
    const trustedResult = evaluateTrustedGate({
      checkRuns: [...passCheckRuns, failedSelect, skippedSelect],
      workflowsByCheckId: { ...passWorkflows, ...workflows },
      changedFiles: ['README.md'],
      coreWorkflows,
      currentRunId: CURRENT_RUN_ID,
      ...prContext,
    });
    assert.equal(trustedResult.ok, false, conclusion);
    assert.deepEqual(trustedResult.failed.map((check) => check.id), [90]);
  }
});

const visualTourCore = [
  { path: '.github/workflows/merge-gate.yml', pullRequestPaths: null },
  { path: VISUAL_TOUR_WORKFLOW_PATH, pullRequestPaths: ['window/**', 'engine/**', 'desktop/**'] },
];
const visualTourWindowFiles = ['window/src/app.tsx'];
const visualTourBuild = {
  id: 113361725521,
  app: harvestApp,
  name: 'build',
  status: 'completed',
  conclusion: 'success',
  check_suite: { id: 102385772397 },
  details_url: 'https://github.com/KeepOak/Branch-Agent/actions/runs/37791522451/job/113361725521',
};
const visualTourTour = {
  id: 113364294349,
  app: harvestApp,
  name: 'tour',
  status: 'completed',
  conclusion: 'success',
  check_suite: { id: 102385772397 },
  details_url: 'https://github.com/KeepOak/Branch-Agent/actions/runs/37791522451/job/113364294349',
};
const visualTourRunWorkflow = {
  path: VISUAL_TOUR_WORKFLOW_PATH,
  name: 'Visual tour',
  id: 37791522451,
  event: 'pull_request',
  headSha: SHA,
  checkSuiteId: 102385772397,
  pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
};
const visualTourCheckWorkflows = {
  113361725521: visualTourRunWorkflow,
  113364294349: visualTourRunWorkflow,
};

test('regression: #767 Visual tour build and tour satisfy the path-filter once attributed', () => {
  const missing = missingCoreWorkflows({
    checkRuns: [passCheckRuns[0], analyzeCheck, visualTourBuild, visualTourTour],
    workflowsByCheckId: { 101: mergeGateWorkflow, ...visualTourCheckWorkflows },
    changedFiles: visualTourWindowFiles,
    coreWorkflows: visualTourCore,
    ...prContext,
  });
  assert.deepEqual(missing, []);
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, visualTourBuild, visualTourTour],
    workflowsByCheckId: { ...passWorkflows, ...visualTourCheckWorkflows },
    changedFiles: visualTourWindowFiles,
    coreWorkflows: visualTourCore,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.deepEqual(result.unregisteredCore, []);
  assert.equal(result.others.some((run) => run.id === visualTourBuild.id), true);
  assert.equal(result.others.some((run) => run.id === visualTourTour.id), true);
});

test('regression: Visual tour registering late is waited for and then passes', () => {
  let polls = 0;
  const waits = [];
  const code = gate.pollTrustedGate({
    repo: 'example/repo', token: 'unused', ...prContext,
    changedFiles: visualTourWindowFiles,
    coreWorkflows: visualTourCore, currentRunId: CURRENT_RUN_ID,
    maxAttempts: 3, pollSeconds: 30,
  }, {
    fetchChecks: () => {
      polls += 1;
      return polls === 1
        ? passCheckRuns
        : [...passCheckRuns, visualTourBuild, visualTourTour];
    },
    resolveWorkflows: (_repo, _token, runs) => {
      const found = { ...passWorkflows };
      for (const run of runs) {
        if (visualTourCheckWorkflows[run.id]) found[run.id] = visualTourCheckWorkflows[run.id];
      }
      return found;
    },
    sleep: (seconds) => waits.push(seconds), log: () => {}, error: () => {},
  });
  assert.equal(code, 0);
  assert.equal(polls, 2);
  assert.deepEqual(waits, [30]);
});

test('regression: Visual tour truly missing still fails after the timeout', () => {
  const errors = [];
  let polls = 0;
  const code = gate.pollTrustedGate({
    repo: 'example/repo', token: 'unused', ...prContext,
    changedFiles: visualTourWindowFiles,
    coreWorkflows: visualTourCore, currentRunId: CURRENT_RUN_ID,
    maxAttempts: 3, pollSeconds: 30,
  }, {
    fetchChecks: () => {
      polls += 1;
      return passCheckRuns;
    },
    resolveWorkflows: () => passWorkflows,
    sleep: () => {}, log: () => {}, error: (text) => errors.push(text),
  });
  assert.equal(code, 1);
  assert.equal(polls, 3);
  const snapshot = evaluateTrustedGate({
    checkRuns: passCheckRuns,
    workflowsByCheckId: passWorkflows,
    changedFiles: visualTourWindowFiles,
    coreWorkflows: visualTourCore,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(snapshot.ready, false);
  assert.ok(snapshot.unregisteredCore.some((item) => item.includes(VISUAL_TOUR_WORKFLOW_PATH)));
  assert.match(errors.join('\n'), new RegExp(`${VISUAL_TOUR_WORKFLOW_PATH.replaceAll('.', '\\.')}`));
  assert.match(errors.join('\n'), /Timed out waiting for:/);
  assert.match(errors.join('\n'), new RegExp(TIMEOUT_RERUN_LINE));
});

test('regression: unattributed Visual tour jobs stay a path-filter miss until resolved', () => {
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, visualTourBuild, visualTourTour],
    workflowsByCheckId: passWorkflows,
    changedFiles: visualTourWindowFiles,
    coreWorkflows: visualTourCore,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(result.ready, false);
  assert.ok(result.unregisteredCore.some((item) => item.includes(VISUAL_TOUR_WORKFLOW_PATH)));
  assert.ok(result.missingCore.some((item) => item.includes(PATH_FILTER_NO_CHECK_RUN)));
});

test('older forged trusted checks cannot be hidden by name deduplication', () => {
  const forged = { ...passCheckRuns[2], id: 90, details_url: 'https://github.com/example/repo/actions/runs/304/job/90' };
  const result = evaluateTrustedGate({
    checkRuns: [forged, ...passCheckRuns],
    workflowsByCheckId: {
      ...passWorkflows,
      90: { path: '.github/workflows/foreign.yml', name: 'Foreign', id: 304, event: 'pull_request_target' },
    },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(result.ok, false);
  assert.equal(result.foreignTrusted[0].id, 90);
});

test('regression: #632 earlier same-workflow pull_request_target run is not forged', () => {
  const earlier = {
    id: 113100000001,
    name: 'merge-gate-trusted',
    status: 'completed',
    conclusion: 'success',
    check_suite: { id: 204 },
    details_url: 'https://github.com/KeepOak/Branch-Agent/actions/runs/37724804984/job/113100000001',
  };
  const earlierWorkflow = {
    path: TRUSTED_WORKFLOW_PATH,
    name: 'Merge gate trusted',
    id: 37724804984,
    event: 'pull_request_target',
    checkSuiteId: 204,
    headSha: undefined,
    pullRequests: [],
  };
  const foreign = findForeignTrustedChecks([...passCheckRuns, earlier], {
    ...passWorkflows,
    113100000001: earlierWorkflow,
  }, { allowedRunId: CURRENT_RUN_ID, ...prContext });
  assert.deepEqual(foreign, []);
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, earlier],
    workflowsByCheckId: { ...passWorkflows, 113100000001: earlierWorkflow },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.foreignTrusted, []);
});

test('concurrent same-workflow pull_request_target run is ignored', () => {
  const concurrent = {
    ...passCheckRuns[2],
    id: 104,
    status: 'in_progress',
    conclusion: null,
    check_suite: { id: 204 },
    details_url: 'https://github.com/example/repo/actions/runs/304/job/104',
  };
  const foreign = findForeignTrustedChecks([...passCheckRuns, concurrent], {
    ...passWorkflows,
    104: earlierTrustedWorkflow,
  }, { allowedRunId: CURRENT_RUN_ID, ...prContext });
  assert.deepEqual(foreign, []);
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, concurrent],
    workflowsByCheckId: { ...passWorkflows, 104: earlierTrustedWorkflow },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.foreignTrusted, []);
});

for (const [reason, workflowPatch, checkPatch, contextPatch] of [
  ['P3b another PR', { pullRequests: [{ number: 900, base: BASE_REF }] }],
  ['P9 workflow_dispatch', { event: 'workflow_dispatch' }],
  ['wrong SHA', { headSha: 'other-sha' }],
  ['wrong suite', { checkSuiteId: 999 }],
  ['missing suite', {}, { check_suite: undefined }],
  ['fork empty PR list', { pullRequests: [] }],
  ['additional non-main PR', { pullRequests: [
    { number: PR_NUMBER, base: BASE_REF }, { number: 700, base: 'release' },
  ] }],
  ['missing evaluation context', {}, {}, { sha: undefined }],
  ['missing PR context', {}, {}, { prNumber: undefined }],
  ['missing base context', {}, {}, { baseRef: undefined }],
]) {
  test(`regression: same-path success cannot hide failure from ${reason}`, () => {
    const failed = { ...passCheckRuns[1], conclusion: 'failure' };
    const success = { ...failed, id: 160, conclusion: 'success', ...checkPatch };
    for (const pair of [[failed, success], [success, failed]]) {
      const result = evaluateTrustedGate({
        checkRuns: [passCheckRuns[0], passCheckRuns[2], analyzeCheck, ...pair],
        workflowsByCheckId: { ...passWorkflows, 160: { ...featureBatchWorkflow, ...workflowPatch } },
        changedFiles: ['README.md'], coreWorkflows, currentRunId: CURRENT_RUN_ID,
        ...prContext, ...contextPatch,
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.failed.map((check) => check.id), [102]);
    }
  });
}

test('regression: an unbound old failure cannot collapse into this PR success', () => {
  const failed = { ...passCheckRuns[1], id: 90, conclusion: 'failure' };
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, failed],
    workflowsByCheckId: { ...passWorkflows, 90: { ...featureBatchWorkflow, event: 'workflow_dispatch' } },
    changedFiles: ['README.md'], coreWorkflows, currentRunId: CURRENT_RUN_ID, ...prContext,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed.map((check) => check.id), [90]);
});

test('regression: trusted gate waits for missing or running Analyze and rejects failure', () => {
  for (const analyze of [null, { ...analyzeCheck, status: 'queued', conclusion: null },
    { ...analyzeCheck, status: 'in_progress', conclusion: null },
    { ...analyzeCheck, conclusion: 'failure' }, analyzeCheck]) {
    const result = evaluateTrustedGate({
      checkRuns: [...passCheckRuns.filter((check) => check !== analyzeCheck), ...(analyze ? [analyze] : [])],
      workflowsByCheckId: passWorkflows, changedFiles: ['README.md'],
      coreWorkflows, currentRunId: CURRENT_RUN_ID, ...prContext,
    });
    assert.equal(result.ok, analyze === analyzeCheck);
    assert.equal(result.ready, analyze?.status === 'completed');
  }
});

test('regression: ordinary gate waits for absent Analyze through the actual pending jq', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  const filter = yaml.match(/pending=\$\(jq '([^']+)'/)[1];
  const failedFilter = yaml.match(/failed=\$\(jq -r '([^']+)'/)[1];
  for (const [checks, expected] of [
    [[passCheckRuns[1]], 1],
    [[passCheckRuns[1], { ...analyzeCheck, status: 'queued', conclusion: null }], 1],
    [[passCheckRuns[1], { ...analyzeCheck, status: 'in_progress', conclusion: null }], 1],
    [[passCheckRuns[1], analyzeCheck], 0],
  ]) {
    const pending = Number(execFileSync('jq', [filter], {
      input: JSON.stringify(checks), encoding: 'utf8', windowsHide: true,
    }));
    assert.equal(pending, expected);
  }
  const failed = execFileSync('jq', ['-r', failedFilter], {
    input: JSON.stringify([{ ...analyzeCheck, conclusion: 'failure' }]),
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(failed.trim(), 'Analyze (actions): failure');
});

test('regression: trusted polling waits for late Analyze, rejects red, and times out if absent', () => {
  for (const mode of ['success', 'failure', 'absent']) {
    let polls = 0;
    const waits = [];
    const code = gate.pollTrustedGate({
      repo: 'example/repo', token: 'unused', ...prContext, changedFiles: ['README.md'],
      coreWorkflows, currentRunId: CURRENT_RUN_ID, maxAttempts: 3, pollSeconds: 30,
    }, {
      fetchChecks: () => {
        polls += 1;
        return [...passCheckRuns.filter((check) => check !== analyzeCheck),
          ...(mode === 'absent' || polls === 1 ? [] : [{ ...analyzeCheck,
            status: polls === 2 ? 'in_progress' : 'completed',
            conclusion: polls === 2 ? null : mode }])];
      },
      resolveWorkflows: () => passWorkflows,
      sleep: (seconds) => waits.push(seconds), log: () => {}, error: () => {},
    });
    assert.equal(code, mode === 'success' ? 0 : 1);
    assert.equal(polls, 3);
    assert.deepEqual(waits, [30, 30]);
  }
});

test('regression: unresolved current claims retry, reject a resolved forgery, or time out', () => {
  for (const mode of ['recover', 'forged', 'permanent']) {
    let polls = 0;
    let lookups = 0;
    const waits = [];
    const errors = [];
    const forged = { ...passCheckRuns[2], id: 160, check_suite: { id: 999 } };
    const checks = mode === 'forged' ? [...passCheckRuns, forged] : passCheckRuns;
    const code = gate.pollTrustedGate({
      repo: 'example/repo', token: 'unused', ...prContext, changedFiles: ['README.md'],
      coreWorkflows, currentRunId: CURRENT_RUN_ID, maxAttempts: 3, pollSeconds: 30,
    }, {
      fetchChecks: () => { polls += 1; return checks; },
      resolveWorkflows: (repo, token, runs, options) => resolveWorkflowsForCheckRuns(repo, token, runs, {
        ...options,
        resolveWorkflow: (_repo, _token, check) => {
          if (check.id === (mode === 'forged' ? 160 : 103)) {
            lookups += 1;
            if (polls === 1 || mode === 'permanent') throw new Error('API 503');
            return trustedWorkflow;
          }
          return passWorkflows[check.id] ?? null;
        },
      }),
      sleep: (seconds) => waits.push(seconds), log: () => {}, error: (text) => errors.push(text),
    });
    assert.equal(code, mode === 'recover' ? 0 : 1);
    assert.equal(polls, mode === 'permanent' ? 3 : 2);
    assert.equal(lookups, polls);
    assert.deepEqual(waits, mode === 'permanent' ? [30, 30] : [30]);
    if (mode === 'forged') assert.match(errors.join('\n'), /Forged or extra/);
    if (mode === 'permanent') assert.match(errors.join('\n'), /Timed out/);
  }
});

test('ordinary merge gate jq preserves all checks and its polling budget', () => {
  const yaml = ordinaryYaml();
  const filter = ordinaryCheckRunsFilter(yaml);
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
    assert.deepEqual(actual, [feature, analyzeCheck, latest, { ...feature, id: 90, conclusion: 'cancelled' }]);
  }
  // Single pass (event-driven): one evaluation, no 64-attempt poll loop.
  assert.match(yaml, /seq 1 1\)/);
  assert.doesNotMatch(yaml, /seq 1 64/);
  assert.doesNotMatch(yaml, /sleep 10/);
});

const visualTourWorkflow = {
  path: VISUAL_TOUR_WORKFLOW_PATH,
  name: 'Visual tour',
  id: 306,
  event: 'pull_request',
};
const otherCommentWorkflow = {
  path: '.github/workflows/other.yml',
  name: 'Other',
  id: 307,
  event: 'pull_request',
};
const pendingVisualTourComment = {
  id: 106,
  name: COMMENT_JOB_NAME,
  status: 'in_progress',
  conclusion: null,
  check_suite: { id: 206 },
  details_url: 'https://github.com/example/repo/actions/runs/306/job/106',
};
const pendingForeignComment = {
  ...pendingVisualTourComment,
  id: 107,
  check_suite: { id: 207 },
  details_url: 'https://github.com/example/repo/actions/runs/307/job/107',
};

test('visual-tour comment pending does not block the trusted gate', () => {
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, pendingVisualTourComment],
    workflowsByCheckId: { ...passWorkflows, 106: visualTourWorkflow },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(isSkippableVisualTourComment(pendingVisualTourComment, visualTourWorkflow), true);
  assert.equal(result.ok, true);
  assert.equal(result.ready, true);
  assert.equal(result.pending.length, 0);
  assert.equal(result.others.some((run) => run.name === COMMENT_JOB_NAME), false);
});

test('comment from another workflow still blocks the trusted gate', () => {
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, pendingForeignComment],
    workflowsByCheckId: { ...passWorkflows, 107: otherCommentWorkflow },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(isSkippableVisualTourComment(pendingForeignComment, otherCommentWorkflow), false);
  assert.equal(isSkippableVisualTourComment(pendingForeignComment, null), false);
  assert.equal(result.ready, false);
  assert.deepEqual(result.pending.map((run) => run.name), [COMMENT_JOB_NAME]);
});

test('unattributed comment is not skipped (fail closed)', () => {
  const result = evaluateTrustedGate({
    checkRuns: [...passCheckRuns, pendingVisualTourComment],
    workflowsByCheckId: passWorkflows,
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.pending.map((run) => run.id), [106]);
});

test('ordinary gate skips a Visual tour comment and still waits on a foreign comment', () => {
  const yaml = ordinaryYaml();
  const skip = ordinaryCommentSkipFilter(yaml);
  const visual = execFileSync('jq', [
    '--argjson', 'paths', JSON.stringify({ 106: VISUAL_TOUR_WORKFLOW_PATH }),
    '--arg', 'tour', VISUAL_TOUR_WORKFLOW_PATH,
    skip,
  ], {
    input: JSON.stringify([passCheckRuns[1], pendingVisualTourComment]),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.deepEqual(JSON.parse(visual).map((run) => run.name), [passCheckRuns[1].name]);

  const foreign = execFileSync('jq', [
    '--argjson', 'paths', JSON.stringify({ 107: otherCommentWorkflow.path }),
    '--arg', 'tour', VISUAL_TOUR_WORKFLOW_PATH,
    skip,
  ], {
    input: JSON.stringify([pendingForeignComment]),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.deepEqual(JSON.parse(foreign).map((run) => run.name), [COMMENT_JOB_NAME]);

  const unattributed = execFileSync('jq', [
    '--argjson', 'paths', JSON.stringify({}),
    '--arg', 'tour', VISUAL_TOUR_WORKFLOW_PATH,
    skip,
  ], {
    input: JSON.stringify([pendingVisualTourComment]),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.deepEqual(JSON.parse(unattributed).map((run) => run.id), [106]);
});

test('more than 100 check-runs are all read across pages', () => {
  const page1 = {
    total_count: 101,
    check_runs: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: `ok-${index}`,
      status: 'completed',
      conclusion: 'success',
    })),
  };
  const page2 = {
    total_count: 101,
    check_runs: [{
      id: 101,
      name: 'Named feature tests on ubuntu-latest (9/10)',
      status: 'completed',
      conclusion: 'failure',
    }],
  };
  const merged = mergeCheckRunPages([page1, page2]);
  assert.equal(merged.checkRuns.length, 101);
  assert.equal(merged.complete, true);
  assert.equal(merged.checkRuns[100].conclusion, 'failure');

  const calls = [];
  const fetched = fetchCheckRuns('example/repo', SHA, 'unused', (_repo, _token, requestPath) => {
    calls.push(requestPath);
    return requestPath.endsWith('page=1') ? page1 : page2;
  });
  assert.deepEqual(calls, [
    `commits/${SHA}/check-runs?per_page=100&page=1`,
    `commits/${SHA}/check-runs?per_page=100&page=2`,
  ]);
  assert.equal(fetched.length, 101);
  assert.equal(fetched[100].name, 'Named feature tests on ubuntu-latest (9/10)');

  const yaml = ordinaryYaml();
  assert.match(yaml, /per_page=100&page=\$page/);
  assert.match(yaml, /collected=\$\(jq '\[\.\[\]\.check_runs\[\]\] \| length'/);
  assert.match(yaml, /if \[ "\$collected" -ge "\$total" \]; then break; fi/);
});

test('timeout message lists pending names and says to re-run merge-gate', () => {
  const message = formatTimeoutMessage([
    { name: 'tour', status: 'in_progress' },
    { name: 'Desktop on ubuntu-latest', status: 'queued' },
  ]);
  assert.match(message, /Timed out waiting for: Desktop on ubuntu-latest, tour/);
  assert.match(message, new RegExp(`^${TIMEOUT_RERUN_LINE}$`, 'm'));
  assert.equal(message.split('\n').at(-1), TIMEOUT_RERUN_LINE);

  const errors = [];
  const code = gate.pollTrustedGate({
    repo: 'example/repo', token: 'unused', ...prContext, changedFiles: ['README.md'],
    coreWorkflows, currentRunId: CURRENT_RUN_ID, maxAttempts: 1, pollSeconds: 30,
  }, {
    fetchChecks: () => [
      passCheckRuns[0],
      { ...passCheckRuns[1], status: 'in_progress', conclusion: null },
      analyzeCheck,
    ],
    resolveWorkflows: () => passWorkflows,
    sleep: () => {},
    log: () => {},
    error: (text) => errors.push(text),
  });
  assert.equal(code, 1);
  assert.match(errors.join('\n'), /Timed out waiting for: Named feature tests on ubuntu-latest \(1\/10\)/);
  assert.match(errors.join('\n'), /re-run merge-gate, do not merge main/);

  const yaml = ordinaryYaml();
  assert.match(yaml, /Timed out waiting for: \$pending_names/);
  assert.match(yaml, /^ {10}echo "re-run merge-gate, do not merge main"$/m);
  assert.match(yaml, /timeout-minutes: 35/);
  assert.doesNotMatch(yaml, /timeout-minutes: 60/);
  assert.doesNotMatch(yaml, /wait-for-checks/);
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
    checkRuns: [passCheckRuns[0], nextChecks[0], analyzeCheck],
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
    // A thrown lookup is pending (not forged); a lookup that finds no workflow is still forged.
    const failedLookup = unavailable instanceof Error;
    assert.equal(findForeignTrustedChecks(checks, first, { allowedRunId: CURRENT_RUN_ID }).length, failedLookup ? 0 : 1);
    assert.equal(first[501]?.lookupFailed === true, failedLookup);
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

test('trusted coverage credits the post-merge generated i18n test through the lint-baselines run line', () => {
  const generated = 'engine/test/scripts/control-ui-i18n.generated.test.ts';
  const files = [{ filename: generated, status: 'modified' }];
  const workflow = readFileSync(new URL('../.github/workflows/desktop-checks.yml', import.meta.url), 'utf8');
  const lintBaselines = readFileSync(
    new URL('../.github/workflows/engine-lint-baselines.yml', import.meta.url),
    'utf8',
  );
  assert.ok(coverageFromPrFiles(files, workflow).uncovered.includes(generated));
  assert.ok(
    !coverageFromPrFiles(files, workflow, [], '', '', [], lintBaselines).uncovered.includes(generated),
  );
});

function prDesktopJob(body) {
  return ['on:\n  pull_request:\njobs:\n  desktop:\n', body].join('');
}

function trustedUncovers(pr, file = 'desktop/scripts/new.test.mjs', mainFallback = '') {
  const files = [{ filename: file, status: 'added' }];
  const workflow = trustedDesktopWorkflow(pr, mainFallback) ?? '';
  return coverageFromPrFiles(files, workflow).uncovered.includes(file);
}

test('trusted desktop coverage reads the PR workflow and fails closed', () => {
  const files = [{ filename: 'desktop/scripts/component-release-readiness.test.mjs', status: 'added' }];
  const mainWorkflow = [
    'on:\n  pull_request:\n',
    '      - run: node --test scripts/release-inventory.test.mjs\n',
  ].join('');
  const prWorkflow = [
    'on:\n  pull_request:\n    paths: [desktop/**]\n',
    'jobs:\n',
    '  desktop:\n',
    '    name: Desktop on ${{ matrix.os }}\n',
    '    runs-on: ${{ matrix.os }}\n',
    '    strategy:\n',
    '      fail-fast: false\n',
    '      max-parallel: 3\n',
    '      matrix:\n',
    '        os: [windows-latest, macos-latest, ubuntu-latest]\n',
    '    steps:\n',
    '      - name: Build strict desktop sources\n',
    '        run: npm run build\n',
    '      - name: Check component release readiness\n',
    '        run: node --test scripts/component-release-readiness.test.mjs\n',
  ].join('');
  assert.equal(resolvePrDesktopWorkflow(null), null);
  assert.equal(resolvePrDesktopWorkflow(''), null);
  assert.equal(trustedDesktopWorkflow(null), null);
  assert.equal(trustedDesktopWorkflow(''), null);
  assert.ok(coverageFromPrFiles(files, mainWorkflow).uncovered.includes(
    'desktop/scripts/component-release-readiness.test.mjs',
  ));
  const workflow = trustedDesktopWorkflow(prWorkflow);
  assert.ok(!coverageFromPrFiles(files, workflow).uncovered.includes(
    'desktop/scripts/component-release-readiness.test.mjs',
  ));
});

test('trusted desktop coverage ignores comments, if: false, and non-pull_request workflows', () => {
  const files = [{ filename: 'desktop/scripts/new.test.mjs', status: 'added' }];
  const commented = [
    'on:\n  pull_request:\n',
    '      # run: node --test scripts/new.test.mjs\n',
    '      - run: node --test scripts/other.test.mjs\n',
  ].join('');
  const disabled = [
    'on:\n  pull_request:\n',
    '      - name: fake coverage\n',
    '        if: false\n',
    '        run: node --test scripts/new.test.mjs\n',
  ].join('');
  const pushOnly = [
    'on:\n  push:\n    branches: [main]\n',
    '      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.ok(coverageFromPrFiles(files, commented).uncovered.includes('desktop/scripts/new.test.mjs'));
  assert.ok(coverageFromPrFiles(files, disabled).uncovered.includes('desktop/scripts/new.test.mjs'));
  assert.equal(trustedDesktopWorkflow(pushOnly), '');
  assert.ok(coverageFromPrFiles(files, trustedDesktopWorkflow(pushOnly)).uncovered.includes(
    'desktop/scripts/new.test.mjs',
  ));
});

test('if: false after run does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - name: fake\n        run: node --test scripts/new.test.mjs\n        if: false\n',
  )), true);
});

test('if: false with a trailing comment does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - name: fake\n        if: false # skip\n        run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('if: always() && false does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - name: fake\n        if: always() && false\n        run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('if: ${{ 1 == 0 }} does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - name: fake\n        if: ${{ 1 == 0 }}\n        run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('if: ${{ !true }} does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - name: fake\n        if: ${{ !true }}\n        run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('job-level if: does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    if: false\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('dispatch-only job if: does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    if: github.event_name == \'workflow_dispatch\'\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('needs on a job that has if: does not cover a desktop test', () => {
  const pr = [
    'on:\n  pull_request:\njobs:\n',
    '  gate:\n    if: false\n    steps:\n      - run: echo skip\n',
    '  desktop:\n    needs: gate\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.equal(trustedUncovers(pr), true);
});

test('YAML anchors or aliases fall back to main and do not cover a PR-only test', () => {
  const pr = [
    'on:\n  pull_request:\njobs:\n',
    '  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
    '  unused: &decoy\n    if: false\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  const aliasOnly = [
    'on:\n  pull_request:\njobs:\n',
    '  desktop:\n    steps:\n      - <<: *decoy\n',
  ].join('');
  assert.equal(trustedUncovers(pr), true);
  assert.equal(trustedUncovers(aliasOnly), true);
});

test('matrix exclude does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob([
    '    strategy:\n      matrix:\n        os: [ubuntu-latest]\n',
    '        exclude:\n          - os: ubuntu-latest\n',
    '    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join(''))), true);
});

test('matrix include does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob([
    '    strategy:\n      matrix:\n        include:\n          - os: ubuntu-latest\n',
    '    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join(''))), true);
});

test('node --check combined with --test does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - run: node --check scripts/new.test.mjs --test scripts/new.test.mjs\n',
  )), true);
});

test('node --eval or -e combined with --test does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - run: node --eval "0" --test scripts/new.test.mjs\n',
  )), true);
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - run: node -e "0" --test scripts/new.test.mjs\n',
  )), true);
});

test('transitive needs through a disqualified job does not cover a desktop test', () => {
  const pr = [
    'on:\n  pull_request:\njobs:\n',
    '  gate:\n    if: false\n    steps:\n      - run: echo skip\n',
    '  mid:\n    needs: gate\n    steps:\n      - run: echo mid\n',
    '  extra:\n    needs: mid\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.equal(trustedUncovers(pr), true);
});

test('step continue-on-error does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - name: fake\n        continue-on-error: true\n        run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('step shell does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - name: fake\n        shell: bash\n        run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('step working-directory does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - name: fake\n        working-directory: desktop\n        run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('job continue-on-error does not cover a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    continue-on-error: true\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  )), true);
});

test('job defaults.run.working-directory: desktop still covers a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob([
    '    defaults:\n      run:\n        working-directory: desktop\n',
    '    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join(''))), false);
});

test('workflow defaults.run.shell does not cover a desktop test', () => {
  const pr = [
    'on:\n  pull_request:\n',
    'defaults:\n  run:\n    shell: bash\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.equal(trustedUncovers(pr), true);
});

test('workflow defaults.run.shell after jobs: does not cover a desktop test', () => {
  const pr = [
    'on:\n  pull_request:\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
    'defaults:\n  run:\n    shell: bash\n',
  ].join('');
  assert.equal(trustedUncovers(pr), true);
});

test('flow-style workflow defaults.run.shell does not cover a desktop test', () => {
  const pr = [
    'on:\n  pull_request:\n',
    'defaults: { run: { shell: bash } }\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.equal(trustedUncovers(pr), true);
});

test('workflow defaults.run.working-directory without shell still covers a desktop test', () => {
  const pr = [
    'on:\n  pull_request:\n',
    'defaults:\n  run:\n    working-directory: desktop\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.equal(trustedUncovers(pr), false);
});

test('workflow complex-key defaults.run.shell does not cover a desktop test', () => {
  const pr = [
    'on:\n  pull_request:\n',
    '? defaults\n',
    ': { run: { shell: bash } }\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.equal(trustedUncovers(pr), true);
});

test('plain workflow with no defaults still covers a desktop test', () => {
  assert.equal(trustedUncovers(prDesktopJob(
    '    steps:\n      - run: node --test scripts/new.test.mjs\n',
  )), false);
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
  // scripts/feature-batch-ci.mjs runs the feature tests from the PR checkout, so it is protected too.
  assert.deepEqual(summarizeGateFileChanges(files), [
    '.github/workflows/merge-gate.yml',
    'package.json',
    'scripts/feature-batch-ci.mjs',
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
  assert.ok(GATE_SCRIPTS.includes('scripts/check-commit-emails.mjs'));
  assert.ok(GATE_SCRIPTS.includes('scripts/check-commit-emails.test.mjs'));
  assert.ok(GATE_SCRIPTS.includes('scripts/check-ui-proof.mjs'));
  assert.ok(GATE_SCRIPTS.includes('scripts/check-ui-proof.test.mjs'));
  assert.ok(GATE_SCRIPTS.includes('scripts/merge-gate-rate-limit.mjs'));
  assert.ok(GATE_SCRIPTS.includes('scripts/merge-gate-rate-limit.test.mjs'));
  const trustedSource = readFileSync(new URL('./merge-gate-trusted.mjs', import.meta.url), 'utf8');
  assert.match(trustedSource, /from '\.\/check-ui-proof\.mjs'/);
  assert.match(trustedSource, /runUiProofFromPr\(/);
});

test('trusted gate runs the commit email checker on pull request commits', () => {
  const yaml = readFileSync(new URL(`../${TRUSTED_WORKFLOW_PATH}`, import.meta.url), 'utf8');
  assert.match(yaml, /^\s+run:\s*node --test scripts\/merge-gate-trusted\.test\.mjs\s*$/m);
  assert.match(yaml, /node --test scripts\/merge-gate-rate-limit\.test\.mjs scripts\/check-gate-files-fresh\.test\.mjs/);
  assert.match(yaml, /^\s+run:\s*node --test scripts\/check-commit-emails\.test\.mjs\s*$/m);
  assert.match(yaml, /^\s+run:\s*node scripts\/check-commit-emails\.mjs\s*$/m);
  assert.match(yaml, /PR_NUMBER:\s*\$\{\{\s*github\.event\.pull_request\.number\s*\}\}/);
  assert.doesNotMatch(yaml, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(?:sha|ref)/);
});

test('trusted gate re-runs the UI screenshot proof check from main', () => {
  assert.ok(GATE_SCRIPTS.includes('scripts/check-ui-proof.mjs'));
  assert.ok(GATE_SCRIPTS.includes('scripts/check-ui-proof.test.mjs'));
});

test('trusted gate includes and runs the SELF-CHECK body check from main', () => {
  assert.ok(GATE_SCRIPTS.includes('scripts/check-self-check.mjs'));
  assert.ok(GATE_SCRIPTS.includes('scripts/check-self-check.test.mjs'));
  const source = readFileSync(new URL('./merge-gate-trusted.mjs', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/check-self-check\.mjs'/);
  assert.match(source, /if \(!runSelfCheckFromPr\(process\.env\.HEAD_BRANCH, body\)\) process\.exit\(1\)/);
  assert.match(source, /if \([^\n]*!process\.env\.HEAD_BRANCH\)/);
  assert.match(source, /Missing required environment variables:[^\n]*HEAD_BRANCH/);
});

test('trusted SELF-CHECK runner rejects missing trunk block and skips other branches', () => {
  assert.equal(gate.runSelfCheckFromPr('trunk/x', 'no block'), false);
  assert.equal(gate.runSelfCheckFromPr('cursor/x', ''), true);
});

test('SELF-CHECK workflow wiring reruns edits and never interpolates body or branch into shell', () => {
  const ordinary = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  const trusted = readFileSync(new URL(`../${TRUSTED_WORKFLOW_PATH}`, import.meta.url), 'utf8');
  assert.match(trusted, /HEAD_BRANCH:\s*\$\{\{\s*github\.event\.pull_request\.head\.ref\s*\}\}/);
  assert.match(ordinary, /^\s+run:\s*node --test scripts\/check-self-check\.test\.mjs\s*$/m);
  assert.match(ordinary, /^\s+run:\s*node scripts\/check-self-check\.mjs\s*$/m);
  for (const yaml of [ordinary, trusted]) {
    assert.match(yaml, /^\s+types:.*\bedited\b/m);
    assert.doesNotMatch(yaml, /^\s+run:.*github\.event\.pull_request\.(?:body|head\.ref)/m);
    const lines = yaml.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!/^\s+run:\s*[|>]/.test(lines[i])) continue;
      const indent = lines[i].match(/^ */)[0].length;
      for (let j = i + 1; j < lines.length && (!lines[j].trim() || lines[j].match(/^ */)[0].length > indent); j += 1) {
        assert.doesNotMatch(lines[j], /github\.event\.pull_request\.(?:body|head\.ref)/);
      }
    }
  }
});

test('merge-gate does not retrigger on ready_for_review and cancel its waiting run', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^  pull_request:\s*$/m);
  assert.doesNotMatch(yaml, /^\s+types:.*ready_for_review/m);
});

test('merge-gate edited trigger does not cancel an in-progress wait', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(yaml, /types:\s*\[[^\]]*edited[^\]]*\]/);
  assert.match(yaml, /cancel-in-progress:\s*\$\{\{\s*github\.event\.action\s*!=\s*'edited'\s*\}\}/);
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

test('merge-gate recheck fires on every completed run, so no check can drift out of its filter', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate-recheck.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(yaml, /^\s+workflows:/m);
  assert.match(yaml, /types: \[completed\]/);
});

test('ordinary JS waiter additions stay aligned with the yaml jq filters', () => {
  const yaml = ordinaryYaml();
  assert.match(yaml, /node scripts\/merge-gate-rate-limit\.mjs gh --/);
  assert.match(yaml, /PR_NUMBER:/);
  assert.match(yaml, /BASE_REF:/);
  assert.deepEqual(COLLAPSIBLE_CHECK_EVENTS, ['pull_request', 'pull_request_target']);
  const collapse = ordinaryCollapseFilter(yaml);
  for (const event of COLLAPSIBLE_CHECK_EVENTS) assert.match(collapse, new RegExp(event));
  const identity = JSON.parse(jqProgram(ordinaryIdentityFilter(yaml), {
    path: '.github/workflows/desktop-checks.yml',
    name: 'Desktop',
    id: 410,
    event: 'pull_request',
    check_suite_id: 501,
    head_sha: SHA,
    pull_requests: [
      { number: PR_NUMBER, base: { ref: BASE_REF, sha: 'base-sha' } },
      { number: 12 },
    ],
  }));
  const mapped = workflowFromActionsRun({
    path: '.github/workflows/desktop-checks.yml',
    name: 'Desktop',
    id: 410,
    event: 'pull_request',
    check_suite_id: 501,
    head_sha: SHA,
    pull_requests: [
      { number: PR_NUMBER, base: { ref: BASE_REF, sha: 'base-sha' } },
      { number: 12 },
    ],
  });
  assert.equal(identity.path, mapped.path);
  assert.equal(identity.event, mapped.event);
  assert.equal(identity.headSha, mapped.headSha);
  assert.equal(identity.checkSuiteId, mapped.checkSuiteId);
  assert.deepEqual(identity.pullRequests, mapped.pullRequests.map((pr) => ({
    number: pr.number,
    base: pr.base ?? null,
  })));
  assert.equal(jqProgram(ordinaryIdentityFilter(yaml), { name: 'no-path' }).trim(), 'null');
  assert.deepEqual(JSON.parse(jqProgram(ordinaryDuplicateIdsFilter(yaml), [
    { id: 1, name: 'build' },
    { id: 2, name: 'test' },
    { id: 3, name: 'build' },
  ])).sort((a, b) => a - b), [1, 3]);

  const nameFilter = ordinaryCheckRunsFilter(yaml);
  const failedFilter = yaml.match(/failed=\$\(jq -r '([^']+)'/)[1];
  const pendingFilter = yaml.match(/pending=\$\(jq '([^']+)'/)[1];
  const passList = failedFilter.match(/IN\(([^)]*)\)/)[1]
    .split(',')
    .map((item) => item.trim().replaceAll('"', ''))
    .sort();
  assert.deepEqual([...PASS_CONCLUSIONS].sort(), passList);
  assert.deepEqual([...ORDINARY_PASS_CONCLUSIONS].sort(), passList);
  const align = (runs, workflowsByCheckId, context = prContext) => {
    const js = evaluateOrdinaryChecks(runs, { workflowsByCheckId, ...context });
    const named = JSON.parse(jqProgram(nameFilter, { check_runs: runs }));
    const collapsed = JSON.parse(execFileSync('jq', [
      '--argjson', 'attrs', JSON.stringify(workflowsByCheckId),
      '--arg', 'sha', context.sha ?? '',
      '--arg', 'pr', context.prNumber == null ? '' : String(context.prNumber),
      '--arg', 'base', context.baseRef ?? '',
      collapse,
    ], {
      input: JSON.stringify(named),
      encoding: 'utf8',
      windowsHide: true,
    }));
    const sortIds = (items) => items.map((run) => run.id).sort((a, b) => a - b);
    assert.deepEqual(sortIds(collapsed), sortIds(js.others));
    const failed = execFileSync('jq', ['-r', failedFilter], {
      input: JSON.stringify(collapsed),
      encoding: 'utf8',
      windowsHide: true,
    }).trim().split(/\r?\n/).filter(Boolean).sort();
    assert.deepEqual(failed, js.failed.map((run) => `${run.name}: ${run.conclusion}`).sort());
    const pending = Number(execFileSync('jq', [pendingFilter], {
      input: JSON.stringify(collapsed),
      encoding: 'utf8',
      windowsHide: true,
    }));
    assert.equal(pending, js.pending.length);
  };
  const desktop = (id, suite, patch = {}) => ({
    id,
    app: { id: 15368 },
    name: 'Desktop on windows-latest',
    status: 'completed',
    conclusion: 'success',
    check_suite: { id: suite },
    ...patch,
  });
  const desktopWorkflow = (suite, patch = {}) => ({
    path: '.github/workflows/desktop-checks.yml',
    event: 'pull_request',
    headSha: SHA,
    checkSuiteId: suite,
    pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
    ...patch,
  });
  const older = desktop(90, 490, { conclusion: 'failure' });
  const newer = desktop(110, 501);
  align(
    [passCheckRuns[0], older, newer, analyzeCheck],
    { 90: desktopWorkflow(490), 110: desktopWorkflow(501) },
  );
  align(
    [newer, older, analyzeCheck],
    {
      90: desktopWorkflow(490, { path: '.github/workflows/engine-handoff-checks.yml' }),
      110: desktopWorkflow(501),
    },
  );
  align([older, newer, analyzeCheck], { 110: desktopWorkflow(501) });
  align([older, newer, analyzeCheck], {});
  align(
    [older, { ...newer, status: 'queued', conclusion: null }, analyzeCheck],
    { 90: desktopWorkflow(490), 110: desktopWorkflow(501) },
  );
  align(
    [desktop(90, 501, { conclusion: 'failure' }), desktop(110, 501), analyzeCheck],
    { 90: desktopWorkflow(501), 110: desktopWorkflow(501) },
  );
  align(
    [desktop(90, 501, { status: 'in_progress', conclusion: null }), desktop(110, 501), analyzeCheck],
    { 90: desktopWorkflow(501), 110: desktopWorkflow(501) },
  );
  align(
    [older, desktop(110, 501, { conclusion: 'skipped' }), analyzeCheck],
    { 90: desktopWorkflow(490), 110: desktopWorkflow(501) },
  );
  align(
    [older, desktop(110, 501, { conclusion: 'neutral' }), analyzeCheck],
    { 90: desktopWorkflow(490), 110: desktopWorkflow(501) },
  );
  align(
    [older, newer, analyzeCheck],
    { 90: desktopWorkflow(490), 110: desktopWorkflow(501, { event: 'workflow_dispatch' }) },
  );
  align(
    [older, newer, analyzeCheck],
    { 90: desktopWorkflow(490), 110: desktopWorkflow(501, { headSha: 'other-sha' }) },
  );
  align(
    [older, newer, analyzeCheck],
    { 90: desktopWorkflow(490), 110: desktopWorkflow(501, { checkSuiteId: 999 }) },
  );
  align(
    [older, newer, analyzeCheck],
    { 90: desktopWorkflow(490), 110: desktopWorkflow(501, { pullRequests: [{ number: 900, base: BASE_REF }] }) },
  );
  align([...harvestCancelledChecks, ...harvestPassingChecks, analyzeCheck], harvestWorkflows);
  align([...harvestCancelledChecks, analyzeCheck], harvestWorkflows);
  align(
    [
      harvestJob(90, 'select', 490, 90, 'failure'),
      harvestJob(110, 'select', harvestPassingSuite, harvestPassingRun, 'skipped'),
      analyzeCheck,
    ],
    {
      90: harvestWorkflow(490, 90),
      110: harvestWorkflow(harvestPassingSuite, harvestPassingRun),
    },
  );
  align(realBuildPair, {
    112992933987: {
      path: '.github/workflows/visual-tour.yml',
      event: 'pull_request',
      headSha: SHA,
      checkSuiteId: 102080051817,
      pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
    },
    113023525061: {
      path: '.github/workflows/engine-build-pr.yml',
      event: 'pull_request',
      headSha: SHA,
      checkSuiteId: 102080051207,
      pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
    },
  });
  align([older, newer, analyzeCheck], {
    90: desktopWorkflow(490),
    110: desktopWorkflow(501),
  }, {});

  const pair = evaluateOrdinaryChecks(realBuildPair);
  assert.equal(pair.failed.map((run) => `${run.name}: ${run.conclusion}`).join('\n'), 'build: failure');
  const ignored = evaluateOrdinaryChecks(passCheckRuns);
  assert.equal(ignored.others.some((run) => run.name === 'merge-gate-trusted'), false);
  assert.equal(ignored.others.some((run) => run.name === 'merge-gate'), false);
  const page1 = {
    total_count: 101,
    check_runs: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: index === 0 ? 'Analyze (actions)' : `ok-${index}`,
      status: 'completed',
      conclusion: 'success',
    })),
  };
  const page2 = {
    total_count: 101,
    check_runs: [{
      id: 101,
      name: 'Named feature tests on ubuntu-latest (9/10)',
      status: 'completed',
      conclusion: 'failure',
    }],
  };
  const ordinary = fetchOrdinaryCheckRuns('example/repo', SHA, 'unused', { mode: 'all' }, {
    request: (requestPath) => (requestPath.endsWith('page=1') ? page1 : page2),
  });
  assert.equal(ordinary.length, 101);
  assert.equal(evaluateOrdinaryChecks(ordinary).failed[0].conclusion, 'failure');
  const ordinaryCode = pollOrdinaryGate({
    repo: 'example/repo', sha: SHA, token: 'unused', initialWait: 0, waitBudgetSeconds: 30, maxPolls: 1,
  }, {
    fetchChecks: () => [
      { ...passCheckRuns[1], status: 'in_progress', conclusion: null },
      analyzeCheck,
    ],
    sleep: () => {},
    now: () => 0,
    log: () => {},
    error: () => {},
    resolveWorkflows: () => ({}),
  });
  assert.equal(ordinaryCode, 1);
  assert.match(formatOrdinaryTimeout([{ name: 'build' }]), /Timed out waiting for: build/);
});

const REVIEW_HEAD = '0123456789abcdef0123456789abcdef01234567';
const REVIEW_OLD = 'fedcba9876543210fedcba9876543210fedcba98';

function reviewChange(changedFiles, body, headSha = REVIEW_HEAD) {
  return evaluateGateChangeReview({ changedFiles, body, headSha });
}

test('protected paths reuse the gate file lists and the scripts merge-gate runs', () => {
  const paths = loadProtectedGatePaths();
  for (const file of listedGateFiles()) assert.ok(paths.has(file), file);
  assert.equal(GATE_SCRIPTS.includes('scripts/check-copied-csv.mjs'), false);
  assert.ok(paths.has('scripts/check-copied-csv.mjs'));
  assert.ok(paths.has('scripts/check-copied-csv.test.mjs'));
  assert.ok(paths.has('scripts/check-commit-emails.mjs'));
  assert.ok(paths.has('scripts/check-commit-emails.test.mjs'));
  assert.ok(paths.has('scripts/check-gate-files-fresh.test.mjs'));
  const owners = reviewChange(['engine/.github/CODEOWNERS'], '');
  assert.equal(owners.ok, false);
  assert.deepEqual(owners.protectedFiles, ['engine/.github/CODEOWNERS']);
});

test('no protected files means the gate change review passes', () => {
  const result = reviewChange(['README.md', 'window/src/app.tsx'], '');
  assert.equal(result.ok, true);
  assert.equal(result.touched, false);
  assert.equal(result.markerMatched, false);
  assert.deepEqual(result.protectedFiles, []);
  const summary = formatGateChangeReviewSummary(result);
  assert.match(summary, /Protected files touched: no/);
  assert.match(summary, /Marker matched: no/);
});

test('a protected file with no marker fails the gate change review', () => {
  const result = reviewChange(['scripts/merge-gate-trusted.mjs'], 'Reviewed offline.\n');
  assert.equal(result.ok, false);
  assert.equal(result.touched, true);
  assert.equal(result.markerMatched, false);
  assert.deepEqual(result.protectedFiles, ['scripts/merge-gate-trusted.mjs']);
  assert.match(result.message, /scripts\/merge-gate-trusted\.mjs/);
  assert.ok(result.message.includes(GATE_CHANGE_REVIEW_REQUIRED));
  const summary = formatGateChangeReviewSummary(result);
  assert.match(summary, /Protected files touched: yes/);
  assert.match(summary, /`scripts\/merge-gate-trusted\.mjs`/);
  assert.match(summary, /Marker matched: no/);
});

test('a gate-change-reviewed marker for an older SHA fails', () => {
  const body = `gate-change-reviewed: ${REVIEW_OLD}\n`;
  const result = reviewChange(['scripts/check-commit-emails.mjs'], body);
  assert.equal(result.ok, false);
  assert.equal(result.markerMatched, false);
  assert.match(result.message, /scripts\/check-commit-emails\.mjs/);
  assert.ok(result.message.includes(GATE_CHANGE_REVIEW_REQUIRED));
  assert.match(result.message, new RegExp(`does not match the current head ${REVIEW_HEAD}`));
  const padded = reviewChange(
    ['scripts/check-commit-emails.mjs'],
    `gate-change-reviewed: ${REVIEW_HEAD} \n`,
  );
  assert.equal(padded.ok, false);
});

test('a gate-change-reviewed marker for the current head SHA passes', () => {
  const body = [
    'Workflow and gate files reviewed on this head.',
    `gate-change-reviewed: ${REVIEW_OLD}`,
    `gate-change-reviewed: ${REVIEW_HEAD}`,
  ].join('\n');
  const result = reviewChange(['.github/workflows/merge-gate.yml', 'CODEOWNERS'], body);
  assert.equal(result.ok, true);
  assert.equal(result.touched, true);
  assert.equal(result.markerMatched, true);
  assert.deepEqual(result.protectedFiles, [
    '.github/workflows/merge-gate.yml',
    'CODEOWNERS',
  ]);
  assert.equal(result.message, '');
  const summary = formatGateChangeReviewSummary(result);
  assert.match(summary, /Protected files touched: yes/);
  assert.match(summary, /Marker matched: yes/);
  assert.match(summary, /`CODEOWNERS`/);
});

test('a desktop-checks.yml-only change is a protected gate change', () => {
  const file = '.github/workflows/desktop-checks.yml';
  const result = reviewChange([file], '');
  assert.equal(result.ok, false);
  assert.deepEqual(result.protectedFiles, [file]);
  assert.match(result.message, /desktop-checks\.yml/);
  assert.ok(result.message.includes(GATE_CHANGE_REVIEW_REQUIRED));
  const summary = formatGateChangeReviewSummary(result);
  assert.match(summary, /Protected files touched: yes/);
  assert.match(summary, /desktop-checks\.yml/);
  assert.match(summary, /Marker matched: no/);
});

test('a deleted protected gate file with no marker is flagged', () => {
  const changedFiles = changedFilesFromPrFiles([
    { filename: 'scripts/merge-gate-trusted.mjs', status: 'removed' },
  ]);
  assert.deepEqual(changedFiles, ['scripts/merge-gate-trusted.mjs']);
  const result = reviewChange(changedFiles, '');
  assert.equal(result.ok, false);
  assert.equal(result.touched, true);
  assert.equal(result.markerMatched, false);
  assert.deepEqual(result.protectedFiles, ['scripts/merge-gate-trusted.mjs']);
  assert.match(result.message, /scripts\/merge-gate-trusted\.mjs/);
  assert.ok(result.message.includes(GATE_CHANGE_REVIEW_REQUIRED));
});

test('a renamed protected gate file with no marker is flagged', () => {
  const changedFiles = changedFilesFromPrFiles([
    {
      filename: 'docs/desktop-checks.yml',
      previous_filename: '.github/workflows/desktop-checks.yml',
      status: 'renamed',
    },
  ]);
  assert.deepEqual(changedFiles, [
    'docs/desktop-checks.yml',
    '.github/workflows/desktop-checks.yml',
  ]);
  const result = reviewChange(changedFiles, '');
  assert.equal(result.ok, false);
  assert.equal(result.touched, true);
  assert.equal(result.markerMatched, false);
  assert.deepEqual(result.protectedFiles, ['.github/workflows/desktop-checks.yml']);
  assert.match(result.message, /\.github\/workflows\/desktop-checks\.yml/);
  assert.ok(result.message.includes(GATE_CHANGE_REVIEW_REQUIRED));
});

test('a docs-only change is not a protected gate change', () => {
  const result = reviewChange(['docs/CHECKPOINT.md'], '');
  assert.equal(result.ok, true);
  assert.equal(result.touched, false);
  assert.deepEqual(result.protectedFiles, []);
  const summary = formatGateChangeReviewSummary(result);
  assert.match(summary, /Protected files touched: no/);
  assert.match(summary, /Marker matched: no/);
});

const baselineOnMain = JSON.stringify({
  version: 1,
  problems: {
    'sidebar :: Builder': ['row-actions-inconsistent'],
    'sidebar :: Researcher': ['row-actions-inconsistent'],
  },
}, null, 2);

test('a grown button-crawl baseline is a protected gate change', () => {
  const head = JSON.stringify({
    version: 1,
    problems: {
      'sidebar :: Builder': ['dead', 'row-actions-inconsistent'],
      'sidebar :: Researcher': ['row-actions-inconsistent'],
    },
  });
  assert.equal(buttonCrawlBaselineGrew(baselineOnMain, head), true);
  assert.equal(buttonCrawlBaselineGrew(baselineOnMain, '{'), true);
  assert.equal(buttonCrawlBaselineGrowth({
    files: [{ filename: BUTTON_CRAWL_BASELINE, status: 'modified' }],
    baseText: baselineOnMain,
    headText: head,
  }), true);
  const result = evaluateGateChangeReview({
    changedFiles: [BUTTON_CRAWL_BASELINE],
    body: '',
    headSha: REVIEW_HEAD,
    baselineGrew: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.touched, true);
  assert.deepEqual(result.protectedFiles, [BUTTON_CRAWL_BASELINE]);
  assert.match(result.message, /scripts\/button-crawl\/baseline\.json/);
  assert.match(result.message, /entry that main does not/);
  assert.ok(result.message.includes(GATE_CHANGE_REVIEW_REQUIRED));
  const signed = evaluateGateChangeReview({
    changedFiles: [BUTTON_CRAWL_BASELINE],
    body: `gate-change-reviewed: ${REVIEW_HEAD}\n`,
    headSha: REVIEW_HEAD,
    baselineGrew: true,
  });
  assert.equal(signed.ok, true);
});

test('a shrunk button-crawl baseline is not a protected gate change', () => {
  const head = JSON.stringify({
    version: 1,
    problems: {
      'sidebar :: Researcher': ['row-actions-inconsistent'],
    },
  });
  assert.equal(buttonCrawlBaselineGrew(baselineOnMain, head), false);
  assert.equal(buttonCrawlBaselineGrew(baselineOnMain, null), false);
  const result = evaluateGateChangeReview({
    changedFiles: [BUTTON_CRAWL_BASELINE],
    body: '',
    headSha: REVIEW_HEAD,
    baselineGrew: false,
  });
  assert.equal(result.ok, true);
  assert.equal(result.touched, false);
  assert.deepEqual(result.protectedFiles, []);
});

test('an unchanged button-crawl baseline is not a protected gate change', () => {
  assert.equal(buttonCrawlBaselineGrew(baselineOnMain, baselineOnMain), false);
  assert.equal(buttonCrawlBaselineGrew(baselineOnMain, `${baselineOnMain}\n`), false);
  assert.equal(buttonCrawlBaselineGrowth({
    files: [{ filename: 'README.md', status: 'modified' }],
    baseText: '{}',
    headText: baselineOnMain,
  }), false);
  const result = reviewChange([BUTTON_CRAWL_BASELINE], '');
  assert.equal(result.ok, true);
  assert.deepEqual(result.protectedFiles, []);
});

test('reordering the button-crawl baseline is not growth', () => {
  const reordered = JSON.stringify({
    problems: {
      'sidebar :: Researcher': ['row-actions-inconsistent'],
      'sidebar :: Builder': ['row-actions-inconsistent'],
    },
  });
  assert.equal(buttonCrawlBaselineGrew(baselineOnMain, reordered), false);
  const flipped = JSON.stringify({ problems: { 'place:overview :: Export': ['slow', 'dead'] } });
  const flippedBase = '{\n  "problems": {\n    "place:overview :: Export": ["dead", "slow"]\n  }\n}\n';
  assert.equal(buttonCrawlBaselineGrew(flippedBase, flipped), false);
});

test('button-crawl baseline growth tests run in the changed-test-coverage job', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^\s+run:\s*node --test scripts\/merge-gate-trusted\.test\.mjs\s*$/m);
  assert.doesNotMatch(yaml, /merge-gate-trusted\.test\.mjs -t /);
});

test('merge-gate-trusted still reruns when the pull request body is edited', () => {
  const yaml = readFileSync(new URL(`../${TRUSTED_WORKFLOW_PATH}`, import.meta.url), 'utf8');
  assert.match(yaml, /pull_request_target:/);
  assert.match(yaml, /types:\s*\[opened, synchronize, reopened, ready_for_review, edited\]/);
  assert.match(yaml, /cancel-in-progress:\s*\$\{\{\s*github\.event\.action\s*!=\s*'edited'\s*\}\}/);
  assert.match(yaml, /SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  const source = readFileSync(new URL('./merge-gate-trusted.mjs', import.meta.url), 'utf8');
  assert.match(source, /fetchPrFiles\(repo, prNumber, token\)/);
  assert.match(source, /changedFilesFromPrFiles\(files\)/);
  assert.match(source, /buttonCrawlBaselineGrowth\(\{/);
  assert.match(source, /fetchFileText\(repo, baseRef, token, BUTTON_CRAWL_BASELINE\)/);
  assert.match(source, /fetchFileText\(repo, sha, token, BUTTON_CRAWL_BASELINE\)/);
  assert.match(source, /evaluateGateChangeReview\(\{ changedFiles, body, headSha: sha, baselineGrew \}\)/);
  assert.match(source, /writeSummary\(formatGateChangeReviewSummary\(review\)\)/);
  assert.match(source, /if \(!review\.ok\)/);
});

// Attribution from one head runs listing: one API call per evaluation instead of one per check run.
const attrRun = { id: 555, path: '.github/workflows/feature-batch-checks.yml', name: 'Feature batch checks', event: 'pull_request', check_suite_id: 900, head_sha: 'abc', pull_requests: [] };
const attrCheck = (overrides = {}) => ({ id: 7001, name: 'Named feature tests', head_sha: 'abc', details_url: 'https://github.com/o/r/actions/runs/555/job/9', check_suite: { id: 900 }, ...overrides });

test('a check run is attributed from the listing only when its check suite is the run\'s own suite', () => {
  const runsById = new Map([['555', attrRun]]);
  assert.equal(gate.runIdFromCheckRun(attrCheck()), '555');
  assert.equal(gate.attributeFromRunList(attrCheck(), runsById).path, '.github/workflows/feature-batch-checks.yml');
  assert.equal(gate.attributeFromRunList(attrCheck({ check_suite: { id: 901 } }), runsById), null, 'a different suite is not attributed');
  assert.equal(gate.attributeFromRunList(attrCheck({ details_url: 'https://github.com/o/r/actions/runs/999' }), runsById), null);
});

test('one listing attributes every check it covers, and only the rest use a per-check lookup', () => {
  const listing = { total_count: 1, workflow_runs: [attrRun] };
  const calls = { list: 0, lookup: [] };
  const fetchRuns = () => { calls.list += 1; return new Map(listing.workflow_runs.map((run) => [String(run.id), run])); };
  const resolveWorkflow = (_repo, _token, check) => { calls.lookup.push(check.id); return { path: 'fallback.yml' }; };
  const checks = [attrCheck(), attrCheck({ id: 7002, details_url: 'https://github.com/o/r/actions/runs/777/job/1' })];
  const map = gate.resolveWorkflowsForCheckRuns('o/r', 't', checks, { fetchRuns, resolveWorkflow });
  assert.equal(calls.list, 1, 'one listing per evaluation');
  assert.deepEqual(calls.lookup, [7002], 'only the check the listing does not cover falls back');
  assert.equal(map[7001].path, '.github/workflows/feature-batch-checks.yml');
  assert.equal(map[7002].path, 'fallback.yml');
});

test('an incomplete head listing is not trusted: every check falls back to its own lookup', () => {
  const api = () => ({ total_count: 250, workflow_runs: [attrRun] });
  assert.equal(gate.fetchRunsByIdForHead('o/r', 't', 'abc', { api }).size, 0);
  const complete = () => ({ total_count: 1, workflow_runs: [attrRun] });
  assert.equal(gate.fetchRunsByIdForHead('o/r', 't', 'abc', { api: complete }).get('555').id, 555);
});

test('regression: a thrown attribution lookup is never reported as a forged trusted check', () => {
  const checkRuns = [...passCheckRuns, {
    id: 777, name: 'merge-gate-trusted', status: 'completed', conclusion: 'success',
    check_suite: { id: 909 }, details_url: 'https://github.com/example/repo/actions/runs/304/job/777',
  }];
  const result = evaluateTrustedGate({
    checkRuns,
    workflowsByCheckId: { ...passWorkflows, 777: { lookupFailed: true, error: 'API rate limit exceeded' } },
    changedFiles: ['README.md'],
    coreWorkflows,
    currentRunId: CURRENT_RUN_ID,
    ...prContext,
  });
  assert.equal(result.foreignTrusted.length, 0);
  assert.deepEqual(result.lookupFailed.map((run) => run.id), [777]);
  assert.equal(result.ready, false);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.errors.join('\n'), /Forged/);
});

test('regression: a lookup still failing at the budget fails closed with an attribution message, not forged', () => {
  const checkRuns = [...passCheckRuns, {
    id: 777, name: 'merge-gate-trusted', status: 'completed', conclusion: 'success',
    check_suite: { id: 909 }, details_url: 'https://github.com/example/repo/actions/runs/304/job/777',
  }];
  let clock = 0;
  const logged = [];
  const code = gate.pollTrustedGateWithBudget({
    repo: 'example/repo', sha: 'abc', token: 'unused', changedFiles: ['README.md'], coreWorkflows,
    currentRunId: CURRENT_RUN_ID, prNumber: '1', baseRef: 'main', maxAttempts: 64, pollSeconds: 30,
    waitBudgetSeconds: 60, startedAt: 0,
  }, {
    fetchChecks: () => checkRuns,
    resolveWorkflows: () => ({ ...passWorkflows, 777: { lookupFailed: true, error: 'API rate limit exceeded' } }),
    sleep: (seconds) => { clock += seconds * 1000; },
    now: () => clock,
    log: () => {},
    error: (message) => logged.push(message),
  });
  assert.equal(code, 1);
  const text = logged.join('\n');
  assert.match(text, /Attribution lookup failed for merge-gate-trusted check\(s\) 777/);
  assert.doesNotMatch(text, /Forged/);
});

test('a skipped feature-batch job is missing, not a pass, when its paths changed', () => {
  const featureBatch = {
    path: '.github/workflows/feature-batch-checks.yml',
    pullRequestPaths: ['engine/**', 'window/**'],
  };
  const checkRun = (conclusion) => ({ id: 9001, name: 'Named feature tests on ubuntu-latest (1/7)', status: 'completed', conclusion });
  const workflows = { 9001: { id: 7, path: '.github/workflows/feature-batch-checks.yml', event: 'pull_request' } };
  const skipped = missingCoreWorkflows({
    checkRuns: [checkRun('skipped')],
    workflowsByCheckId: workflows,
    changedFiles: ['engine/src/gateway/contacts.ts'],
    coreWorkflows: [featureBatch],
  });
  assert.ok(skipped.some((item) => item.includes('feature-batch-checks.yml') && item.includes('skipped')), skipped.join('\n'));
  const passed = missingCoreWorkflows({
    checkRuns: [checkRun('success')],
    workflowsByCheckId: workflows,
    changedFiles: ['engine/src/gateway/contacts.ts'],
    coreWorkflows: [featureBatch],
  });
  assert.equal(passed.filter((item) => item.includes('feature-batch-checks.yml')).length, 0);
});

test('regression: an outage listing the head runs falls back to per-check lookups instead of crashing', () => {
  const checks = [{ id: 601, name: 'merge-gate-trusted', check_suite: { id: 204 } }];
  const workflows = gate.resolveWorkflowsForCheckRuns('example/repo', 'unused', checks, {
    attributionCache: new Map(),
    fetchRuns: () => { throw new Error('gh: API rate limit exceeded (HTTP 403)'); },
    resolveWorkflow: () => earlierTrustedWorkflow,
  });
  assert.deepEqual(workflows, { 601: earlierTrustedWorkflow });
});

test('regression: an outage on both the listing and the per-check lookups is pending, not forged', () => {
  const checks = [{ id: 602, name: 'merge-gate-trusted', check_suite: { id: 205 } }];
  const workflows = gate.resolveWorkflowsForCheckRuns('example/repo', 'unused', checks, {
    attributionCache: new Map(),
    fetchRuns: () => { throw new Error('gh: Server Error (HTTP 502)'); },
    resolveWorkflow: () => { throw new Error('gh: Server Error (HTTP 502)'); },
  });
  assert.equal(workflows[602].lookupFailed, true);
  assert.equal(gate.findForeignTrustedChecks(checks, workflows, { allowedRunId: CURRENT_RUN_ID }).length, 0);
});
