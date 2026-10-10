import assert from 'node:assert/strict';
import test from 'node:test';
import { formatProblems, NOREPLY_EMAIL, runPreflight, TRAILER } from './pr-preflight.mjs';

const SHA = 'a'.repeat(40);
const BRANCH = 'trunk/pr-preflight';
const LIST = 'scripts/feature-batch-ci-named/trunk-pr-preflight.txt';
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
  'Tests: node --test scripts/pr-preflight.test.mjs -> 12 passed, 0 failed',
  'Brief/FIX points: 1: done',
  'Trailer and emails: ok',
].join('\n');
const GOOD_COMMIT = {
  sha: 'aaaaaaa',
  message: `feat: add preflight\n\n${TRAILER}`,
  authorEmail: NOREPLY_EMAIL,
  committerEmail: NOREPLY_EMAIL,
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
};
const withInput = (overrides) => ({ ...VALID, ...overrides });
const checksOf = (problems) => problems.map((p) => p.check);

test('a clean branch and body produce no problems', () => {
  assert.deepEqual(runPreflight(VALID), []);
  assert.equal(formatProblems([]), 'preflight: ok');
});

test('a dirty working tree is reported with a fix', () => {
  const problems = runPreflight(withInput({ dirtyCount: 3 }));
  assert.deepEqual(checksOf(problems), ['clean-tree']);
  assert.match(formatProblems(problems), /3 uncommitted change\(s\)\. Fix: commit or stash/);
});

test('a personal author email fails the commit-email rule', () => {
  const commit = { ...GOOD_COMMIT, authorEmail: 'someone@gmail.com' };
  const problems = runPreflight(withInput({ commits: [commit] }));
  assert.deepEqual(checksOf(problems), ['commit-email']);
  assert.match(problems[0].fix, new RegExp(NOREPLY_EMAIL.replace(/[.+]/g, '\\$&')));
});

test('a commit without the Taofik trailer is reported', () => {
  const commit = { ...GOOD_COMMIT, message: 'feat: add preflight' };
  assert.deepEqual(checksOf(runPreflight(withInput({ commits: [commit] }))), ['trailer']);
});

test('an AI co-author on anthropic.com fails the gate address rule', () => {
  const commit = { ...GOOD_COMMIT, message: `feat: x\n\n${TRAILER}\nCo-Authored-By: Claude <noreply@anthropic.com>` };
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
  const shardResult = { ok: false, detail: 'shard is 760s, over the 720s budget' };
  const problems = runPreflight(withInput({ shardResult }));
  assert.deepEqual(checksOf(problems), ['shard-budget']);
  assert.match(problems[0].message, /760s/);
});

test('changing a gate file is flagged for its own PR and marker', () => {
  const problems = runPreflight(withInput({ changedFiles: ['scripts/merge-gate-trusted.mjs'] }));
  assert.deepEqual(checksOf(problems), ['gate-files']);
  assert.match(problems[0].fix, /its own PR/);
});

test('a personal path or email in an added line fails', () => {
  const addedLines = [{ file: 'docs/notes.md', line: 3, text: 'see /Users/taofikbishi/Desktop/x' }];
  const problems = runPreflight(withInput({ addedLines }));
  assert.deepEqual(checksOf(problems), ['personal-info']);
  assert.match(problems[0].message, /docs\/notes\.md:3/);
});

test('personal-looking fixtures in a test file are exempt', () => {
  const addedLines = [{ file: 'scripts/x.test.mjs', line: 9, text: 'const who = "someone@gmail.com";' }];
  assert.deepEqual(runPreflight(withInput({ addedLines })), []);
});

test('formatProblems prints one line per problem plus a count', () => {
  const problems = runPreflight(withInput({ dirtyCount: 1, addedLines: [{ file: 'a.md', line: 1, text: 'x@gmail.com' }] }));
  const lines = formatProblems(problems).split('\n');
  assert.equal(lines.length, problems.length + 1);
  assert.equal(lines.at(-1), `preflight: ${problems.length} problem(s)`);
});
