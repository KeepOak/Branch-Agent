import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GATE_SCRIPTS } from './merge-gate-trusted.mjs';
import {
  DEFAULT_WAIT_BUDGET_SECONDS,
  IGNORE_CHECK_NAMES,
  MAX_RATE_LIMIT_SLEEP_SECONDS,
  POLL_INTERVAL_SECONDS,
  backoffSeconds,
  evaluateOrdinaryChecks,
  isRateLimitError,
  mergeCheckSnapshots,
  nextCheckRefresh,
  parseRateLimitHeaders,
  pollIntervalSeconds,
  pollOrdinaryGate,
  rateLimitSleepSeconds,
  resetEpochFromRateLimit,
  runGhWithRetry,
  shouldSkipEditedRerun,
  withRateLimitRetry,
} from './merge-gate-rate-limit.mjs';

const feature = {
  id: 102,
  name: 'Named feature tests on ubuntu-latest (1/10)',
  status: 'completed',
  conclusion: 'success',
};
const analyze = {
  id: 105,
  name: 'Analyze (actions)',
  status: 'completed',
  conclusion: 'success',
};
const mergeGate = {
  id: 101,
  name: 'merge-gate',
  status: 'completed',
  conclusion: 'success',
};
const trusted = {
  id: 103,
  name: 'merge-gate-trusted',
  status: 'in_progress',
  conclusion: null,
};

function rateLimitError(message) {
  const error = new Error(message);
  error.stderr = message;
  return error;
}

test('isRateLimitError matches installation, 403/429, and secondary limits', () => {
  assert.equal(isRateLimitError(rateLimitError('gh: API rate limit exceeded for installation (HTTP 403)')), true);
  assert.equal(isRateLimitError({ stderr: 'HTTP 429', message: 'API rate limit exceeded' }), true);
  assert.equal(isRateLimitError('You have exceeded a secondary rate limit'), true);
  assert.equal(isRateLimitError({ message: 'HTTP 403 Forbidden' }), false);
  assert.equal(isRateLimitError({ message: 'HTTP 500 Internal Server Error' }), false);
  assert.equal(isRateLimitError({ message: 'Failed checks: build: failure' }), false);
});

test('rateLimitSleepSeconds prefers retry-after, then reset, then jittered backoff', () => {
  assert.equal(rateLimitSleepSeconds({
    error: 'Retry-After: 17\nHTTP 403',
    nowSeconds: 1_000,
  }), 17);
  assert.equal(rateLimitSleepSeconds({
    error: 'x-ratelimit-reset: 1100',
    nowSeconds: 1_000,
  }), 100);
  assert.equal(rateLimitSleepSeconds({
    error: 'gh: API rate limit exceeded for installation (HTTP 403)',
    nowSeconds: 1_000,
    rateLimit: { resources: { core: { remaining: 0, reset: 1_040 } } },
  }), 40);
  assert.equal(rateLimitSleepSeconds({
    error: 'x-ratelimit-reset: 10000',
    nowSeconds: 1_000,
    maxSleep: 60,
  }), 60);
  assert.equal(rateLimitSleepSeconds({
    error: 'secondary rate limit',
    retryAttempt: 0,
    random: () => 1,
    maxSleep: 32,
  }), 4);
});

test('parseRateLimitHeaders and resetEpochFromRateLimit read GitHub fields', () => {
  assert.deepEqual(parseRateLimitHeaders('HTTP/2 403\nRetry-After: 30\nX-RateLimit-Reset: 99\n'), {
    retryAfter: 30,
    resetEpoch: 99,
  });
  assert.equal(resetEpochFromRateLimit({
    resources: {
      core: { remaining: 12, reset: 50 },
      search: { remaining: 0, reset: 20 },
    },
  }), 20);
  assert.equal(resetEpochFromRateLimit({ rate: { reset: 77 } }), 77);
});

test('backoff and poll intervals stay capped and increase 30/60/90', () => {
  assert.equal(backoffSeconds(0, { random: () => 1, cap: 32 }), 4);
  assert.equal(backoffSeconds(3, { random: () => 1, cap: 32 }), 32);
  assert.deepEqual(POLL_INTERVAL_SECONDS, [30, 60, 90]);
  assert.deepEqual([0, 1, 2, 3].map((index) => pollIntervalSeconds(index)), [30, 60, 90, 90]);
  assert.equal(DEFAULT_WAIT_BUDGET_SECONDS, 64 * 30);
  assert.equal(MAX_RATE_LIMIT_SLEEP_SECONDS, 120);
});

test('nextCheckRefresh stops re-listing finished checks after the first full poll', () => {
  assert.deepEqual(nextCheckRefresh({ pendingIds: null, pollIndex: 0 }), { mode: 'all' });
  assert.deepEqual(nextCheckRefresh({ pendingIds: [2, 3], pollIndex: 1 }), {
    mode: 'pending',
    ids: [2, 3],
  });
  assert.deepEqual(nextCheckRefresh({ pendingIds: [2], pollIndex: 3 }), { mode: 'all' });
  assert.deepEqual(nextCheckRefresh({ pendingIds: [1, 2, 3, 4, 5, 6, 7, 8, 9], pollIndex: 1 }), {
    mode: 'all',
  });
});

test('mergeCheckSnapshots keeps completed checks across pending-only refreshes', () => {
  const running = { id: 200, name: 'build', status: 'in_progress', conclusion: null };
  const first = mergeCheckSnapshots(new Map(), [feature, running], { mode: 'all' });
  assert.equal(first.completed.get(feature.id), feature);
  assert.deepEqual(first.pending, [running]);
  const done = { ...running, status: 'completed', conclusion: 'success' };
  const second = mergeCheckSnapshots(first.completed, [done], { mode: 'pending' });
  assert.equal(second.completed.get(feature.id), feature);
  assert.equal(second.completed.get(200).conclusion, 'success');
  assert.deepEqual(second.pending, []);
});

test('evaluateOrdinaryChecks waits for Analyze, ignores gate jobs, and fails red checks', () => {
  assert.ok(IGNORE_CHECK_NAMES.has('merge-gate'));
  assert.ok(IGNORE_CHECK_NAMES.has('merge-gate-trusted'));
  const missingAnalyze = evaluateOrdinaryChecks([feature]);
  assert.equal(missingAnalyze.ready, false);
  assert.equal(missingAnalyze.pending.some((run) => run.name === 'Analyze (actions)'), true);
  const runningAnalyze = evaluateOrdinaryChecks([
    feature,
    { ...analyze, status: 'queued', conclusion: null },
  ]);
  assert.equal(runningAnalyze.ready, false);
  assert.equal(runningAnalyze.pending.length, 1);
  const passed = evaluateOrdinaryChecks([mergeGate, feature, trusted, analyze]);
  assert.equal(passed.ready, true);
  assert.deepEqual(passed.others.map((run) => run.id), [feature.id, analyze.id]);
  const failed = evaluateOrdinaryChecks([{ ...analyze, conclusion: 'failure' }]);
  assert.equal(failed.ready, false);
  assert.equal(failed.failed.map((run) => `${run.name}: ${run.conclusion}`).join('\n'), 'Analyze (actions): failure');
});

test('ordinary gate keeps every non-gate check including a failed older duplicate', () => {
  const latest = { ...feature, id: 110, status: 'completed', conclusion: 'failure' };
  const cancelled = { ...feature, id: 90, conclusion: 'cancelled' };
  const result = evaluateOrdinaryChecks([mergeGate, feature, trusted, analyze, latest, cancelled]);
  assert.deepEqual(result.others.map((run) => run.id), [feature.id, analyze.id, latest.id, cancelled.id]);
  assert.deepEqual(result.failed.map((run) => run.id), [latest.id, cancelled.id]);
});

test('withRateLimitRetry retries rate limits and throws other HTTP errors', () => {
  const sleeps = [];
  let calls = 0;
  const value = withRateLimitRetry(() => {
    calls += 1;
    if (calls === 1) throw rateLimitError('gh: API rate limit exceeded for installation (HTTP 403)');
    return 'ok';
  }, {
    sleep: (seconds) => sleeps.push(seconds),
    now: () => 0,
    startedAt: 0,
    budgetSeconds: 60,
    random: () => 0.5,
    fetchRateLimit: () => ({ resources: { core: { remaining: 0, reset: 12 } } }),
  });
  assert.equal(value, 'ok');
  assert.deepEqual(sleeps, [12]);

  assert.throws(() => withRateLimitRetry(() => {
    throw new Error('HTTP 500 Internal Server Error');
  }, { sleep: () => {}, now: () => 0, startedAt: 0 }), /HTTP 500/);
});

test('pollOrdinaryGate retries a rate limit without consuming a poll slot', () => {
  const plans = [];
  const sleeps = [];
  let calls = 0;
  const code = pollOrdinaryGate({
    repo: 'example/repo',
    sha: 'abc',
    token: 'unused',
    initialWait: 0,
    waitBudgetSeconds: 600,
  }, {
    fetchChecks: (_repo, _sha, _token, plan) => {
      calls += 1;
      plans.push(plan);
      if (calls === 1) throw rateLimitError('gh: API rate limit exceeded for installation (HTTP 403)');
      return [feature, analyze];
    },
    sleep: (seconds) => sleeps.push(seconds),
    now: () => 1_000,
    fetchRateLimit: () => ({ resources: { core: { remaining: 0, reset: 10 } } }),
    random: () => 0.5,
    log: () => {},
    error: () => {},
  });
  assert.equal(code, 0);
  assert.equal(calls, 2);
  assert.deepEqual(plans, [{ mode: 'all' }, { mode: 'all' }]);
  assert.ok(sleeps[0] >= 1);
});

test('pollOrdinaryGate fails a red check and a non-rate-limit API error', () => {
  const failed = pollOrdinaryGate({
    repo: 'example/repo', sha: 'abc', token: 'unused', initialWait: 0, waitBudgetSeconds: 600,
  }, {
    fetchChecks: () => [feature, { ...analyze, conclusion: 'failure' }],
    sleep: () => {},
    now: () => 0,
    log: () => {},
    error: () => {},
  });
  assert.equal(failed, 1);

  const apiError = pollOrdinaryGate({
    repo: 'example/repo', sha: 'abc', token: 'unused', initialWait: 0, waitBudgetSeconds: 600,
  }, {
    fetchChecks: () => {
      throw new Error('HTTP 502 Bad Gateway');
    },
    sleep: () => {},
    now: () => 0,
    log: () => {},
    error: () => {},
  });
  assert.equal(apiError, 1);
});

test('pollOrdinaryGate backs the interval off and only refreshes pending checks', () => {
  const plans = [];
  const sleeps = [];
  let nowMs = 0;
  let polls = 0;
  const running = { id: 200, name: 'build', status: 'in_progress', conclusion: null };
  const code = pollOrdinaryGate({
    repo: 'example/repo', sha: 'abc', token: 'unused', initialWait: 5, waitBudgetSeconds: 600,
  }, {
    fetchChecks: (_repo, _sha, _token, plan) => {
      polls += 1;
      plans.push(plan);
      if (polls < 3) return [feature, running];
      return [feature, { ...running, status: 'completed', conclusion: 'success' }, analyze];
    },
    sleep: (seconds) => {
      sleeps.push(seconds);
      nowMs += seconds * 1000;
    },
    now: () => nowMs,
    log: () => {},
    error: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(sleeps.slice(0, 3), [5, 30, 60]);
  assert.deepEqual(plans[0], { mode: 'all' });
  assert.deepEqual(plans[1], { mode: 'pending', ids: [200] });
});

test('pollOrdinaryGate times out on a lasting rate limit instead of passing', () => {
  const code = pollOrdinaryGate({
    repo: 'example/repo', sha: 'abc', token: 'unused', initialWait: 0, waitBudgetSeconds: 10,
  }, {
    fetchChecks: () => {
      throw rateLimitError('gh: API rate limit exceeded for installation (HTTP 403)');
    },
    sleep: () => {},
    now: (() => {
      let tick = 0;
      return () => {
        tick += 1;
        return tick * 5_000;
      };
    })(),
    fetchRateLimit: () => ({ resources: { core: { remaining: 0, reset: 9_999 } } }),
    log: () => {},
    error: () => {},
  });
  assert.equal(code, 1);
});

test('ordinary merge-gate workflow runs the rate-limit waiter from a checkout', () => {
  const yaml = readFileSync(new URL('../.github/workflows/merge-gate.yml', import.meta.url), 'utf8');
  assert.match(yaml, /node scripts\/merge-gate-rate-limit\.mjs/);
  assert.match(yaml, /MERGE_GATE_ACTION:/);
  assert.match(yaml, /node --test scripts\/merge-gate-trusted\.test\.mjs scripts\/merge-gate-rate-limit\.test\.mjs/);
  assert.doesNotMatch(yaml, /seq 1 64/);
  assert.doesNotMatch(yaml, /sleep 10/);
  assert.ok(GATE_SCRIPTS.includes('scripts/merge-gate-rate-limit.mjs'));
  assert.ok(GATE_SCRIPTS.includes('scripts/merge-gate-rate-limit.test.mjs'));
});

test('shouldSkipEditedRerun keeps a failed SHA live and skips in-progress or green runs', () => {
  const current = { id: 9, head_sha: 'abc', status: 'in_progress', conclusion: null };
  assert.equal(shouldSkipEditedRerun([
    current,
    { id: 8, head_sha: 'abc', status: 'in_progress', conclusion: null },
  ], { runId: 9, sha: 'abc' }), true);
  assert.equal(shouldSkipEditedRerun([
    current,
    { id: 8, head_sha: 'abc', status: 'completed', conclusion: 'success' },
  ], { runId: 9, sha: 'abc' }), true);
  assert.equal(shouldSkipEditedRerun([
    current,
    { id: 8, head_sha: 'abc', status: 'completed', conclusion: 'failure' },
  ], { runId: 9, sha: 'abc' }), false);
  assert.equal(shouldSkipEditedRerun([current], { runId: 9, sha: 'abc' }), false);
});

test('runGhWithRetry retries rate limits then returns stdout', () => {
  const calls = [];
  const out = runGhWithRetry(['api', 'rate_limit'], {
    exec: (cmd, args) => {
      calls.push([cmd, args[0]]);
      if (calls.length === 1) throw rateLimitError('gh: API rate limit exceeded for installation (HTTP 403)');
      return '{"ok":true}';
    },
    sleep: () => {},
    now: () => 0,
    startedAt: 0,
    budgetSeconds: 60,
    fetchRateLimit: () => ({ resources: { core: { remaining: 0, reset: 8 } } }),
  });
  assert.equal(out, '{"ok":true}');
  assert.deepEqual(calls[0], ['gh', 'api']);
});

test('release readiness and gate-files-fresh use the shared gh retry helper', () => {
  const release = readFileSync(new URL('../.github/workflows/component-release.yml', import.meta.url), 'utf8');
  const readiness = release.slice(release.indexOf('Check if a release is needed'), release.indexOf('identity:'));
  assert.match(readiness, /node scripts\/merge-gate-rate-limit\.mjs gh -- api/);
  assert.doesNotMatch(readiness, /^\s+gh api /m);
  const fresh = readFileSync(new URL('../.github/workflows/gate-files-fresh.yml', import.meta.url), 'utf8');
  assert.match(fresh, /types:\s*\[opened, synchronize, reopened, edited\]/);
  assert.match(fresh, /timeout-minutes:\s*10/);
  assert.match(fresh, /MERGE_GATE_WAIT_SECONDS/);
});
