import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkSelfCheck, findSelfCheckBlock, formatSelfCheckSummary, inputFromEvent, isTrunkBranch, resolveSelfCheckInput, SELF_CHECK_DOC } from './check-self-check.mjs';
import { LIVE_READ_ATTEMPTS, liveContext, readLivePullRequest } from './live-pull-request.mjs';

const filled = 'SELF-CHECK\nFiles: 3 (all expected: yes)\nTests: node --test example.test.mjs -> 5 passed, 0 failed';
const check = (body) => checkSelfCheck({ headRef: 'trunk/x', body });
const problems = (body) => check(body).problems.join('\n');

test('filled fenced block passes and summary reports counts', () => {
  const result = check(`\`\`\`\n${filled}\n\`\`\``);
  assert.equal(result.ok, true);
  assert.deepEqual(result.problems, []);
  assert.equal(SELF_CHECK_DOC, 'docs/SELF-CHECK.md');
  assert.equal(formatSelfCheckSummary(result), '## SELF-CHECK block\nSELF-CHECK block found: Files 3, Tests 5 passed, 0 failed.');
});

test('heading and bullet label counts pass', () => {
  assert.equal(check('## SELF-CHECK\n- Files (3): example.mjs\n- Tests: example -> 5 passed, 0 failed').ok, true);
  assert.equal(check('**SELF-CHECK**\n* Files: 3\n* Tests: example -> 5 passed, 0 failed').ok, true);
});

test('last standalone header counts and boundaries stop the block', () => {
  assert.equal(check(`${filled}\n\nSELF-CHECK\nFiles: 1`).ok, false);
  assert.equal(findSelfCheckBlock('text SELF-CHECK text'), null);
  assert.deepEqual(findSelfCheckBlock(`\`\`\`\nSELF-CHECK\n\`\`\`\n${filled}`), filled.split('\n').slice(1));
  assert.deepEqual(findSelfCheckBlock(`\`\`\`\nSELF-CHECK\n\`\`\`\nFiles: 1\nTests: 1 passed, 0 failed`), []);
  for (const boundary of ['\n', '```', '## Next']) {
    assert.deepEqual(findSelfCheckBlock(`SELF-CHECK\nFiles: 1\n${boundary}\nTests: 1 passed, 0 failed`), ['Files: 1']);
  }
  assert.equal(check(`## SELF-CHECK\n\n\`\`\`text\n${filled.split('\n').slice(1).join('\n')}\n\`\`\``).ok, true);
});

test('missing block gives exactly one documented problem', () => {
  const result = check('no block');
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /SELF-CHECK.*docs\/SELF-CHECK\.md/);
  assert.equal(formatSelfCheckSummary(result), `## SELF-CHECK block\n${result.problems[0]}`);
});

test('template placeholders and absent counts fail in rule order', () => {
  const body = 'SELF-CHECK\nFiles: <n> (all expected: yes/no)\nTests: <commands> -> <n> passed, <n> failed';
  const result = check(body);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /does not give a number/);
  assert.match(result.problems[1], /Files.*placeholder.*"<n>"/);
  assert.match(result.problems[2], /no passed count/);
  assert.match(result.problems[3], /no failed count/);
  assert.match(result.problems[4], /Tests.*placeholder.*"<commands>"/);
  assert.ok(result.problems.every((sentence) => sentence.endsWith('(docs/SELF-CHECK.md).')));
  for (const token of ['yes/no', 'pass/fail', 'TBD', 'TODO', '<commands>']) {
    assert.match(problems(`SELF-CHECK\nFiles: 1 ${token}\nTests: 1 passed, 0 failed ${token}`), /Files.*placeholder/);
    assert.match(problems(`SELF-CHECK\nFiles: 1\nTests: 1 passed, 0 failed ${token}`), /Tests.*placeholder/);
  }
  assert.match(problems('SELF-CHECK\nFiles: 1\nTests: TBD'), /placeholder/);
  assert.match(problems('SELF-CHECK\nFiles: 1\nTests: x -> 12/12 passed'), /no failed count/);
  assert.equal(check('SELF-CHECK\nFiles: 1\nTests: todo-test -> 1 passed, 0 failed').ok, true);
});

test('missing Files and nonnumeric Files fail', () => {
  const result = check('SELF-CHECK\nTests: 1 passed, 0 failed');
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /no Files line/);
  assert.match(problems(filled.replace('3 (all expected: yes)', 'manager.ts + test')), /does not give a number/);
  assert.match(problems(filled.replace('3 (all expected: yes)', '3files')), /does not give a number/);
});

test('missing Tests and zero passed fail', () => {
  assert.match(problems('SELF-CHECK\nFiles: 1'), /no Tests line/);
  assert.match(problems('SELF-CHECK\nFiles: 1\nTests: 0 passed, 0 failed'), /no tests passed/);
});

test('nonzero failures require a reason in their own semicolon part', () => {
  assert.match(problems('SELF-CHECK\nFiles: 1\nTests: 3 passed, 1 failed'), /reports 1 failed without saying why/);
  assert.equal(check('SELF-CHECK\nFiles: 1\nTests: -> 6 passed, 0 failed; same file on base -> 2 passed, 4 failed').ok, true);
  assert.equal(check('SELF-CHECK\nFiles: 1\nTests: 3 passed, 1 failed (known failure: flaky upstream test)').ok, true);
  assert.equal(check('SELF-CHECK\nFiles: 1\nTests: 3 passed, 1 failed known failure:').ok, false);
  assert.equal(check('SELF-CHECK\nFiles: 1\nTests: on base 2 passed, 1 failed; 3 passed, 1 failed').ok, false);
});

test('count variants and indented test continuations are accepted and summed', () => {
  const result = check('SELF-CHECK\nFiles (2): a, b\nTests (commands):\n  first -> pass 2, failed: 0\n  second -> passed: 3, 0 fail\nTrailer and emails: ok');
  assert.equal(result.ok, true);
  assert.match(formatSelfCheckSummary(result), /Files 2, Tests 5 passed, 0 failed/);
  assert.equal(check('SELF-CHECK\nFiles: 1\nTests: 1 pass, fail 0').ok, true);
});

test('non-trunk branches skip without checking body', () => {
  for (const headRef of ['cursor/x', 'main', 'trunk-x', 'Trunk/x', undefined]) {
    assert.equal(isTrunkBranch(headRef), false);
    const result = checkSelfCheck({ headRef, body: '' });
    assert.deepEqual(result, { ok: true, skipped: true, problems: [] });
    assert.match(formatSelfCheckSummary(result), /nothing to check/);
  }
});

test('body edits on the same head change failure to success', () => {
  const event = { action: 'edited', pull_request: { head: { ref: 'trunk/x', sha: 'same-head' }, body: 'no block' } };
  assert.equal(checkSelfCheck(inputFromEvent(event)).ok, false);
  assert.equal(checkSelfCheck(inputFromEvent({ ...event, pull_request: { ...event.pull_request, body: filled } })).ok, true);
  assert.deepEqual(inputFromEvent({}), { headRef: '', body: '' });
});

test('CRLF blocks pass', () => {
  assert.equal(check(filled.replaceAll('\n', '\r\n')).ok, true);
});

test('untrusted body is text only and checker has no execution primitives', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'self-check-text-'));
  try {
    const marker = path.join(temp, 'pwned');
    const body = ['SELF-CHECK', 'Files: $(touch ' + marker + ')', 'Tests: `touch ' + marker + '` ${{ github.token }}'].join('\n');
    assert.equal(check(body).ok, false);
    assert.equal(existsSync(marker), false);
    const source = readFileSync(new URL('./check-self-check.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /child_process|\beval\s*\(|new Function|\bimport\s*\(/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('public doc template fails, example passes and no personal paths leak', () => {
  const doc = readFileSync(new URL('../docs/SELF-CHECK.md', import.meta.url), 'utf8');
  const blocks = [...doc.matchAll(/^```\r?\n(SELF-CHECK\r?\n[\s\S]*?)^```/gm)].map((match) => match[1]);
  assert.equal(blocks.length, 2);
  assert.equal(check(blocks[0]).ok, false);
  assert.equal(check(blocks.at(-1)).ok, true);
  assert.doesNotMatch(doc, /\/workspace|\/home\/|\/Users\/|C:\\Users/);
  assert.deepEqual(doc.match(/[\w.+-]+@[\w.-]+\.[a-z]+/gi), ['189563683+stabrea@users.noreply.github.com']);
});

test('CLI fails or passes, writes summary, skips non-trunk and fails closed on unreadable events', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'self-check-cli-'));
  try {
    const eventPath = path.join(temp, 'event.json');
    const summaryPath = path.join(temp, 'summary.md');
    const run = () => spawnSync(process.execPath, [fileURLToPath(new URL('./check-self-check.mjs', import.meta.url))], {
      cwd: temp, windowsHide: true, encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_EVENT_PATH: eventPath, GITHUB_STEP_SUMMARY: summaryPath },
    });
    for (const [headRef, body, exitCode, output] of [
      ['trunk/x', 'no block', 1, /no SELF-CHECK block/],
      ['trunk/x', filled, 0, /Files 3, Tests 5 passed, 0 failed/],
      ['cursor/x', '', 0, /nothing to check/],
    ]) {
      writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { ref: headRef }, body } }));
      writeFileSync(summaryPath, 'existing summary\n');
      const result = run();
      assert.equal(result.status, exitCode, result.stderr);
      assert.match(result.stdout + result.stderr, output);
      assert.match(readFileSync(summaryPath, 'utf8'), output);
      assert.ok(readFileSync(summaryPath, 'utf8').startsWith('existing summary\n## SELF-CHECK block'));
    }
    writeFileSync(eventPath, 'not JSON');
    assert.equal(run().status, 1);
    rmSync(eventPath);
    assert.match(run().stderr, /Could not read the pull request \(/);
    const missing = spawnSync(process.execPath, [fileURLToPath(new URL('./check-self-check.mjs', import.meta.url))], {
      windowsHide: true, encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', GITHUB_EVENT_PATH: '', GITHUB_STEP_SUMMARY: summaryPath },
    });
    assert.equal(missing.status, 1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

const HEAD = 'c'.repeat(40);
const OLD = 'd'.repeat(40);
const selfCheckBody = (finalHead) => [
  'Summary.',
  '',
  'SELF-CHECK',
  `Final head: ${finalHead}`,
  'Branch: trunk/live-body',
  'Base: origin/main abc1234',
  'Files: 2 (all expected: yes; CI test list: none needed)',
  'Tests: node --test scripts/check-self-check.test.mjs -> 3 passed, 0 failed',
  'Brief/FIX points: 1: done',
  'Trailer and emails: ok',
].join('\n');
const LIVE_CTX = { REPO: 'o/r', PR_NUMBER: '7', GH_TOKEN: 't' };

test('live mode needs a repo, a PR number and a token; otherwise the event file is used', () => {
  assert.equal(liveContext({}), null);
  assert.equal(liveContext({ REPO: 'o/r', PR_NUMBER: '7' }), null);
  assert.deepEqual(liveContext({ REPO: 'o/r', PR_NUMBER: '7', GITHUB_TOKEN: 'g' }), { repo: 'o/r', prNumber: '7', token: 'g' });
});

test('regression: the live body wins over a stale event payload that has no SELF-CHECK block', () => {
  const staleEvent = { pull_request: { head: { ref: 'trunk/live-body', sha: HEAD }, body: 'Old body with no block.' } };
  const input = resolveSelfCheckInput({
    env: { ...LIVE_CTX, GITHUB_EVENT_PATH: '/nonexistent/event.json' },
    read: () => ({ headRef: 'trunk/live-body', body: selfCheckBody(HEAD), headSha: HEAD }),
  });
  assert.equal(checkSelfCheck(input).ok, true);
  assert.equal(inputFromEvent(staleEvent).body.includes('SELF-CHECK'), false);
});

test('a failed live read fails closed; it never falls back to the payload', () => {
  assert.throws(() => resolveSelfCheckInput({
    env: { ...LIVE_CTX, GITHUB_EVENT_PATH: '/nonexistent/event.json' },
    read: () => { throw new Error('gh: Server Error (HTTP 502)'); },
  }), /HTTP 502/);
});

test('readLivePullRequest retries transient failures with a delay, then returns the body and head', () => {
  let calls = 0;
  const sleeps = [];
  const pr = readLivePullRequest(LIVE_CTX, {
    request: () => {
      calls += 1;
      if (calls < 3) throw new Error('gh: API rate limit exceeded (HTTP 403)');
      return { body: 'live', head: { ref: 'trunk/live-body', sha: HEAD } };
    },
    sleep: (seconds) => sleeps.push(seconds),
  });
  assert.deepEqual(pr, { body: 'live', headRef: 'trunk/live-body', headSha: HEAD });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [5, 10]);
});

test('readLivePullRequest gives up after its attempts with a clear message', () => {
  let calls = 0;
  assert.throws(() => readLivePullRequest(LIVE_CTX, {
    request: () => { calls += 1; throw new Error('gh: Server Error (HTTP 502)'); },
    sleep: () => {},
  }), new RegExp(`HTTP 502.*after ${LIVE_READ_ATTEMPTS} attempts`));
  assert.equal(calls, LIVE_READ_ATTEMPTS);
});

test('a Final head that is not the current head fails, and the current head passes', () => {
  assert.equal(checkSelfCheck({ headRef: 'trunk/live-body', body: selfCheckBody(OLD), headSha: HEAD }).ok, false);
  assert.match(checkSelfCheck({ headRef: 'trunk/live-body', body: selfCheckBody(OLD), headSha: HEAD }).problems.join('\n'), /not the current head/);
  assert.equal(checkSelfCheck({ headRef: 'trunk/live-body', body: selfCheckBody(HEAD), headSha: HEAD }).ok, true);
});

test('the merge gate reads the live body for its SELF-CHECK step and its UI-proof step', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  const selfStep = yaml.slice(yaml.indexOf('name: Require a SELF-CHECK block'));
  assert.match(selfStep.slice(0, 400), /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(selfStep.slice(0, 400), /GH_TOKEN: \$\{\{ github\.token \}\}/);
  const uiStep = yaml.slice(yaml.indexOf('name: Require screenshots for window UI changes'));
  assert.match(uiStep.slice(0, 400), /PR_NUMBER: \$\{\{ github\.event\.pull_request\.number \}\}/);
});

test('regression: a body with no Final head line fails when the head is known, instead of skipping the freshness check', () => {
  const noFinal = selfCheckBody(HEAD).replace(/Final head:.*\n/, '');
  const result = checkSelfCheck({ headRef: 'trunk/live-body', body: noFinal, headSha: HEAD });
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /no Final head line/);
  assert.equal(checkSelfCheck({ headRef: 'trunk/live-body', body: noFinal }).ok, true, 'no head known: nothing to compare');
});

test('regression: in CI a missing live context fails closed and never reads the event payload', () => {
  assert.throws(() => resolveSelfCheckInput({
    env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: '/nonexistent/event.json' },
    read: () => { throw new Error('must not be called'); },
  }), /CI needs REPO, PR_NUMBER and a token/);
  const temp = mkdtempSync(path.join(os.tmpdir(), 'self-check-local-'));
  try {
    const eventPath = path.join(temp, 'event.json');
    writeFileSync(eventPath, JSON.stringify({ pull_request: { head: { ref: 'trunk/live-body' }, body: selfCheckBody(HEAD) } }));
    const input = resolveSelfCheckInput({ env: { GITHUB_ACTIONS: '', GITHUB_EVENT_PATH: eventPath }, read: () => { throw new Error('unused'); } });
    assert.equal(input.headRef, 'trunk/live-body');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('the merge gate job that runs the SELF-CHECK and UI-proof steps declares pull-requests: read', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  const job = yaml.slice(yaml.indexOf('  changed-test-coverage:'), yaml.indexOf('  merge-gate:'));
  assert.match(job, /permissions:\n\s+contents: read\n\s+pull-requests: read/);
});
