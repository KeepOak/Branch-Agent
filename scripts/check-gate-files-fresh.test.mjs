import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GATE_SCRIPTS } from './merge-gate-trusted.mjs';
import {
  GATE_WORKFLOW_FILES,
  KEEP_MAIN_MESSAGE,
  checkPullRequest,
  evaluateGateFiles,
  forkPointSha,
  formatReport,
  listedGateFiles,
} from './check-gate-files-fresh.mjs';

const GATE = '.github/workflows/merge-gate.yml';
const gateFiles = [GATE];

function reportFor(input) {
  return formatReport(evaluateGateFiles(input));
}

test('an untouched gate file passes', () => {
  const result = evaluateGateFiles({
    changedFiles: ['README.md'],
    gateFiles,
    prCommits: [{ sha: 'pr1', parents: [{ sha: 'fork0' }] }],
    mergeBaseSha: 'fork0',
    fileSnapshots: {
      [GATE]: {
        fork: 'keep\n',
        main: 'keep\nadded-on-main\n',
        head: 'keep\n',
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.deepEqual(result.results, []);
});

test('a PR that adds lines on top of main passes', () => {
  const result = evaluateGateFiles({
    changedFiles: [GATE],
    gateFiles,
    prCommits: [{ sha: 'pr1', parents: [{ sha: 'fork0' }] }],
    mergeBaseSha: 'fork0',
    fileSnapshots: {
      [GATE]: {
        fork: 'keep\n',
        main: 'keep\nadded-on-main\n',
        head: 'keep\nadded-on-main\npr-addition\n',
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
  assert.equal(result.results[0].ok, true);
});

test('a stale copy missing a line main added later fails and names the line', () => {
  const result = evaluateGateFiles({
    changedFiles: [GATE],
    gateFiles,
    prCommits: [{ sha: 'pr1', parents: [{ sha: 'fork0' }] }],
    mergeBaseSha: 'fork0',
    fileSnapshots: {
      [GATE]: {
        fork: 'keep\n',
        main: 'keep\nadded-on-main\n',
        head: 'keep\npr-only\n',
      },
    },
    lineCommits: {
      [GATE]: { 'added-on-main': 'mainadd1' },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.results[0].dropped[0].line, 'added-on-main');
  assert.equal(result.results[0].dropped[0].commit, 'mainadd1');
  const report = formatReport(result);
  assert.match(report, /added-on-main/);
  assert.match(report, /mainadd1/);
  assert.ok(report.includes(KEEP_MAIN_MESSAGE));
});

test('merged main in but kept the old copy fails', () => {
  const prCommits = [
    { sha: 'pr1', parents: [{ sha: 'fork0' }] },
    { sha: 'merge1', parents: [{ sha: 'pr1' }, { sha: 'main-new' }] },
  ];
  assert.equal(forkPointSha({ commits: prCommits, mergeBaseSha: 'main-new' }), 'fork0');
  const result = evaluateGateFiles({
    changedFiles: [GATE],
    gateFiles,
    prCommits,
    mergeBaseSha: 'main-new',
    fileSnapshots: {
      [GATE]: {
        fork: 'keep\n',
        main: 'keep\nadded-after-fork\n',
        head: 'keep\n',
      },
    },
    lineCommits: {
      [GATE]: { 'added-after-fork': 'mainadd2' },
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.forkPoint, 'fork0');
  assert.notEqual(result.forkPoint, 'main-new');
  assert.equal(result.results[0].dropped[0].line, 'added-after-fork');
  assert.ok(formatReport(result).includes(KEEP_MAIN_MESSAGE));
});

test('a deliberate edit that changes a line which existed at the fork point passes', () => {
  const result = evaluateGateFiles({
    changedFiles: [GATE],
    gateFiles,
    prCommits: [{ sha: 'pr1', parents: [{ sha: 'fork0' }] }],
    mergeBaseSha: 'fork0',
    fileSnapshots: {
      [GATE]: {
        fork: 'keep\nedit-me\n',
        main: 'keep\nedit-me\n',
        head: 'keep\nedited\n',
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.results[0].ok, true);
  assert.equal(reportFor({
    changedFiles: [GATE],
    gateFiles,
    prCommits: [{ sha: 'pr1', parents: [{ sha: 'fork0' }] }],
    mergeBaseSha: 'fork0',
    fileSnapshots: {
      [GATE]: {
        fork: 'keep\nedit-me\n',
        main: 'keep\nedit-me\n',
        head: 'keep\nedited\n',
      },
    },
  }), 'Gate files are fresh relative to main (1 file(s)).');
});

test('listed gate files include the merge-gate workflows and GATE_SCRIPTS', () => {
  const listed = listedGateFiles();
  for (const file of [...GATE_WORKFLOW_FILES, ...GATE_SCRIPTS]) {
    assert.ok(listed.includes(file), file);
  }
});

test('gate-files-fresh workflow checks out the default branch read-only', () => {
  const yaml = readFileSync(new URL('../.github/workflows/gate-files-fresh.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^name:\s*Gate files fresh\s*$/m);
  assert.match(yaml, /^\s+gate-files-fresh:\s*$/m);
  assert.match(yaml, /^\s+name:\s*gate-files-fresh\s*$/m);
  assert.match(yaml, /^\s+pull_request_target:\s*$/m);
  assert.match(yaml, /types:\s*\[opened, synchronize, reopened\]/);
  assert.match(yaml, /^\s+timeout-minutes:\s*5\s*$/m);
  assert.match(yaml, /ref:\s*\$\{\{\s*github\.event\.repository\.default_branch\s*\}\}/);
  assert.match(yaml, /persist-credentials:\s*false/);
  assert.match(yaml, /contents:\s*read/);
  assert.match(yaml, /pull-requests:\s*read/);
  assert.doesNotMatch(yaml, /contents:\s*write/);
  assert.doesNotMatch(yaml, /secrets\./);
  assert.doesNotMatch(yaml, /ref:\s*\$\{\{\s*github\.event\.pull_request\.head\.(?:sha|ref)/);
  assert.doesNotMatch(yaml, /ref:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha/);
});

test('checkPullRequest fails a stale head and names the main commit that added the line', async () => {
  const api = {
    fetchPrFiles: () => [{ filename: GATE, status: 'modified' }],
    fetchPrCommits: () => [{ sha: 'pr1', parents: [{ sha: 'fork0' }] }],
    fetchCompare: (_repo, _token, base) => (
      base === 'main'
        ? { merge_base_commit: { sha: 'fork0' }, commits: [] }
        : { commits: [{ sha: 'mainadd1' }] }
    ),
    fetchFileText: (_repo, sha) => {
      if (sha === 'fork0') return 'keep\n';
      if (sha === 'main') return 'keep\nadded-on-main\n';
      return 'keep\n';
    },
    fetchCommitsForPath: () => [{ sha: 'mainadd1' }],
    fetchCommit: () => ({
      sha: 'mainadd1',
      files: [{ filename: GATE, patch: '@@ -1,1 +1,2 @@\n keep\n+added-on-main\n' }],
    }),
  };
  const result = await checkPullRequest({
    repo: 'example/repo',
    token: 'unused',
    prNumber: '1',
    headSha: 'pr1',
    mainRef: 'main',
    api,
  });
  assert.equal(result.ok, false);
  assert.equal(result.results[0].dropped[0].line, 'added-on-main');
  assert.equal(result.results[0].dropped[0].commit, 'mainadd1');
});
