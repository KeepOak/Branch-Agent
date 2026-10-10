// node --test scripts/detect-non-merge-commit.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ISSUE_INTRO,
  runGh,
  TRACKING_ISSUE_TITLE,
  associatedPulls,
  buildIssueBody,
  findTrackingIssue,
  formatLandingLine,
  inspectLanding,
  nextIssueAction,
  parentCount,
  parseArgs,
  shouldTrackLanding,
  upsertIssueBody,
} from './detect-non-merge-commit.mjs';

const trackWorkflow = readFileSync(new URL('../.github/workflows/non-merge-commit.yml', import.meta.url), 'utf8');
const detectorSource = readFileSync(new URL('./detect-non-merge-commit.mjs', import.meta.url), 'utf8');

const repo = 'example/repo';
const sha = '0123456789abcdef0123456789abcdef01234567';
const pulls = [{ number: 367, html_url: 'https://github.com/example/repo/pull/367' }];
const landing = {
  sha,
  repo,
  serverUrl: 'https://github.com',
  pulls,
  shouldTrack: true,
};

test('tracks a one-parent commit with an associated pull request', () => {
  assert.equal(parentCount({ parents: [{ sha: 'abc' }] }), 1);
  assert.equal(shouldTrackLanding({ parents: [{ sha: 'abc' }], pulls }), true);
  assert.deepEqual(inspectLanding({
    sha, repo, serverUrl: 'https://github.com', commit: { parents: [{ sha: 'abc' }] }, pulls,
  }), {
    sha, repo, serverUrl: 'https://github.com', parentCount: 1, pulls: associatedPulls(pulls), shouldTrack: true,
  });
});

test('ignores a merge commit even when a pull request is associated', () => {
  assert.equal(parentCount({ parents: [{ sha: 'a' }, { sha: 'b' }] }), 2);
  assert.equal(shouldTrackLanding({
    parents: [{ sha: 'a' }, { sha: 'b' }], pulls,
  }), false);
});

test('ignores a one-parent commit with no associated pull request', () => {
  assert.equal(shouldTrackLanding({ parents: [{ sha: 'abc' }], pulls: [] }), false);
  assert.deepEqual(associatedPulls([{ number: 'nope' }, { number: 0 }, null]), []);
});

test('formats a landing line with the PR and SHA only', () => {
  assert.equal(
    formatLandingLine({ sha, pulls, repo }),
    `- ${sha} https://github.com/example/repo/commit/${sha} #367 https://github.com/example/repo/pull/367`,
  );
});

test('builds and appends one tracking issue body without duplicating a SHA', () => {
  const created = buildIssueBody(landing, { repo });
  assert.match(created, new RegExp(TRACKING_ISSUE_TITLE === 'Non-merge-commit landing on main' ? '## Landings' : '$^'));
  assert.match(created, /does not revert/);
  assert.match(created, new RegExp(sha));
  assert.equal(upsertIssueBody(created, landing, { repo }).changed, false);
  const nextSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const updated = upsertIssueBody(created, { ...landing, sha: nextSha }, { repo });
  assert.equal(updated.changed, true);
  assert.match(updated.body, new RegExp(sha));
  assert.match(updated.body, new RegExp(nextSha));
  assert.equal(updated.body.indexOf('## Landings'), updated.body.lastIndexOf('## Landings'));
});

test('opens, updates, or reopens a single tracking issue', () => {
  assert.deepEqual(nextIssueAction(null, { ...landing, shouldTrack: false }, { repo }), { action: 'none' });
  const created = nextIssueAction(null, landing, { repo });
  assert.equal(created.action, 'create');
  assert.equal(created.title, TRACKING_ISSUE_TITLE);
  assert.match(created.body, new RegExp(`#367`));

  const existing = { number: 12, title: TRACKING_ISSUE_TITLE, state: 'open', body: created.body };
  assert.deepEqual(nextIssueAction(existing, landing, { repo }), { action: 'none', number: 12 });

  const other = nextIssueAction(existing, { ...landing, sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, { repo });
  assert.equal(other.action, 'update');
  assert.equal(other.number, 12);

  assert.equal(findTrackingIssue([
    { title: 'other', number: 1 },
    { title: TRACKING_ISSUE_TITLE, number: 12 },
  ]).number, 12);
});

test('reopens a closed tracking issue only when appending a new SHA', () => {
  const created = nextIssueAction(null, landing, { repo });
  const closed = { number: 12, title: TRACKING_ISSUE_TITLE, state: 'closed', body: created.body };
  assert.deepEqual(nextIssueAction(closed, landing, { repo }), { action: 'none', number: 12 });

  const appended = nextIssueAction(closed, { ...landing, sha: 'cccccccccccccccccccccccccccccccccccccccc' }, { repo });
  assert.equal(appended.action, 'reopen-and-update');
  assert.equal(appended.number, 12);
  assert.match(appended.body, /cccccccccccccccccccccccccccccccccccccccc/);
});

test('parseArgs reads dry-run, sha, and repo without using process state', () => {
  assert.deepEqual(parseArgs(['node', 'detect-non-merge-commit.mjs', '--dry-run', '--sha', sha, '--repo', repo], {}), {
    dryRun: true, sha, repo, serverUrl: 'https://github.com',
  });
  assert.deepEqual(parseArgs(['node', 'detect-non-merge-commit.mjs'], { SHA: 'abc', REPO: repo }), {
    dryRun: false, sha: 'abc', repo, serverUrl: 'https://github.com',
  });
});

test('push-to-main workflow tracks one issue and never reverts', () => {
  assert.match(trackWorkflow, /branches:\s*\[main\]/);
  assert.match(trackWorkflow, /issues: write/);
  assert.match(trackWorkflow, /node scripts\/detect-non-merge-commit\.mjs/);
  assert.match(trackWorkflow, /node --test scripts\/detect-non-merge-commit\.test\.mjs/);
  assert.doesNotMatch(trackWorkflow, /git\s+(revert|reset|push)/);
  assert.doesNotMatch(detectorSource, /git\s+(revert|reset|push)/);
  assert.match(ISSUE_INTRO, /does not revert/);
});

test('does not restore a write-permission pull_request_target auto-merge workflow', () => {
  assert.equal(existsSync(new URL('../.github/workflows/disable-auto-merge.yml', import.meta.url)), false);
  assert.doesNotMatch(trackWorkflow, /pull_request_target/);
  assert.doesNotMatch(trackWorkflow, /auto_merge_enabled/);
});

test('runGh gives gh a buffer large enough for a landing commit with every patch', () => {
  const seen = [];
  const out = runGh(['api', 'repos/example/repo/commits/abc'], { GH_TOKEN: 'unused' }, {
    exec: (_bin, _args, options) => {
      seen.push(options.maxBuffer);
      return '{"sha":"abc"}';
    },
  });
  assert.equal(out, '{"sha":"abc"}');
  assert.equal(seen.length, 1);
  assert.ok(seen[0] >= 64 * 1024 * 1024, `maxBuffer ${seen[0]} is below 64 MiB`);
});

test('runGh waits out a rate limit and retries instead of failing the workflow', () => {
  let calls = 0;
  const waits = [];
  const out = runGh(['issue', 'list'], {}, {
    exec: () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error('gh: API rate limit exceeded for installation (HTTP 403)'), {
          stderr: 'gh: API rate limit exceeded for installation (HTTP 403)',
        });
      }
      return '[]';
    },
    sleep: (seconds) => waits.push(seconds),
  });
  assert.equal(out, '[]');
  assert.equal(calls, 2);
  assert.equal(waits.length, 1);
});
