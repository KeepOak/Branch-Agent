import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkSelfCheck, findSelfCheckBlock, formatSelfCheckSummary, inputFromEvent, isTrunkBranch, resolveSelfCheckInput, SELF_CHECK_DOC } from './check-self-check.mjs';
import { runPreflight } from './pr-preflight.mjs';
import {
  COVERAGE_RATE_LIMIT_BUFFER_SECONDS,
  COVERAGE_RATE_LIMIT_BUDGET_SECONDS,
  LIVE_READ_ATTEMPTS,
  liveContext,
  readLivePullRequest,
} from './live-pull-request.mjs';

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
  assert.deepEqual(inputFromEvent({}), { headRef: '', body: '', headSha: '' });
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
      if (calls < 3) throw new Error('gh: Server Error (HTTP 502)');
      return { body: 'live', head: { ref: 'trunk/live-body', sha: HEAD } };
    },
    sleep: (seconds) => sleeps.push(seconds),
  });
  assert.deepEqual(pr, { body: 'live', headRef: 'trunk/live-body', headSha: HEAD });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [5, 10]);
});

function rateLimitError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

test('the live gh read waits on x-ratelimit-reset from gh api --include', () => {
  const start = 1_700_000_000_000;
  let now = start;
  let calls = 0;
  const sleeps = [];
  const denied = [
    'HTTP/2.0 403 Forbidden',
    'X-RateLimit-Remaining: 0',
    `X-RateLimit-Reset: ${start / 1000 + 30}`,
    '',
    '{"message":"API rate limit exceeded for installation"}',
  ].join('\n');
  const ok = [
    'HTTP/2.0 200 OK',
    'X-RateLimit-Remaining: 4999',
    '',
    JSON.stringify({ body: 'from-api', head: { ref: 'trunk/live-body', sha: HEAD } }),
  ].join('\n');
  const pr = readLivePullRequest(LIVE_CTX, {
    exec: () => {
      calls += 1;
      if (calls === 1) {
        const error = new Error('Command failed: gh api repos/o/r/pulls/7');
        error.stdout = denied;
        error.stderr = 'gh: API rate limit exceeded for installation (HTTP 403)';
        throw error;
      }
      return ok;
    },
    sleep: (seconds) => {
      sleeps.push(seconds);
      now += seconds * 1000;
    },
    now: () => now,
    fetchRateLimit: () => { throw new Error('headers are enough'); },
    log: () => {},
  });
  assert.equal(pr.body, 'from-api');
  assert.equal(pr.headRef, 'trunk/live-body');
  assert.equal(pr.headSha, HEAD);
  assert.deepEqual(sleeps, [30 + COVERAGE_RATE_LIMIT_BUFFER_SECONDS]);
});

test('readLivePullRequest waits out a rate-limit 403 until reset plus a buffer, then succeeds', () => {
  const start = 1_700_000_000_000;
  let now = start;
  const sleeps = [];
  let calls = 0;
  const pr = readLivePullRequest(LIVE_CTX, {
    request: () => {
      calls += 1;
      if (calls === 1) {
        throw rateLimitError('gh: API rate limit exceeded for installation (HTTP 403)', {
          httpStatus: 403,
          headers: { 'x-ratelimit-reset': String(start / 1000 + 40), 'x-ratelimit-remaining': '0' },
          body: '{"message":"API rate limit exceeded for installation"}',
        });
      }
      return { body: 'live', head: { ref: 'trunk/live-body', sha: HEAD } };
    },
    sleep: (seconds) => {
      sleeps.push(seconds);
      now += seconds * 1000;
    },
    now: () => now,
    fetchRateLimit: () => ({ resources: { core: { remaining: 0, reset: start / 1000 + 90 } } }),
    log: () => {},
  });
  assert.deepEqual(pr, { body: 'live', headRef: 'trunk/live-body', headSha: HEAD });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [40 + COVERAGE_RATE_LIMIT_BUFFER_SECONDS]);
});

test('readLivePullRequest waits out a secondary rate limit from gh api rate_limit when the error has no reset header', () => {
  const start = 1_700_000_000_000;
  let now = start;
  const sleeps = [];
  let calls = 0;
  const pr = readLivePullRequest(LIVE_CTX, {
    request: () => {
      calls += 1;
      if (calls === 1) throw rateLimitError('gh: You have exceeded a secondary rate limit (HTTP 403)', { httpStatus: 403 });
      return { body: 'live', head: { ref: 'trunk/live-body', sha: HEAD } };
    },
    sleep: (seconds) => {
      sleeps.push(seconds);
      now += seconds * 1000;
    },
    now: () => now,
    fetchRateLimit: () => ({ resources: { core: { remaining: 0, reset: start / 1000 + 25 } } }),
    log: () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [25 + COVERAGE_RATE_LIMIT_BUFFER_SECONDS]);
  assert.equal(pr.body, 'live');
});

test('readLivePullRequest waits exactly retry-after for a 429 without a reset buffer', () => {
  let now = 1_700_000_000_000;
  let calls = 0;
  const sleeps = [];
  const pr = readLivePullRequest(LIVE_CTX, {
    request: () => {
      if (++calls === 1) {
        throw rateLimitError('Too many requests', {
          httpStatus: 429,
          headers: { 'retry-after': '20' },
        });
      }
      return { body: 'live', head: { ref: 'trunk/live-body', sha: HEAD } };
    },
    sleep: (seconds) => {
      sleeps.push(seconds);
      now += seconds * 1000;
    },
    now: () => now,
    fetchRateLimit: () => null,
    log: () => {},
  });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [20]);
  assert.deepEqual(pr, { body: 'live', headRef: 'trunk/live-body', headSha: HEAD });
});

test('the live pull request CLI fails without writing a snapshot when rate limiting persists', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'live-pr-rate-limit-'));
  const out = path.join(dir, 'snapshot.json');
  try {
    const entry = new URL('./live-pull-request.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { main } from ${JSON.stringify(entry)};
      let now = 1_700_000_000_000;
      process.exitCode = main([${JSON.stringify(out)}], {
        env: { REPO: 'o/r', PR_NUMBER: '7', GH_TOKEN: 'fake-token' },
        request: () => {
          throw Object.assign(new Error('API rate limit exceeded'), {
            httpStatus: 403,
            headers: { 'retry-after': '20' },
          });
        },
        sleep: (seconds) => { now += seconds * 1000; },
        now: () => now,
        budgetSeconds: 30,
        fetchRateLimit: () => null,
        log: () => {},
      });
    `], { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^checks-unavailable: GitHub API rate limit outlasted the 30s wait/);
    assert.equal(existsSync(out), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-rate-limit 403, 404, or 500 fails without waiting for a rate-limit reset', () => {
  for (const status of [403, 404, 500]) {
    const sleeps = [];
    let calls = 0;
    const message = status === 403
      ? 'gh: Resource not accessible by integration (HTTP 403)'
      : `gh: HTTP ${status}`;
    assert.throws(() => readLivePullRequest(LIVE_CTX, {
      request: () => {
        calls += 1;
        throw rateLimitError(message, {
          httpStatus: status,
          headers: { 'x-ratelimit-remaining': '12' },
          body: status === 403 ? '{"message":"Resource not accessible by integration"}' : '',
        });
      },
      sleep: (seconds) => sleeps.push(seconds),
      fetchRateLimit: () => { throw new Error('rate_limit must not be read'); },
      log: () => {},
    }), new RegExp(`HTTP ${status}.*after ${LIVE_READ_ATTEMPTS} attempts`));
    assert.equal(calls, LIVE_READ_ATTEMPTS);
    assert.deepEqual(sleeps, [5, 10, 20]);
  }
});

test('a rate limit that outlasts the wait budget fails and is not reported as missing coverage', () => {
  const start = 1_700_000_000_000;
  let now = start;
  const sleeps = [];
  assert.throws(() => readLivePullRequest(LIVE_CTX, {
    request: () => {
      throw rateLimitError('gh: API rate limit exceeded for installation (HTTP 403)', { httpStatus: 403 });
    },
    sleep: (seconds) => {
      sleeps.push(seconds);
      now += seconds * 1000;
    },
    now: () => now,
    budgetSeconds: 100,
    bufferSeconds: COVERAGE_RATE_LIMIT_BUFFER_SECONDS,
    fetchRateLimit: () => ({ resources: { core: { remaining: 0, reset: start / 1000 + 10_000 } } }),
    log: () => {},
  }), (error) => {
    assert.match(error.message, /^checks-unavailable: GitHub API rate limit outlasted the 100s wait/);
    assert.match(error.message, /Not a coverage failure; re-run the check/);
    return true;
  });
  const waited = sleeps.reduce((sum, seconds) => sum + seconds, 0);
  assert.ok(waited <= 100, `waited ${waited}s, over the 100s cap`);
  assert.ok(waited >= 100 - COVERAGE_RATE_LIMIT_BUFFER_SECONDS);
});

test('the changed-test-coverage job timeout outlasts the rate-limit wait budget', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  const job = yaml.slice(yaml.indexOf('  changed-test-coverage:'), yaml.indexOf('  merge-gate:'));
  const timeoutMinutes = Number(/timeout-minutes:\s*(\d+)/.exec(job)?.[1]);
  assert.equal(timeoutMinutes, 15);
  assert.ok(timeoutMinutes <= 15);
  assert.equal(COVERAGE_RATE_LIMIT_BUDGET_SECONDS, 600);
  assert.ok(
    timeoutMinutes * 60 >= COVERAGE_RATE_LIMIT_BUDGET_SECONDS + 3 * 60,
    `timeout ${timeoutMinutes}m must leave 3 minutes after the ${COVERAGE_RATE_LIMIT_BUDGET_SECONDS}s wait`,
  );
});

test('readLivePullRequest gives up after its attempts with a clear message', () => {
  let calls = 0;
  assert.throws(() => readLivePullRequest(LIVE_CTX, {
    request: () => { calls += 1; throw new Error('gh: Server Error (HTTP 502)'); },
    sleep: () => {},
  }), new RegExp(`HTTP 502.*after ${LIVE_READ_ATTEMPTS} attempts`));
  assert.equal(calls, LIVE_READ_ATTEMPTS);
});

test('a stale or missing Final head line is ignored when the real head is known', () => {
  assert.equal(checkSelfCheck({ headRef: 'trunk/live-body', body: selfCheckBody(OLD), headSha: HEAD }).ok, true);
  const noFinal = selfCheckBody(HEAD).replace(/Final head:.*\n/, '');
  assert.equal(checkSelfCheck({ headRef: 'trunk/live-body', body: noFinal, headSha: HEAD }).ok, true);
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

test('the PR snapshot file is the body the check reads, with no live read', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'self-check-snapshot-'));
  try {
    const file = path.join(dir, 'pr-snapshot.json');
    writeFileSync(file, JSON.stringify({ body: selfCheckBody(HEAD), headRef: 'trunk/snap', headSha: HEAD }));
    const input = resolveSelfCheckInput({
      env: { PR_SNAPSHOT_FILE: file, REPO: 'o/r', PR_NUMBER: '1', GH_TOKEN: 'x', GITHUB_ACTIONS: 'true' },
      read: () => { throw new Error('the live API must not be read when a snapshot is given'); },
    });
    assert.deepEqual(input, { headRef: 'trunk/snap', body: selfCheckBody(HEAD), headSha: HEAD });
    assert.equal(checkSelfCheck(input).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing PR snapshot fails closed: no fallback to the payload or the API', () => {
  assert.throws(() => resolveSelfCheckInput({
    env: { PR_SNAPSHOT_FILE: '/nonexistent/pr-snapshot.json', REPO: 'o/r', PR_NUMBER: '1', GH_TOKEN: 'x', GITHUB_ACTIONS: 'true' },
    read: () => { throw new Error('must not be called'); },
  }), /ENOENT/);
});

const HISTORY_EMAIL = '12345+person@users.noreply.github.com';

function historyGit(dir) {
  return (args) => execFileSync('git', [
    '-C', dir,
    '-c', 'user.name=Final Head',
    '-c', `user.email=${HISTORY_EMAIL}`,
    '-c', 'commit.gpgsign=false',
    ...args,
  ], { encoding: 'utf8', windowsHide: true });
}

function initFeatureRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'final-head-'));
  const git = historyGit(dir);
  git(['init', '-q', '-b', 'main']);
  writeFileSync(path.join(dir, 'base.txt'), 'base\n');
  git(['add', 'base.txt']);
  git(['commit', '-q', '-m', 'base']);
  git(['checkout', '-q', '-b', 'feature']);
  writeFileSync(path.join(dir, 'base.txt'), 'feature\n');
  git(['add', 'base.txt']);
  git(['commit', '-q', '-m', 'feature']);
  const named = git(['rev-parse', 'HEAD']).trim();
  git(['checkout', '-q', 'main']);
  writeFileSync(path.join(dir, 'main-1.txt'), 'main 1\n');
  git(['add', 'main-1.txt']);
  git(['commit', '-q', '-m', 'main 1']);
  git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  git(['checkout', '-q', 'feature']);
  return { dir, git, named };
}

function mergeMain(git) {
  git(['merge', '-q', '--no-ff', 'main', '-m', 'merge main']);
  return git(['rev-parse', 'HEAD']).trim();
}

function expectIgnoredFinalHead(dir, named, head) {
  const checked = checkSelfCheck({
    headRef: 'trunk/live-body',
    body: selfCheckBody(named),
    headSha: head,
    repoDir: dir,
  });
  const problems = runPreflight({
    branch: 'trunk/live-body',
    headSha: head,
    body: selfCheckBody(named),
    dirtyCount: 0,
    commits: [],
    changedFiles: [],
    addedLines: [],
    listText: null,
    listPath: 'scripts/feature-batch-ci-named/trunk-live-body.txt',
    repoDir: dir,
    protectedPaths: new Set(),
  });
  assert.equal(checked.ok, true, checked.problems.join('\n'));
  assert.deepEqual(problems, []);
}

test('a PR with main merged in and an old Final head line still passes', () => {
  const { dir, git, named } = initFeatureRepo();
  try {
    expectIgnoredFinalHead(dir, named, mergeMain(git));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commit-emails and preflight use the event or API head, not a Final head line', () => {
  const trusted = readFileSync(new URL('../.github/workflows/merge-gate-trusted.yml', import.meta.url), 'utf8');
  const emails = trusted.slice(trusted.indexOf('  commit-emails:'), trusted.indexOf('  merge-gate-trusted:'));
  assert.match(emails, /HEAD_SHA:\s*\$\{\{\s*github\.event\.pull_request\.head\.sha\s*\}\}/);
  assert.doesNotMatch(emails, /Final head/);
  const selfCheck = readFileSync(new URL('./check-self-check.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(selfCheck, /Final head:/);
  const preflight = readFileSync(new URL('./pr-preflight.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(preflight, /Final head:/);
  for (const rel of ['../AGENTS.md', '../docs/SELF-CHECK.md', '../.github/pull_request_template.md', '../CONTRIBUTING.md']) {
    assert.doesNotMatch(readFileSync(new URL(rel, import.meta.url), 'utf8'), /Final head:/);
  }
});

test('the reviewer, not GOD, adds the gate-change-reviewed line', () => {
  const rule = /The reviewer \(Branch PR Closer\) adds the `gate-change-reviewed: <head sha>` line/;
  for (const rel of ['../AGENTS.md', '../CONTRIBUTING.md', '../docs/CHECKPOINT.md', '../.cursor/BUGBOT.md']) {
    const text = readFileSync(new URL(rel, import.meta.url), 'utf8');
    assert.match(text, rule, rel);
    assert.doesNotMatch(text, /GOD adds the gate-change-reviewed/);
  }
  const preflight = readFileSync(new URL('./pr-preflight.mjs', import.meta.url), 'utf8');
  assert.match(preflight, /the reviewer \(Branch PR Closer\) adds the gate-change-reviewed: <head sha> line/);
  assert.doesNotMatch(preflight, /GOD adds the gate-change-reviewed/);
});
