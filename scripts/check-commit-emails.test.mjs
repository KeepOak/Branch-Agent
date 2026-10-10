// node --test scripts/check-commit-emails.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CUTOFF_ISO,
  evaluateCommits,
  fetchPrCommits,
  fetchPrCommitsWithApi,
  formatReport,
} from './check-commit-emails.mjs';

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
