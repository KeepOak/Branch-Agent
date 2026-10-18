// node --test scripts/check-commit-emails.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CUTOFF_ISO,
  COMMIT_EMAIL_WAIT_SECONDS,
  NOT_CHECKED,
  apiFailureLine,
  classifyFetchError,
  createEmailCheckApi,
  evaluateCommits,
  fetchPrCommitsWithApi,
  formatReport,
  runCommitEmailCheck,
} from './check-commit-emails.mjs';
import { isRateLimitError } from './merge-gate-rate-limit.mjs';

const AFTER = CUTOFF_ISO;
const BEFORE = '2026-10-08T04:04:59Z';
const NOREPLY = '12345+person@users.noreply.github.com';
const GMAIL = 'person@gmail.invalid';
const PERSONAL = 'person@example.com';
const BOT = '123456+dependabot[bot]@users.noreply.github.com';
const TRUSTED_WORKFLOW = new URL('../.github/workflows/merge-gate-trusted.yml', import.meta.url);

function githubCommit({
  sha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  message = 'feat: example',
  authorEmail = NOREPLY,
  committerEmail = NOREPLY,
  date = AFTER,
} = {}) {
  return {
    sha,
    commit: {
      message,
      author: { email: authorEmail, date },
      committer: { email: committerEmail, date },
    },
  };
}

function trailer(email, key = 'Co-authored-by') {
  return `${key}: Person <${email}>`;
}

function httpError(message, extra = {}) {
  return Object.assign(new Error(message), extra);
}

function rateLimitError(headers = {}) {
  return httpError('gh: API rate limit exceeded for installation (HTTP 403)', {
    httpStatus: 403,
    headers,
    body: '{"message":"API rate limit exceeded for installation"}',
  });
}

test('a noreply trailer passes', () => {
  const failures = evaluateCommits([githubCommit({
    message: `feat: example\n\n${trailer(NOREPLY)}`,
  })]);
  assert.deepEqual(failures, []);
});

test('a gmail trailer after the cutoff fails', () => {
  const failures = evaluateCommits([githubCommit({
    sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    message: `feat: example\n\n${trailer(GMAIL)}`,
    date: AFTER,
  })]);
  assert.deepEqual(failures, [
    { sha: 'bbbbbbb', field: 'co-author', hint: '***@gmail.invalid' },
  ]);
});

test('the same gmail trailer before the cutoff passes', () => {
  const failures = evaluateCommits([githubCommit({
    message: `feat: example\n\n${trailer(GMAIL)}`,
    date: BEFORE,
  })]);
  assert.deepEqual(failures, []);
});

test('a personal author email fails', () => {
  const failures = evaluateCommits([githubCommit({
    sha: 'cccccccccccccccccccccccccccccccccccccccc',
    authorEmail: PERSONAL,
  })]);
  assert.deepEqual(failures, [
    { sha: 'ccccccc', field: 'author', hint: '***@example.com' },
  ]);
});

test('a [bot] noreply address passes', () => {
  const failures = evaluateCommits([githubCommit({
    authorEmail: BOT,
    committerEmail: BOT,
    message: `feat: example\n\n${trailer(BOT)}`,
  })]);
  assert.deepEqual(failures, []);
});

test('cursoragent and github noreply addresses pass', () => {
  assert.deepEqual(evaluateCommits([githubCommit({
    authorEmail: 'cursoragent@cursor.com',
    committerEmail: 'noreply@github.com',
  })]), []);
});

test('a personal committer email fails', () => {
  const failures = evaluateCommits([githubCommit({
    sha: 'ffffffffffffffffffffffffffffffffffffffff',
    committerEmail: PERSONAL,
  })]);
  assert.deepEqual(failures, [
    { sha: 'fffffff', field: 'committer', hint: '***@example.com' },
  ]);
});

test('a lowercase co-authored-by trailer is still checked', () => {
  const failures = evaluateCommits([githubCommit({
    sha: 'dddddddddddddddddddddddddddddddddddddddd',
    message: `feat: example\n\n${trailer(GMAIL, 'co-authored-by')}`,
  })]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].field, 'co-author');
  assert.equal(failures[0].hint, '***@gmail.invalid');
});

test('the failure output never contains the full offending email', () => {
  const failures = evaluateCommits([githubCommit({
    sha: 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    message: `feat: example\n\n${trailer(GMAIL)}`,
    authorEmail: PERSONAL,
    committerEmail: PERSONAL,
  })]);
  const report = formatReport(failures);
  assert.equal(report.includes(GMAIL), false);
  assert.equal(report.includes(PERSONAL), false);
  assert.match(report, /eeeeeee co-author \*\*\*@gmail\.invalid/);
  assert.match(report, /eeeeeee author \*\*\*@example\.com/);
  assert.match(report, /eeeeeee committer \*\*\*@example\.com/);
  assert.match(report, /Cloud agents: end the commit message with `Co-authored-by: Taofik Bishi <189563683\+stabrea@users\.noreply\.github\.com>`\./);
  assert.match(report, /if this commit is already pushed, open a fresh branch from main with clean commits/);
});

test('reads every page of pull request commits in one paginated call', () => {
  const page1 = githubCommit({ sha: '1111111111111111111111111111111111111111' });
  const page2 = githubCommit({ sha: '2222222222222222222222222222222222222222' });
  const calls = [];
  const api = (_repo, _token, requestPath, options) => {
    calls.push({ requestPath, paginate: options.paginate });
    return [page1, page2];
  };
  const commits = fetchPrCommitsWithApi({
    repo: 'KeepOak/Branch-Agent',
    prNumber: '1',
    token: 'token',
    api,
  });
  assert.deepEqual(calls, [{
    requestPath: 'pulls/1/commits?per_page=100',
    paginate: true,
  }]);
  assert.deepEqual(commits.map((commit) => commit.sha), [
    '1111111111111111111111111111111111111111',
    '2222222222222222222222222222222222222222',
  ]);
});

test('the email check passes when every in-scope commit is allowed', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1', token: 't',
    api: () => [githubCommit({ authorEmail: NOREPLY, committerEmail: NOREPLY })],
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.conclusion, 'success');
  assert.match(result.lines[0], /Checked 1 commit\(s\)/);
});

test('a personal address fails with exit 1, not as an API failure', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1', token: 't',
    api: () => [githubCommit({ authorEmail: PERSONAL, committerEmail: NOREPLY })],
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.conclusion, 'failure');
  assert.match(result.lines[0], /author/);
});

test('a rate limit then a successful fetch passes the email check', () => {
  const start = 1_790_000_000_000;
  let now = start;
  const sleeps = [];
  let calls = 0;
  const headers = { 'x-ratelimit-reset': String(start / 1000 + 90), 'x-ratelimit-remaining': '0' };
  const api = createEmailCheckApi({
    now: () => now,
    sleep: (seconds) => { sleeps.push(seconds); now += seconds * 1000; },
    fetchRateLimit: () => null,
    random: () => 0.5,
    request: () => {
      calls += 1;
      if (calls === 1) throw rateLimitError(headers);
      return [githubCommit({ authorEmail: NOREPLY, committerEmail: NOREPLY })];
    },
  });
  const result = runCommitEmailCheck({ repo: 'o/r', prNumber: '1', token: 't', api });
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [90]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.conclusion, 'success');
  assert.match(result.lines[0], /Checked 1 commit\(s\)/);
});

test('a persistent rate limit reports not checked, never success or a red email failure', () => {
  const start = 1_790_000_000_000;
  let now = start;
  const api = createEmailCheckApi({
    budgetSeconds: 30,
    now: () => now,
    sleep: (seconds) => { now += seconds * 1000; },
    fetchRateLimit: () => null,
    random: () => 0.5,
    request: () => { throw rateLimitError(); },
  });
  const result = runCommitEmailCheck({ repo: 'o/r', prNumber: '1', token: 't', api });
  assert.equal(result.exitCode, 2);
  assert.equal(result.conclusion, 'neutral');
  assert.match(result.lines[0], new RegExp(NOT_CHECKED));
  assert.doesNotMatch(result.lines.join('\n'), /author|committer|co-author/);
  assert.equal(classifyFetchError(rateLimitError()).exitCode, 2);
  assert.equal(classifyFetchError(rateLimitError()).conclusion, 'neutral');
});

test('a generic 401 or 403 fails closed', () => {
  const cases = [
    {
      status: 401,
      error: httpError('gh: Bad credentials (HTTP 401)', {
        httpStatus: 401,
        headers: { 'x-ratelimit-remaining': '12' },
      }),
    },
    {
      status: 403,
      error: httpError('gh: Resource not accessible by integration (HTTP 403)', {
        httpStatus: 403,
        headers: { 'x-ratelimit-remaining': '12' },
        body: '{"message":"Resource not accessible by integration"}',
      }),
    },
  ];
  for (const { status, error } of cases) {
    assert.equal(isRateLimitError(error), false, String(status));
    const sleeps = [];
    const api = createEmailCheckApi({
      now: () => 1_790_000_000_000,
      sleep: (seconds) => sleeps.push(seconds),
      fetchRateLimit: () => { throw new Error('rate_limit must not be read'); },
      request: () => { throw error; },
    });
    const result = runCommitEmailCheck({ repo: 'o/r', prNumber: '1', token: 't', api });
    assert.equal(result.exitCode, 1, String(status));
    assert.equal(result.conclusion, 'failure', String(status));
    assert.match(result.lines[0], new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(result.lines[0], new RegExp(NOT_CHECKED));
    assert.deepEqual(sleeps, []);
  }
});

test('a 404 is reported as not retried and fails closed', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '929', token: 't',
    api: () => { throw httpError('gh: Not Found (HTTP 404)'); },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.conclusion, 'failure');
  assert.match(result.lines[0], /HTTP 404/);
  assert.match(result.lines[0], /not retried/);
  assert.doesNotMatch(result.lines[0], /gave up/);
  assert.doesNotMatch(result.lines[0], new RegExp(NOT_CHECKED));
});

test('the email check shares one job budget: a lasting rate limit cannot start a second wait', () => {
  let clock = 1_790_000_000_000;
  const sleeps = [];
  const now = () => clock;
  const api = createEmailCheckApi({
    budgetSeconds: COMMIT_EMAIL_WAIT_SECONDS,
    now,
    fetchRateLimit: () => null,
    random: () => 0.5,
    request: () => { throw rateLimitError(); },
    sleep: (seconds) => { sleeps.push(seconds); clock += seconds * 1000; },
  });
  assert.throws(() => api('o', 't', 'pulls/1/commits?per_page=100', { paginate: true }), /rate limit/);
  let secondError;
  try {
    api('o', 't', 'pulls/1/commits?per_page=100', { paginate: true });
  } catch (error) {
    secondError = error;
  }
  assert.ok(secondError, 'the second call must not get a fresh budget');
  const total = sleeps.reduce((sum, seconds) => sum + seconds, 0);
  assert.ok(total <= COMMIT_EMAIL_WAIT_SECONDS, `waited ${total}s, over the ${COMMIT_EMAIL_WAIT_SECONDS}s job budget`);
  assert.equal(secondError.budgetExhausted, true);
  assert.match(apiFailureLine(secondError, '1'), new RegExp(NOT_CHECKED));
  assert.match(apiFailureLine(secondError, '1'), /job budget/);
  assert.match(apiFailureLine(secondError, '1'), /Not a commit-email failure/);
});

test('the trusted workflow retries through the helper and skips commit-emails on exit 2', () => {
  const yaml = readFileSync(TRUSTED_WORKFLOW, 'utf8');
  const source = readFileSync(new URL('./check-commit-emails.mjs', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/merge-gate-rate-limit\.mjs'/);
  assert.match(source, /withRateLimitRetry/);
  assert.match(source, /paginate: true/);
  assert.match(yaml, /commit-emails-run:/);
  assert.match(yaml, /^\s+commit-emails:\n\s+needs: commit-emails-run/m);
  assert.match(yaml, /needs\.commit-emails-run\.outputs\.exit_code != '2'/);
  assert.match(yaml, /node scripts\/check-commit-emails\.mjs/);
  assert.match(yaml, /echo "exit_code=\$\{code\}"/);
  assert.match(yaml, /not checked/);
  const emailsJob = yaml.slice(yaml.indexOf('  commit-emails:'), yaml.indexOf('  merge-gate-trusted:'));
  assert.doesNotMatch(emailsJob, /continue-on-error:\s*true/);
});
