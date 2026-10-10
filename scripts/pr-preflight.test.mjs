import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  addedLinesFromPatch,
  cloudAgentTrailer,
  ciSkippedLines,
  formatProblems,
  inputFromApi,
  unverifiedFileNames,
  namedListPathFor,
  runCli,
  runPreflight,
  scopedChecks,
} from './pr-preflight.mjs';

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

test('a stale Final head after a new push fails', () => {
  const stale = BODY.replace(SHA, 'b'.repeat(40));
  const problems = runPreflight(withInput({ body: stale }));
  assert.deepEqual(checksOf(problems), ['self-check']);
  assert.match(problems[0].message, /Final head bbbbbbbbb is stale/);
  assert.match(problems[0].fix, new RegExp(`Final head: ${SHA}`));
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
  assert.match(problems[0].fix, /Do not add it yourself/);
});

test('the gate marker for this exact head satisfies the gate-file rule; a marker for another head does not', () => {
  const gated = { changedFiles: ['scripts/merge-gate-trusted.test.mjs'] };
  assert.deepEqual(checksOf(runPreflight(withInput({ ...gated, body: `${BODY}
gate-change-reviewed: ${SHA}` }))), []);
  assert.deepEqual(checksOf(runPreflight(withInput({ ...gated, body: `${BODY}
gate-change-reviewed: ${'b'.repeat(40)}` }))), ['gate-files']);
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
