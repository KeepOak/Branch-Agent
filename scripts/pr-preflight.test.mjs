import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addedLinesFromPatch,
  cloudAgentTrailer,
  ciSkippedLines,
  formatProblems,
  gateFileProblems,
  inputFromApi,
  unverifiedFileNames,
  namedListPathFor,
  runCli,
  preflightBudgetSeconds,
  runPreflight,
  scopedChecks,
} from './pr-preflight.mjs';
import { gateApiBudget } from './merge-gate-trusted.mjs';

const SHA = 'a'.repeat(40);
const BRANCH = 'trunk/pr-preflight';
const LIST = 'scripts/feature-batch-ci-named/trunk-pr-preflight.txt';
const NOREPLY = '12345+person@users.noreply.github.com';
const PROTECTED = new Set(['scripts/merge-gate-trusted.test.mjs']);
const BODY = [
  '## Summary',
  'Adds the preflight script.',
  '',
  'No visible change: CLI only.',
  '',
  'SELF-CHECK',
  `Final head: ${SHA}`,
  `Branch: ${BRANCH}`,
  'Base: origin/main 095f7916',
  'Files: 2 (all expected: yes; CI test list: none needed)',
  'Tests: node --test scripts/pr-preflight.test.mjs -> 16 passed, 0 failed',
  'Brief/FIX points: 1: done',
  'Trailer and emails: ok',
].join('\n');
const GOOD_COMMIT = {
  sha: 'aaaaaaa',
  message: 'feat: add preflight',
  authorEmail: NOREPLY,
  committerEmail: NOREPLY,
  date: '2026-10-09T12:00:00Z',
};
const VALID = {
  branch: BRANCH,
  headSha: SHA,
  body: BODY,
  dirtyCount: 0,
  commits: [GOOD_COMMIT],
  changedFiles: ['scripts/pr-preflight.mjs', 'scripts/pr-preflight.test.mjs'],
  addedLines: [],
  listPath: LIST,
  listText: null,
  windowResult: { ok: true, text: '' },
  shardResult: { ok: true, detail: '' },
  protectedPaths: PROTECTED,
};
const withInput = (overrides) => ({ ...VALID, ...overrides });
const checksOf = (problems) => problems.map((p) => p.check);

function httpError(message) {
  return Object.assign(new Error(message), {});
}

test('a clean branch and body produce no problems', () => {
  assert.deepEqual(runPreflight(VALID), []);
  assert.equal(formatProblems([]), 'preflight: ok');
});

test('a dirty working tree is reported with a fix', () => {
  const problems = runPreflight(withInput({ dirtyCount: 3 }));
  assert.deepEqual(checksOf(problems), ['clean-tree']);
  assert.match(formatProblems(problems), /3 uncommitted change\(s\)\. Fix: commit or stash/);
});

test('a personal author email fails the commit-email rule, with a fix that names no address', () => {
  const commit = { ...GOOD_COMMIT, authorEmail: 'someone@example.com' };
  const problems = runPreflight(withInput({ commits: [commit] }));
  assert.deepEqual(checksOf(problems), ['commit-email']);
  assert.match(problems[0].fix, /noreply address \(ending @users\.noreply\.github\.com\)/);
  assert.doesNotMatch(problems[0].fix, /someone|example\.com/);
});

test('the trailer is required only for cloud agents, and its text comes from the gate', () => {
  const plain = { ...GOOD_COMMIT, message: 'feat: add preflight' };
  assert.deepEqual(runPreflight(withInput({ commits: [plain] })), []);
  const cloud = runPreflight(withInput({ commits: [plain], cloudAgent: true }));
  assert.deepEqual(checksOf(cloud), ['trailer']);
  assert.equal(cloud[0].fix, `end the commit message with: ${cloudAgentTrailer()}`);
  assert.match(cloudAgentTrailer(), /^Co-authored-by: .+ <.+@users\.noreply\.github\.com>$/);
});

test('an AI co-author on anthropic.com fails the gate address rule', () => {
  const commit = { ...GOOD_COMMIT, message: 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>' };
  assert.ok(checksOf(runPreflight(withInput({ commits: [commit] }))).includes('commit-email'));
});

test('a body with no SELF-CHECK block fails', () => {
  const problems = runPreflight(withInput({ body: '## Summary\nNo block here.' }));
  assert.deepEqual(checksOf(problems), ['self-check']);
  assert.match(problems[0].message, /no SELF-CHECK block/);
});

test('a stale Final head after a new push is ignored', () => {
  const stale = BODY.replace(SHA, 'b'.repeat(40));
  assert.deepEqual(runPreflight(withInput({ body: stale })), []);
});

test('a changed engine test without a named-test list fails and names the file', () => {
  const problems = runPreflight(withInput({ changedFiles: ['engine/src/thing.test.ts'] }));
  assert.deepEqual(checksOf(problems), ['named-tests']);
  assert.match(problems[0].fix, /engine:src\/thing\.test\.ts/);
});

test('a named-test list missing an entry, or unsorted, is reported', () => {
  const files = ['window/src/shell/a.test.ts', 'engine/src/b.test.ts'];
  const missing = runPreflight(withInput({ changedFiles: files, listText: 'engine:src/b.test.ts\n' }));
  assert.match(missing.map((p) => p.message).join('\n'), /lacks window:src\/shell\/a\.test\.ts/);
  const sorted = runPreflight(withInput({ changedFiles: files, listText: 'engine:src/b.test.ts\nwindow:src/shell/a.test.ts\n' }));
  assert.deepEqual(sorted, []);
  const reversed = runPreflight(withInput({ changedFiles: files, listText: 'window:src/shell/a.test.ts\nengine:src/b.test.ts\n' }));
  assert.deepEqual(checksOf(reversed), ['named-tests']);
  assert.match(reversed[0].message, /is not sorted/);
});

test('an engine .mts test needs a named-test entry like a .ts test does', () => {
  const problems = runPreflight(withInput({ changedFiles: ['engine/src/c.test.mts'] }));
  assert.deepEqual(checksOf(problems), ['named-tests']);
  assert.match(problems[0].fix, /engine:src\/c\.test\.mts/);
});

test('a window UI change without screenshot proof fails', () => {
  const body = BODY.replace('No visible change: CLI only.', 'Done.');
  const problems = runPreflight(withInput({ body, changedFiles: ['window/src/shell/Thread.tsx'] }));
  assert.deepEqual(checksOf(problems), ['ui-proof']);
  assert.match(problems[0].fix, /No visible change/);
});

test('a window-clean baseline that differs fails with the first report line', () => {
  const windowResult = { ok: false, text: 'fresh: window/src/x.tsx hardcoded color\nstale: window/src/y.tsx' };
  const problems = runPreflight(withInput({ windowResult }));
  assert.deepEqual(checksOf(problems), ['window-clean']);
  assert.equal(problems[0].message, 'fresh: window/src/x.tsx hardcoded color');
});

test('a shard that breaks the 12-minute budget fails', () => {
  const problems = runPreflight(withInput({ shardResult: { ok: false, detail: 'shard is 760s, over the 720s budget' } }));
  assert.deepEqual(checksOf(problems), ['shard-budget']);
  assert.match(problems[0].message, /760s/);
});

test('a changed protected gate file needs the reviewer marker for this head', () => {
  const problems = runPreflight(withInput({ changedFiles: ['scripts/merge-gate-trusted.test.mjs'] }));
  assert.deepEqual(checksOf(problems), ['gate-files']);
  assert.match(problems[0].message, /reviewer marker for this head/);
  assert.match(problems[0].fix, /the reviewer \(Branch PR Closer\) adds the gate-change-reviewed: <head sha> line/);
  assert.match(problems[0].fix, /Do not add it yourself/);
  assert.doesNotMatch(problems[0].fix, /GOD adds/);
});

test('the gate marker for this exact head satisfies the gate-file rule; a marker for another head does not', () => {
  const gated = { changedFiles: ['scripts/merge-gate-trusted.test.mjs'] };
  assert.deepEqual(checksOf(runPreflight(withInput({ ...gated, body: `${BODY}
gate-change-reviewed: ${SHA}` }))), []);
  assert.deepEqual(checksOf(runPreflight(withInput({ ...gated, body: `${BODY}
gate-change-reviewed: ${'b'.repeat(40)}` }))), ['gate-files']);
});

const MARKER_M = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MERGE_ONE = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const MERGE_TWO = 'cccccccccccccccccccccccccccccccccccccccc';
const MAIN_P1 = '1111111111111111111111111111111111111111';
const MAIN_P2 = '2222222222222222222222222222222222222222';
const AUTHOR_SHA = 'dddddddddddddddddddddddddddddddddddddddd';
const FOREIGN_SHA = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const CARRY_FILE = '.github/workflows/desktop-checks.yml';
const CARRY_PATCH = '@@ -1,2 +1,3 @@\n on: [push]\n+  pull_request:\n jobs: {}\n';
const CARRY_PATHS = new Set([CARRY_FILE]);

function apiCommit(sha, parents) {
  return { sha, parents: parents.map((parent) => ({ sha: parent })) };
}

function carryFile(overrides = {}) {
  return {
    filename: CARRY_FILE,
    status: 'modified',
    patch: CARRY_PATCH,
    ...overrides,
  };
}

function gitIn(dir, args, input) {
  return execFileSync('git', ['-C', dir, '-c', 'user.email=test@example.com', '-c', 'user.name=Test', '-c', 'commit.gpgsign=false', ...args], {
    encoding: 'utf8',
    input,
    windowsHide: true,
  }).trim();
}

function parseLsTree(raw) {
  const entries = [];
  for (const line of String(raw ?? '').split('\n')) {
    if (!line) continue;
    const match = /^([0-7]+) (blob|commit) ([0-9a-f]{40})\t(.*)$/.exec(line);
    if (!match) throw new Error(`bad ls-tree line ${line}`);
    entries.push({ mode: match[1], type: match[2], sha: match[3], path: match[4] });
  }
  return entries;
}

function snapshotTree(dir, sha) {
  const tree = gitIn(dir, ['rev-parse', `${sha}^{tree}`]);
  return { tree, entries: parseLsTree(gitIn(dir, ['ls-tree', '-r', tree])) };
}

// Real trees for the fake carry SHAs, so a clean merge of main proves itself through git merge-tree.
function buildCleanCarryFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-clean-carry-'));
  const commitAll = (message) => {
    gitIn(dir, ['add', '.']);
    gitIn(dir, ['commit', '-m', message]);
    return gitIn(dir, ['rev-parse', 'HEAD']);
  };
  try {
    gitIn(dir, ['init', '-q', '-b', 'main']);
    writeFileSync(path.join(dir, 'README'), 'base\n');
    const base = commitAll('base');
    writeFileSync(path.join(dir, 'feature.txt'), 'from main\n');
    const main1 = commitAll('main1');
    gitIn(dir, ['checkout', '-q', '-b', 'pr', base]);
    mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(path.join(dir, CARRY_FILE), 'on: [push]\njobs: {}\n');
    const marker = commitAll('marker');
    gitIn(dir, ['merge', '-q', '--no-ff', 'main', '-m', 'merge1']);
    const merge1 = gitIn(dir, ['rev-parse', 'HEAD']);
    gitIn(dir, ['checkout', '-q', 'main']);
    writeFileSync(path.join(dir, 'feature2.txt'), 'more main\n');
    const main2 = commitAll('main2');
    gitIn(dir, ['checkout', '-q', 'pr']);
    gitIn(dir, ['merge', '-q', '--no-ff', 'main', '-m', 'merge2']);
    const merge2 = gitIn(dir, ['rev-parse', 'HEAD']);
    const commits = new Map([
      [MARKER_M, snapshotTree(dir, marker)],
      [MAIN_P1, snapshotTree(dir, main1)],
      [MERGE_ONE, snapshotTree(dir, merge1)],
      [MAIN_P2, snapshotTree(dir, main2)],
      [MERGE_TWO, snapshotTree(dir, merge2)],
    ]);
    const baseTree = snapshotTree(dir, base);
    const main1Tree = snapshotTree(dir, main1);
    const trees = new Map();
    for (const snap of [...commits.values(), baseTree, main1Tree]) {
      trees.set(snap.tree, { sha: snap.tree, truncated: false, tree: snap.entries });
    }
    const bases = new Map([
      [`${MARKER_M} ${MAIN_P1}`, { sha: base, tree: baseTree.tree }],
      [`${MERGE_ONE} ${MAIN_P2}`, { sha: main1, tree: main1Tree.tree }],
    ]);
    return { commits, trees, bases };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CLEAN_CARRY = buildCleanCarryFixture();

function compareRequest({
  baseRef = 'main',
  markerSha = MARKER_M,
  markerFiles = [carryFile()],
  onBase = new Set([MAIN_P1, MAIN_P2]),
  truncated = false,
} = {}) {
  return (requestPath) => {
    const pathOnly = requestPath.split('?')[0];
    const commitMatch = /^git\/commits\/([0-9a-f]{40})$/i.exec(pathOnly);
    if (commitMatch) {
      const found = CLEAN_CARRY.commits.get(commitMatch[1].toLowerCase());
      if (!found) throw new Error(`unexpected ${requestPath}`);
      return { sha: commitMatch[1].toLowerCase(), tree: { sha: found.tree } };
    }
    const treeMatch = /^git\/trees\/([0-9a-f]{40})$/i.exec(pathOnly);
    if (treeMatch) {
      const found = CLEAN_CARRY.trees.get(treeMatch[1].toLowerCase());
      if (!found) throw new Error(`unexpected ${requestPath}`);
      return found;
    }
    const compare = /^compare\/([^/?]+)\.\.\.([^/?]+)/.exec(requestPath);
    if (!compare) throw new Error(`unexpected ${requestPath}`);
    const left = compare[1];
    const right = compare[2];
    if (right === baseRef) {
      return onBase.has(left.toLowerCase())
        ? { status: 'ahead', behind_by: 0, ahead_by: 4 }
        : { status: 'diverged', behind_by: 2, ahead_by: 1 };
    }
    if (left === baseRef && right.toLowerCase() === markerSha.toLowerCase()) {
      return { truncated, files: markerFiles };
    }
    const pair = CLEAN_CARRY.bases.get(`${left.toLowerCase()} ${right.toLowerCase()}`);
    if (pair) {
      return { merge_base_commit: { sha: pair.sha, commit: { tree: { sha: pair.tree } } } };
    }
    throw new Error(`unexpected compare ${requestPath}`);
  };
}

function carryGate(overrides = {}) {
  const markerSha = overrides.markerSha ?? MARKER_M;
  const files = overrides.files ?? [carryFile()];
  return gateFileProblems({
    changedFiles: overrides.changedFiles ?? [CARRY_FILE],
    body: overrides.body ?? `gate-change-reviewed: ${markerSha}`,
    headSha: overrides.headSha ?? MERGE_ONE,
    protectedPaths: overrides.protectedPaths ?? CARRY_PATHS,
    commits: overrides.commits,
    files,
    baseRef: overrides.baseRef ?? 'main',
    request: overrides.request ?? compareRequest({
      markerSha,
      markerFiles: overrides.markerFiles ?? files,
      onBase: overrides.onBase,
      truncated: overrides.truncated,
    }),
    baselineGrew: overrides.baselineGrew,
    repoDir: overrides.repoDir,
  });
}

test('a gate marker carries across one merge of main', () => {
  assert.deepEqual(carryGate({
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1]),
    ],
  }), []);
  const body = BODY.replaceAll(SHA, MERGE_ONE);
  assert.deepEqual(checksOf(runPreflight(withInput({
    body: `${body}\ngate-change-reviewed: ${MARKER_M}`,
    headSha: MERGE_ONE,
    changedFiles: [CARRY_FILE],
    protectedPaths: CARRY_PATHS,
    prCommits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1]),
    ],
    files: [carryFile()],
    baseRef: 'main',
    request: compareRequest(),
  }))), []);
});

test('a gate marker carries across two merges of main', () => {
  assert.deepEqual(carryGate({
    headSha: MERGE_TWO,
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1]),
      apiCommit(MERGE_TWO, [MERGE_ONE, MAIN_P2]),
    ],
  }), []);
});

test('an author commit after the marker that touches a gate file does not carry', () => {
  const problems = carryGate({
    headSha: AUTHOR_SHA,
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(AUTHOR_SHA, [MARKER_M]),
    ],
    files: [carryFile({ patch: `${CARRY_PATCH}+author\n` })],
  });
  assert.deepEqual(checksOf(problems), ['gate-files']);
});

test('an author commit after the marker that touches no gate file does not carry', () => {
  const problems = carryGate({
    headSha: AUTHOR_SHA,
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(AUTHOR_SHA, [MARKER_M]),
    ],
  });
  assert.deepEqual(checksOf(problems), ['gate-files']);
});

test('a merge whose conflict resolution changes the gate patch does not carry', () => {
  const problems = carryGate({
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1]),
    ],
    files: [carryFile({ patch: `${CARRY_PATCH}+resolved\n` })],
    markerFiles: [carryFile()],
  });
  assert.deepEqual(checksOf(problems), ['gate-files']);
});

test('a merge whose second parent is not on the base branch does not carry', () => {
  const problems = carryGate({
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, FOREIGN_SHA]),
    ],
    onBase: new Set([MAIN_P1]),
  });
  assert.deepEqual(checksOf(problems), ['gate-files']);
});

test('a marker SHA that is not a commit on the pull request does not carry', () => {
  const problems = carryGate({
    commits: [apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1])],
  });
  assert.deepEqual(checksOf(problems), ['gate-files']);
});

test('a missing or truncated protected-file patch does not carry', () => {
  assert.deepEqual(checksOf(carryGate({
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1]),
    ],
    markerFiles: [{ filename: CARRY_FILE, status: 'modified' }],
  })), ['gate-files']);
  assert.deepEqual(checksOf(carryGate({
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1]),
    ],
    truncated: true,
  })), ['gate-files']);
});

function withCarryHistory(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'gate-dirty-carry-'));
  try {
    gitIn(dir, ['init', '-q', '-b', 'main']);
    writeFileSync(path.join(dir, 'README'), 'base\n');
    gitIn(dir, ['add', '.']);
    gitIn(dir, ['commit', '-m', 'base']);
    const base = gitIn(dir, ['rev-parse', 'HEAD']);
    writeFileSync(path.join(dir, 'from-main.txt'), 'from main\n');
    gitIn(dir, ['add', '.']);
    gitIn(dir, ['commit', '-m', 'main']);
    const mainTip = gitIn(dir, ['rev-parse', 'HEAD']);
    gitIn(dir, ['checkout', '-q', '-b', 'pr', base]);
    mkdirSync(path.join(dir, '.github', 'workflows'), { recursive: true });
    writeFileSync(path.join(dir, CARRY_FILE), 'on: [push]\njobs: {}\n');
    gitIn(dir, ['add', '.']);
    gitIn(dir, ['commit', '-m', 'marker']);
    const marker = gitIn(dir, ['rev-parse', 'HEAD']);
    gitIn(dir, ['merge', '-q', '--no-ff', 'main', '-m', 'clean']);
    const clean = gitIn(dir, ['rev-parse', 'HEAD']);
    gitIn(dir, ['checkout', '-q', marker]);
    gitIn(dir, ['merge', '-q', '-s', 'ours', 'main', '-m', 'ours']);
    const ours = gitIn(dir, ['rev-parse', 'HEAD']);
    gitIn(dir, ['checkout', '-q', clean]);
    writeFileSync(path.join(dir, 'extra.txt'), 'evil\n');
    gitIn(dir, ['add', 'extra.txt']);
    const extraTree = gitIn(dir, ['write-tree']);
    const extra = gitIn(dir, ['commit-tree', extraTree, '-p', marker, '-p', mainTip, '-m', 'extra']);
    run({ dir, base, mainTip, marker, clean, ours, extra });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function requestFromCarryRepo(repo, { marker, onBase }) {
  const fallback = compareRequest({ markerSha: marker, onBase, markerFiles: [carryFile()] });
  return (requestPath) => {
    const pathOnly = requestPath.split('?')[0];
    const commitMatch = /^git\/commits\/([0-9a-f]{40})$/i.exec(pathOnly);
    if (commitMatch) {
      const sha = commitMatch[1].toLowerCase();
      return { sha, tree: { sha: gitIn(repo, ['rev-parse', `${sha}^{tree}`]) } };
    }
    const treeMatch = /^git\/trees\/([0-9a-f]{40})$/i.exec(pathOnly);
    if (treeMatch) {
      const tree = treeMatch[1].toLowerCase();
      return { sha: tree, truncated: false, tree: parseLsTree(gitIn(repo, ['ls-tree', '-r', tree])) };
    }
    const blobMatch = /^git\/blobs\/([0-9a-f]{40})$/i.exec(pathOnly);
    if (blobMatch) {
      const sha = blobMatch[1].toLowerCase();
      const bytes = execFileSync('git', ['-C', repo, 'cat-file', 'blob', sha], { windowsHide: true });
      return { sha, encoding: 'base64', content: bytes.toString('base64') };
    }
    const compare = /^compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/i.exec(pathOnly);
    if (compare) {
      const left = compare[1].toLowerCase();
      const right = compare[2].toLowerCase();
      const base = gitIn(repo, ['merge-base', left, right]);
      return {
        merge_base_commit: { sha: base, commit: { tree: { sha: gitIn(repo, ['rev-parse', `${base}^{tree}`]) } } },
      };
    }
    return fallback(requestPath);
  };
}

function historyProblems(repo, { head, marker, mainTip, base, parents }) {
  const shared = {
    headSha: head,
    markerSha: marker,
    commits: [apiCommit(marker, [base]), apiCommit(head, parents)],
    onBase: new Set([mainTip]),
    files: [carryFile()],
    markerFiles: [carryFile()],
  };
  return {
    local: carryGate({ ...shared, repoDir: repo }),
    api: carryGate({ ...shared, request: requestFromCarryRepo(repo, { marker, onBase: shared.onBase }) }),
  };
}

test('an ours merge that drops main\'s changes does not carry the marker', () => {
  withCarryHistory(({ dir, base, mainTip, marker, clean, ours }) => {
    const cleanCarry = historyProblems(dir, { head: clean, marker, mainTip, base, parents: [marker, mainTip] });
    assert.deepEqual(cleanCarry.local, []);
    assert.deepEqual(cleanCarry.api, []);
    const dropped = historyProblems(dir, { head: ours, marker, mainTip, base, parents: [marker, mainTip] });
    assert.deepEqual(checksOf(dropped.local), ['gate-files']);
    assert.deepEqual(checksOf(dropped.api), ['gate-files']);
  });
});

test('a merge that adds an extra untrusted file does not carry the marker', () => {
  withCarryHistory(({ dir, base, mainTip, marker, extra }) => {
    const added = historyProblems(dir, { head: extra, marker, mainTip, base, parents: [marker, mainTip] });
    assert.deepEqual(checksOf(added.local), ['gate-files']);
    assert.deepEqual(checksOf(added.api), ['gate-files']);
  });
});

test('button-crawl baseline growth still requires the exact head marker', () => {
  assert.deepEqual(checksOf(carryGate({
    changedFiles: ['scripts/button-crawl/baseline.json'],
    protectedPaths: new Set(),
    baselineGrew: true,
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1]),
    ],
  })), ['gate-files']);
  assert.deepEqual(carryGate({
    changedFiles: ['scripts/button-crawl/baseline.json'],
    protectedPaths: new Set(),
    baselineGrew: true,
    body: `gate-change-reviewed: ${MERGE_ONE}`,
    commits: [
      apiCommit(MARKER_M, [SHA]),
      apiCommit(MERGE_ONE, [MARKER_M, MAIN_P1]),
    ],
  }), []);
});

test('a desktop test that desktop-checks.yml does not run fails, and one it runs passes (the gate rule, not a copy)', () => {
  const files = [{ filename: 'desktop/src/x.test.mjs', status: 'added' }];
  const withoutRun = runPreflight(withInput({ changedFiles: ['desktop/src/x.test.mjs'], files, desktopWorkflow: 'on:\n  pull_request:\njobs:\n  desktop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n' }));
  assert.deepEqual(checksOf(withoutRun), ['desktop-tests']);
  const withRun = runPreflight(withInput({ changedFiles: ['desktop/src/x.test.mjs'], files, desktopWorkflow: 'on:\n  pull_request:\njobs:\n  desktop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node --test desktop/src/x.test.mjs\n' }));
  assert.deepEqual(checksOf(withRun), []);
});

test('the slow local checks run only when their inputs changed', () => {
  assert.deepEqual(scopedChecks(['docs/notes.md']), { window: false, shard: false });
  assert.deepEqual(scopedChecks(['window/src/a.tsx']), { window: true, shard: false });
  assert.deepEqual(scopedChecks(['scripts/feature-batch-ci-named/x.txt']), { window: false, shard: true });
});

test('the gate decides what is protected: workflows, CODEOWNERS and invoked scripts all count', () => {
  for (const file of ['.github/workflows/new-check.yml', 'docs/CODEOWNERS', 'scripts/merge-gate-trusted.mjs']) {
    const { protectedPaths, ...rest } = VALID;
    const problems = runPreflight({ ...rest, changedFiles: [file] });
    assert.ok(checksOf(problems).includes('gate-files'), `${file} should be a protected gate file`);
  }
  assert.deepEqual(runPreflight(withInput({ changedFiles: ['docs/notes.md'], protectedPaths: undefined })), []);
});

test('a personal path or email in an added non-test line fails, and a test fixture does not', () => {
  const addedLines = [{ file: 'docs/notes.md', line: 3, text: 'see /Users/example/Desktop/x' }];
  const problems = runPreflight(withInput({ addedLines }));
  assert.deepEqual(checksOf(problems), ['personal-info']);
  assert.match(problems[0].message, /docs\/notes\.md:3/);
  assert.deepEqual(runPreflight(withInput({ addedLines: [{ file: 'scripts/x.test.mjs', line: 9, text: 'x@gmail.com' }] })), []);
});

test('formatProblems prints one line per problem plus a count', () => {
  const problems = runPreflight(withInput({ dirtyCount: 1, addedLines: [{ file: 'a.md', line: 1, text: 'x@gmail.com' }] }));
  const lines = formatProblems(problems).split('\n');
  assert.equal(lines.length, problems.length + 1);
  assert.equal(lines.at(-1), `preflight: ${problems.length} problem(s)`);
});

// Prior art: fix, perf and refactor PRs must name what they checked before changing code.
const PRIOR_ART_OK = `${BODY}\nPrior art: upstream project sessions_send, the old steer path it replaces`;
const priorArtProblemsOf = (overrides) => runPreflight(withInput(overrides)).filter((p) => p.check === 'prior-art');

test('a fix, perf or refactor title needs a Prior art line in the body', () => {
  for (const title of ['fix: stop the queue stall', 'fix(gateway): stop the queue stall', 'perf: cut lane waits', 'refactor(mcp): split the tool']) {
    const problems = priorArtProblemsOf({ title, body: BODY });
    assert.equal(problems.length, 1, title);
    assert.match(problems[0].fix, /Prior art:/);
  }
});

test('a Prior art line that names what was checked passes', () => {
  assert.deepEqual(priorArtProblemsOf({ title: 'fix: stop the queue stall', body: PRIOR_ART_OK }), []);
  assert.deepEqual(priorArtProblemsOf({ title: 'refactor: split the tool', body: `${BODY}\nPrior art: the old tool code it replaces and peer agents' steer paths` }), []);
});

test('none found passes only when it says what was checked', () => {
  assert.deepEqual(priorArtProblemsOf({ title: 'fix: x', body: `${BODY}\nPrior art: none found: checked upstream project and hermes` }), []);
  assert.equal(priorArtProblemsOf({ title: 'fix: x', body: `${BODY}\nPrior art: none found:` }).length, 1);
});

test('any named source after the label passes, not only a fixed keyword list', () => {
  for (const line of [
    'Prior art: openclaw sessions_send shape',
    'Prior art: https://github.com/example/project/pull/12',
    'Prior art: <https://github.com/example/project/pull/12>',
    'Prior art: looked at how the settings page saved this before',
  ]) {
    assert.deepEqual(priorArtProblemsOf({ title: 'fix(x): y', body: `${BODY}\n${line}` }), [], line);
  }
});

test('an empty, n/a, bare none or unfilled placeholder Prior art entry fails', () => {
  for (const line of ['Prior art:', 'Prior art:   ', 'Prior art: n/a', 'Prior art: N/A', 'Prior art: none', 'Prior art: None.', 'Prior art: <what you checked>', 'Prior art: none found: <what you checked>', 'Prior art: none found']) {
    const problems = priorArtProblemsOf({ title: 'fix(x): y', body: `${BODY}\n${line}` });
    assert.equal(problems.length, 1, line);
    assert.match(problems[0].fix, /Prior art:/);
  }
});

test('the unfilled PR template fails the Prior art rule', () => {
  const template = readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8');
  assert.equal(priorArtProblemsOf({ title: 'fix(x): y', body: `${BODY}\n${template}` }).length, 1);
  const filled = template.replace('Prior art: <what you checked>', 'Prior art: openclaw sessions_send shape');
  assert.deepEqual(priorArtProblemsOf({ title: 'fix(x): y', body: `${BODY}\n${filled}` }), []);
});

test('a bold label, a Prior art heading with content, and bullets under a bare label all pass', () => {
  for (const extra of [
    '**Prior art:** upstream openclaw steer path',
    '**Prior art**: upstream openclaw steer path',
    '- Prior art: openclaw sessions_send shape',
    '## Prior art\n\n- openclaw sessions_send shape\n- the old steer path it replaces\n\n## UI proof\nNo visible change: gate script.',
    '## Prior art\n<!-- note -->\nChecked openclaw and hermes; neither handles this.',
    'Prior art:\n- openclaw sessions_send shape\n- the old steer path',
    'Prior art:\n\n- openclaw sessions_send shape',
  ]) {
    assert.deepEqual(priorArtProblemsOf({ title: 'fix(x): y', body: `${BODY}\n${extra}` }), [], extra);
  }
});

test('a Prior art heading or bare label with nothing under it fails', () => {
  for (const extra of [
    '## Prior art\n\n## UI proof\nNo visible change: gate script.',
    '## Prior art\n<!-- Required for fix PRs. -->\n\n## UI proof\nNo visible change: gate script.',
    '## Prior art\n- n/a\n\n## UI proof\nNo visible change: gate script.',
    'Prior art:\n\n## UI proof\nNo visible change: gate script.',
  ]) {
    assert.equal(priorArtProblemsOf({ title: 'fix(x): y', body: `${BODY}\n${extra}` }).length, 1, extra);
  }
});

test('the title match ignores case, so a capitalised fix title cannot skip the rule', () => {
  for (const title of ['Fix(settings): keep the theme', 'FIX: x', 'Perf: cut lane waits', 'Refactor(mcp)!: split the tool']) {
    assert.equal(priorArtProblemsOf({ title, body: BODY }).length, 1, title);
    assert.deepEqual(priorArtProblemsOf({ title, body: `${BODY}\nPrior art: openclaw sessions_send shape` }), [], title);
  }
});

test('feat and docs titles are exempt from the Prior art rule', () => {
  assert.deepEqual(priorArtProblemsOf({ title: 'feat: add a view', body: BODY }), []);
  assert.deepEqual(priorArtProblemsOf({ title: 'docs: fix the readme', body: BODY }), []);
});

test('the CI input carries the PR title, so the Prior art rule runs in CI too', () => {
  const input = inputFromApi({ headBranch: BRANCH, headSha: SHA, files: [], commits: [], listText: null, title: 'fix: x' });
  assert.equal(input.title, 'fix: x');
});

test('PR body emails fail across providers, custom domains, and Markdown without leaking the address', () => {
  for (const address of ['someone@gmail.com', 'first.last+tag@example.org', 'PERSON@CUSTOM.EXAMPLE', 'person@users.noreply.github.com.example.org']) {
    for (const text of [address, `[contact](mailto:${address})`, `\`\`\`\n${address}\n\`\`\``]) {
      const problems = runPreflight(withInput({ body: `${BODY}\n\n${text}` }));
      assert.deepEqual(checksOf(problems), ['body-email']);
      assert.doesNotMatch(formatProblems(problems), new RegExp(address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  }
});

test('PR bodies allow GitHub noreply identities and ordinary handles and package names', () => {
  assert.deepEqual(runPreflight(withInput({ body: `${BODY}\n\n${NOREPLY}\n@owner @branch/tools` })), []);
});

test('PR body version pins are not email addresses', () => {
  for (const pin of ['vitest@3.2.4', '@scope/pkg@1.2.3']) {
    assert.deepEqual(runPreflight(withInput({ body: `${BODY}\n\nPinned ${pin}.` })), [], pin);
  }
});

test('PR body email checks also run for API inputs without file changes', () => {
  const input = inputFromApi({ headBranch: BRANCH, headSha: SHA, files: [], commits: [], listText: null });
  const problems = runPreflight({ ...input, body: `${BODY}\n\ncontact: someone@example.org` });
  assert.deepEqual(checksOf(problems), ['body-email']);
});

// CLI wiring: drive the real runCli against a temporary git repository.
function fixtureRepo({ branchMessage, branchEmail, body }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'preflight-cli-'));
  const git = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', `user.email=${NOREPLY}`, '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(['add', 'base.txt']);
  git(['commit', '-q', '-m', 'chore: base']);
  git(['checkout', '-q', '-b', BRANCH]);
  mkdirSync(path.join(dir, 'scripts'));
  writeFileSync(path.join(dir, 'scripts', 'x.mjs'), 'export const x = 1;\n');
  git(['add', 'scripts/x.mjs']);
  git(['-c', `user.email=${branchEmail}`, 'commit', '-q', '-m', branchMessage]);
  const head = git(['rev-parse', 'HEAD']).trim();
  const bodyPath = path.join(mkdtempSync(path.join(tmpdir(), 'preflight-body-')), 'body.md');
  writeFileSync(bodyPath, body(head));
  return { dir, bodyPath };
}

test('the CLI fails on a body with no SELF-CHECK and names the check', () => {
  const { dir, bodyPath } = fixtureRepo({ branchMessage: 'feat: x', branchEmail: NOREPLY, body: () => 'no block here\n' });
  const result = runCli(['--body', bodyPath, '--base', 'HEAD~1'], dir);
  assert.equal(result.exitCode, 1);
  assert.match(result.text, /preflight FAIL \[self-check\]/);
});

test('the CLI passes a clean branch with a valid SELF-CHECK for its real head', () => {
  const body = (head) => BODY.replace(SHA, head).replace(`Branch: ${BRANCH}`, `Branch: ${BRANCH}`);
  const { dir, bodyPath } = fixtureRepo({ branchMessage: 'feat: x', branchEmail: NOREPLY, body });
  const result = runCli(['--body', bodyPath, '--base', 'HEAD~1'], dir);
  assert.equal(result.exitCode, 0, result.text);
  assert.equal(result.text, 'preflight: ok');
});

test('the CLI reports a personal commit email from the real git log', () => {
  const body = (head) => BODY.replace(SHA, head);
  const { dir, bodyPath } = fixtureRepo({ branchMessage: 'feat: x', branchEmail: 'someone@example.com', body });
  const result = runCli(['--body', bodyPath, '--base', 'HEAD~1'], dir);
  assert.equal(result.exitCode, 1);
  assert.match(result.text, /\[commit-email\]/);
});

test('the CLI fails a fix commit whose body has no Prior art line', () => {
  const { dir, bodyPath } = fixtureRepo({ branchMessage: 'fix: stop the stall', branchEmail: NOREPLY, body: (head) => BODY.replace(SHA, head) });
  const result = runCli(['--body', bodyPath, '--base', 'HEAD~1'], dir);
  assert.equal(result.exitCode, 1);
  assert.match(result.text, /preflight FAIL \[prior-art\]/);
});

test('the CLI passes a fix commit whose body names what it checked', () => {
  const body = (head) => `${BODY.replace(SHA, head)}\nPrior art: upstream project sessions_send, the old steer path`;
  const { dir, bodyPath } = fixtureRepo({ branchMessage: 'fix: stop the stall', branchEmail: NOREPLY, body });
  const result = runCli(['--body', bodyPath, '--base', 'HEAD~1'], dir);
  assert.equal(result.exitCode, 0, result.text);
});

test('the CLI rejects an email in a PR body even when commits and files are clean', () => {
  const body = (head) => `${BODY.replace(SHA, head)}\n\ncontact: someone@example.org`;
  const { dir, bodyPath } = fixtureRepo({ branchMessage: 'feat: x', branchEmail: NOREPLY, body });
  const result = runCli(['--body', bodyPath, '--base', 'HEAD~1'], dir);
  assert.equal(result.exitCode, 1);
  assert.match(result.text, /preflight FAIL \[body-email\]/);
  assert.doesNotMatch(result.text, /someone@example\.org/);
});

test('the CLI refuses to run without a body file', () => {
  const result = runCli([], process.cwd());
  assert.equal(result.exitCode, 2);
  assert.match(result.text, /--body/);
});

// CI mode: the same checks, fed from the pull request's API data (no PR code runs).
test('addedLinesFromPatch numbers added lines in the new file, counting context lines', () => {
  const patch = '@@ -1,2 +1,3 @@\n a\n+new one\n b';
  assert.deepEqual(addedLinesFromPatch('docs/x.md', patch), [{ file: 'docs/x.md', line: 2, text: 'new one' }]);
});

test('namedListPathFor maps a branch to its named-test list', () => {
  assert.equal(namedListPathFor('trunk/god-ux-chat-9'), 'scripts/feature-batch-ci-named/trunk-god-ux-chat-9.txt');
});

test('CI input from API data flags a personal path in a patch and a missing named list', () => {
  const files = [
    { filename: 'scripts/x.mjs', patch: '@@ -0,0 +1 @@\n+see /Users/example/Desktop/x' },
    { filename: 'engine/src/b.test.ts', patch: '@@ -0,0 +1 @@\n+x' },
  ];
  const commits = [{ sha: 'abc1234', commit: { message: 'feat: x', author: { email: NOREPLY }, committer: { email: NOREPLY, date: '2026-10-09T12:00:00Z' } } }];
  const input = inputFromApi({ headBranch: BRANCH, headSha: SHA, files, commits, listText: null });
  const problems = runPreflight({ ...input, body: BODY, protectedPaths: PROTECTED });
  assert.deepEqual(checksOf(problems).sort(), ['named-tests', 'personal-info']);
});

test('a file the API returned without a patch fails closed, not as clean', () => {
  const files = [{ filename: 'assets/big.json', status: 'modified', changes: 4000 }];
  assert.deepEqual(unverifiedFileNames(files), ['assets/big.json']);
  const commits = [{ sha: 'abc1234', commit: { message: 'feat: x', author: { email: NOREPLY }, committer: { email: NOREPLY, date: '2026-10-09T12:00:00Z' } } }];
  const input = inputFromApi({ headBranch: BRANCH, headSha: SHA, files, commits, listText: null });
  const problems = runPreflight({ ...input, body: BODY, protectedPaths: PROTECTED });
  assert.deepEqual(checksOf(problems), ['personal-info']);
  assert.match(problems[0].message, /cannot check assets\/big\.json/);
});

test('removed files and zero-change renames without a patch are not unverified', () => {
  const files = [
    { filename: 'gone.md', status: 'removed', changes: 40 },
    { filename: 'moved.md', status: 'renamed', changes: 0 },
  ];
  assert.deepEqual(unverifiedFileNames(files), []);
});

test('CI mode names every check it cannot run, instead of passing it silently', () => {
  assert.deepEqual(ciSkippedLines(), [
    'skipped: clean-tree (needs local repo)',
    'skipped: window-clean (needs local repo)',
    'skipped: shard-budget (needs local repo)',
  ]);
});

test('CI input from clean API data passes', () => {
  const files = [{ filename: 'scripts/x.mjs', patch: '@@ -0,0 +1 @@\n+export const x = 1;' }];
  const commits = [{ sha: 'abc1234', commit: { message: 'feat: x', author: { email: NOREPLY }, committer: { email: NOREPLY, date: '2026-10-09T12:00:00Z' } } }];
  const input = inputFromApi({ headBranch: BRANCH, headSha: SHA, files, commits, listText: null });
  assert.deepEqual(runPreflight({ ...input, body: BODY, protectedPaths: PROTECTED }), []);
});

test('the CI preflight budget comes from PREFLIGHT_WAIT_SECONDS, with a safe default', () => {
  assert.equal(preflightBudgetSeconds({ PREFLIGHT_WAIT_SECONDS: '90' }), 90);
  assert.equal(preflightBudgetSeconds({}), 120);
  assert.equal(preflightBudgetSeconds({ PREFLIGHT_WAIT_SECONDS: 'later' }), 120);
});

test('CI preflight needs no --body file, reads the live inputs, and applies one job-wide budget', () => {
  try {
    const result = runCli(['--ci'], process.cwd(), { PREFLIGHT_WAIT_SECONDS: '90' }, { ciInput: () => withInput({}) });
    assert.equal(result.exitCode, 0, result.text);
    assert.equal(gateApiBudget.budgetSeconds, 90);
    assert.ok(Number.isFinite(gateApiBudget.startedAt));
  } finally {
    gateApiBudget.budgetSeconds = undefined;
    gateApiBudget.startedAt = undefined;
  }
});

test('a CI read that outlasts the budget fails closed with a clear message, not as a preflight failure', () => {
  try {
    const result = runCli(['--ci'], process.cwd(), {}, {
      ciInput: () => { throw Object.assign(new Error('gh: API rate limit exceeded (HTTP 403)'), {}); },
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.text, /could not read GitHub within its 120s budget/);
    assert.match(result.text, /not a preflight failure/);
  } finally {
    gateApiBudget.budgetSeconds = undefined;
    gateApiBudget.startedAt = undefined;
  }
});

function cliHistoryRepo(after) {
  const dir = mkdtempSync(path.join(tmpdir(), 'preflight-final-head-'));
  const git = (args) => execFileSync('git', [
    '-C', dir,
    '-c', 'user.name=Final Head',
    '-c', `user.email=${NOREPLY}`,
    '-c', 'commit.gpgsign=false',
    ...args,
  ], { encoding: 'utf8', windowsHide: true });
  git(['init', '-q', '-b', 'main']);
  writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(['add', 'base.txt']);
  git(['commit', '-q', '-m', 'base']);
  git(['checkout', '-q', '-b', 'gate/history']);
  writeFileSync(path.join(dir, 'base.txt'), 'feature\n');
  git(['add', 'base.txt']);
  git(['commit', '-q', '-m', 'feature']);
  const named = git(['rev-parse', 'HEAD']).trim();
  git(['checkout', '-q', 'main']);
  writeFileSync(path.join(dir, 'main-1.txt'), 'main 1\n');
  git(['add', 'main-1.txt']);
  git(['commit', '-q', '-m', 'main 1']);
  git(['checkout', '-q', 'gate/history']);
  after(git, dir);
  const bodyDir = mkdtempSync(path.join(tmpdir(), 'preflight-body-'));
  const bodyPath = path.join(bodyDir, 'body.md');
  writeFileSync(bodyPath, `Final head: ${named}\n\nNo visible change: history check only.\n`);
  return { dir, bodyDir, bodyPath };
}

test('the CLI accepts an old Final head when the only later commit merges main', () => {
  const { dir, bodyDir, bodyPath } = cliHistoryRepo((git) => {
    git(['merge', '-q', '--no-ff', 'main', '-m', 'merge main']);
  });
  try {
    const result = runCli(['--body', bodyPath, '--base', 'main'], dir);
    assert.equal(result.exitCode, 0, result.text);
    assert.equal(result.text, 'preflight: ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bodyDir, { recursive: true, force: true });
  }
});

test('the CLI ignores a Final head when a regular commit follows it', () => {
  const { dir, bodyDir, bodyPath } = cliHistoryRepo((git, repo) => {
    writeFileSync(path.join(repo, 'base.txt'), 'more\n');
    git(['add', 'base.txt']);
    git(['commit', '-q', '-m', 'regular']);
  });
  try {
    const result = runCli(['--body', bodyPath, '--base', 'main'], dir);
    assert.equal(result.exitCode, 0, result.text);
    assert.equal(result.text, 'preflight: ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bodyDir, { recursive: true, force: true });
  }
});
