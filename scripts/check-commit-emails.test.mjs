// node --test scripts/check-commit-emails.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUTOFF_ISO,
  COMMIT_EMAIL_WAIT_SECONDS,
  apiFailureLine,
  createEmailCheckApi,
  evaluateCommits,
  fetchPrCommits,
  fetchPrCommitsWithApi,
  formatReport,
  parseGitLogRecords,
  readLocalPrCommits,
  runCommitEmailCheck,
  shouldUseLocalHistory,
} from './check-commit-emails.mjs';
import { withRateLimitRetry } from './merge-gate-rate-limit.mjs';

const AFTER = CUTOFF_ISO;
const BEFORE = '2026-10-08T04:04:59Z';
const NOREPLY = '12345+person@users.noreply.github.com';
const GMAIL = 'person@gmail.invalid';
const PERSONAL = 'person@example.com';
const BOT = '123456+dependabot[bot]@users.noreply.github.com';

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

test('reads every page of pull request commits', async () => {
  const pages = new Map([
    ['https://api.github.com/repos/KeepOak/Branch-Agent/pulls/1/commits?per_page=100', {
      body: [githubCommit({ sha: '1111111111111111111111111111111111111111' })],
      link: '<https://api.github.com/repos/KeepOak/Branch-Agent/pulls/1/commits?page=2>; rel="next"',
    }],
    ['https://api.github.com/repos/KeepOak/Branch-Agent/pulls/1/commits?page=2', {
      body: [githubCommit({ sha: '2222222222222222222222222222222222222222' })],
      link: null,
    }],
  ]);
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    const page = pages.get(url);
    assert.ok(page, `unexpected fetch ${url}`);
    return {
      ok: true,
      json: async () => page.body,
      headers: { get: (name) => name.toLowerCase() === 'link' ? page.link : null },
    };
  };
  const commits = await fetchPrCommits({
    repo: 'KeepOak/Branch-Agent',
    prNumber: '1',
    token: 'token',
    fetchImpl,
  });
  assert.deepEqual(commits.map((commit) => commit.sha), [
    '1111111111111111111111111111111111111111',
    '2222222222222222222222222222222222222222',
  ]);
  assert.deepEqual(seen, [...pages.keys()]);
});

test('reads every page of pull request commits through the rate-limit wrapper', () => {
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

function httpError(message, headers = {}) {
  return Object.assign(new Error(message), { headers });
}

test('the email check passes when every in-scope commit is allowed', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1', token: 't',
    api: () => [githubCommit({ authorEmail: NOREPLY, committerEmail: NOREPLY })],
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.lines[0], /Checked 1 commit\(s\)/);
});

test('the email check fails with exit 1 on a personal address, not as an API failure', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1', token: 't',
    api: () => [githubCommit({ authorEmail: PERSONAL, committerEmail: NOREPLY })],
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.lines[0], /author/);
});

test('a 404 is reported as not retried, never as retries exhausted', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '929', token: 't',
    api: () => { throw httpError('gh: Not Found (HTTP 404)'); },
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.lines[0], /HTTP 404/);
  assert.match(result.lines[0], /not retried/);
  assert.doesNotMatch(result.lines[0], /gave up/);
});

test('a rate limit that outlasts the step budget says it gave up, with the status', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '929', token: 't',
    api: () => { throw httpError('gh: API rate limit exceeded for installation (HTTP 403)'); },
    readLocal: () => { throw new Error('no local PR ref'); },
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.lines[0], /HTTP 403/);
  assert.match(result.lines[0], /waited out the rate limit/);
});

test('a rate limit waits for its reset time, not for six fixed retries', () => {
  const start = 1_790_000_000_000;
  let now = start;
  const sleeps = [];
  let calls = 0;
  const headers = { 'x-ratelimit-reset': String(start / 1000 + 90), 'x-ratelimit-remaining': '0' };
  const value = withRateLimitRetry(() => {
    calls += 1;
    if (calls === 1) throw httpError('gh: API rate limit exceeded for installation (HTTP 403)', headers);
    return 'ok';
  }, {
    sleep: (seconds) => { sleeps.push(seconds); now += seconds * 1000; },
    now: () => now,
    startedAt: start,
    budgetSeconds: COMMIT_EMAIL_WAIT_SECONDS,
    maxRetries: Number.POSITIVE_INFINITY,
    random: () => 0.5,
  });
  assert.equal(value, 'ok');
  assert.deepEqual(sleeps, [90]);
});

test('a far-off reset is capped per wait and the email budget still ends the wait', () => {
  const start = 1_790_000_000_000;
  let now = start;
  const sleeps = [];
  const headers = { 'x-ratelimit-reset': String(start / 1000 + 3_000), 'x-ratelimit-remaining': '0' };
  assert.throws(() => withRateLimitRetry(() => {
    throw httpError('gh: API rate limit exceeded for installation (HTTP 403)', headers);
  }, {
    sleep: (seconds) => { sleeps.push(seconds); now += seconds * 1000; },
    now: () => now,
    startedAt: start,
    budgetSeconds: COMMIT_EMAIL_WAIT_SECONDS,
    maxRetries: Number.POSITIVE_INFINITY,
    random: () => 0.5,
  }), /rate limit exceeded/);
  assert.ok(sleeps.every((seconds) => seconds <= 120), `each wait capped at 120s: ${sleeps}`);
  assert.ok(sleeps.reduce((sum, seconds) => sum + seconds, 0) <= COMMIT_EMAIL_WAIT_SECONDS);
});

test('the email check shares one job budget across pages: two rate-limited pages cannot exceed it', () => {
  let clock = 1_790_000_000_000;
  const sleeps = [];
  const now = () => clock;
  const api = createEmailCheckApi({
    budgetSeconds: COMMIT_EMAIL_WAIT_SECONDS,
    now,
    requestWithRetry: (_repo, _token, _path, options) => withRateLimitRetry(() => {
      throw httpError('gh: API rate limit exceeded for installation (HTTP 403)');
    }, {
      sleep: (seconds) => { sleeps.push(seconds); clock += seconds * 1000; },
      now,
      startedAt: options.startedAt,
      budgetSeconds: options.budgetSeconds,
      maxRetries: Number.POSITIVE_INFINITY,
      random: () => 0.5,
    }),
  });
  assert.throws(() => api('o', 't', 'pulls/1/commits?page=1'), /rate limit/);
  let secondError;
  try {
    api('o', 't', 'pulls/1/commits?page=2');
  } catch (error) {
    secondError = error;
  }
  assert.ok(secondError, 'the second page must not get a fresh budget');
  const total = sleeps.reduce((sum, seconds) => sum + seconds, 0);
  assert.ok(total <= COMMIT_EMAIL_WAIT_SECONDS, `waited ${total}s, over the ${COMMIT_EMAIL_WAIT_SECONDS}s job budget`);
  assert.equal(secondError.budgetExhausted, true);
  assert.match(apiFailureLine(secondError, '1'), /job budget/);
  assert.match(apiFailureLine(secondError, '1'), /Not a commit-email failure/);
});

const RATE_LIMITED = () => { throw httpError('gh: API rate limit exceeded for installation (HTTP 403)'); };

test('a rate limit past the budget falls back to local PR history and passes clean commits', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1941', token: 't', api: RATE_LIMITED,
    readLocal: () => [githubCommit()],
  });
  assert.equal(result.exitCode, 0);
  assert.match(result.lines[0], /local git history/);
});

test('the local fallback still fails a personal address with exit 1', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1941', token: 't', api: RATE_LIMITED,
    readLocal: () => [githubCommit({ authorEmail: PERSONAL })],
  });
  assert.equal(result.exitCode, 1);
  assert.doesNotMatch(result.lines.join('\n'), /person@example\.com/);
});

test('a spent wait budget also falls back to local history', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1', token: 't',
    api: () => { throw Object.assign(new Error('budget used up'), { budgetExhausted: true }); },
    readLocal: () => [githubCommit()],
  });
  assert.equal(result.exitCode, 0);
});

test('a real 403 that is not a rate limit fails and never reads local history', () => {
  let read = false;
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1', token: 't',
    api: () => { throw httpError('gh: Resource not accessible by integration (HTTP 403)'); },
    readLocal: () => { read = true; return [githubCommit()]; },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(read, false);
  assert.match(result.lines[0], /HTTP 403/);
  assert.match(result.lines[0], /not retried/);
});

test('an empty local history fails closed instead of passing', () => {
  const result = runCommitEmailCheck({
    repo: 'o/r', prNumber: '1', token: 't', api: RATE_LIMITED, readLocal: () => [],
  });
  assert.equal(result.exitCode, 2);
  assert.match(result.lines[0], /nothing was checked/);
});

test('shouldUseLocalHistory accepts rate-limit signs only', () => {
  assert.equal(shouldUseLocalHistory(httpError('HTTP 429')), true);
  assert.equal(shouldUseLocalHistory(httpError('forbidden (HTTP 403)', { 'x-ratelimit-remaining': '0' })), true);
  assert.equal(shouldUseLocalHistory(httpError('forbidden (HTTP 403)', { 'retry-after': '30' })), true);
  assert.equal(shouldUseLocalHistory(httpError('You have exceeded a secondary rate limit (HTTP 403)')), true);
  assert.equal(shouldUseLocalHistory(httpError('Must have admin rights (HTTP 403)')), false);
  assert.equal(shouldUseLocalHistory(httpError('Not Found (HTTP 404)')), false);
});

test('local git records parse into the API commit shape, with multi-line messages and trailers', () => {
  const raw = `abc\x1fa@users.noreply.github.com\x1fc@users.noreply.github.com\x1f${AFTER}\x1ffeat: x\n\n${trailer(GMAIL)}\n\x1e\n`
    + `def\x1fa@users.noreply.github.com\x1fc@users.noreply.github.com\x1f${AFTER}\x1ffix: y\n\x1e\n`;
  const commits = parseGitLogRecords(raw);
  assert.equal(commits.length, 2);
  assert.equal(commits[0].sha, 'abc');
  assert.equal(commits[0].commit.committer.date, AFTER);
  assert.deepEqual(evaluateCommits(commits).map((f) => f.field), ['co-author']);
});

const BASE = 'b'.repeat(40);
const MB = 'c'.repeat(40);

function fakeGit({ mergeBase = MB, verify = true } = {}) {
  const calls = [];
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'rev-parse') { if (!verify) throw new Error('unknown revision'); return BASE; }
    if (args[0] === 'merge-base') { if (mergeBase == null) throw new Error('no merge base'); return `${mergeBase}\n`; }
    return '';
  };
  return { exec, calls };
}

test('the local range starts at the merge-base of the PR base sha, never HEAD', () => {
  const { exec, calls } = fakeGit();
  readLocalPrCommits({ baseSha: BASE, exec });
  const log = calls.find((c) => c[1] === 'log');
  assert.equal(log.at(-1), `${MB}..refs/remotes/pr/head`);
  assert.deepEqual(calls.find((c) => c[1] === 'merge-base').slice(1), ['merge-base', BASE, 'refs/remotes/pr/head']);
  assert.ok(calls.every((c) => !c.some((a) => /\bHEAD\.\./.test(a))), 'HEAD is never a range start');
});

test('if merge-base fails the range falls back to the PR base sha', () => {
  const { exec, calls } = fakeGit({ mergeBase: null });
  readLocalPrCommits({ baseSha: BASE, exec });
  assert.equal(calls.find((c) => c[1] === 'log').at(-1), `${BASE}..refs/remotes/pr/head`);
});

for (const [name, opts] of [
  ['a missing base sha', { baseSha: undefined }],
  ['a non-sha base', { baseSha: 'main; rm -rf /' }],
  ['a base commit absent from local history', { baseSha: BASE, verify: false }],
]) {
  test(`${name} exits 2 on the fallback path and runs no git log`, () => {
    const { exec, calls } = fakeGit({ verify: opts.verify ?? true });
    const result = runCommitEmailCheck({
      repo: 'o/r', prNumber: '1', token: 't', api: RATE_LIMITED,
      readLocal: () => readLocalPrCommits({ baseSha: opts.baseSha, exec }),
    });
    assert.equal(result.exitCode, 2);
    assert.match(result.lines[0], /PR base|PR_BASE_SHA/);
    assert.ok(!calls.some((c) => c[1] === 'log'));
  });
}
