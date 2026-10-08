import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GATE_SCRIPTS } from './merge-gate-trusted.mjs';
import {
  DEFAULT_WAIT_BUDGET_SECONDS,
  GH_API_MAX_BUFFER,
  IGNORE_CHECK_NAMES,
  MAX_RATE_LIMIT_SLEEP_SECONDS,
  POLL_INTERVAL_SECONDS,
  VISUAL_TOUR_WORKFLOW_PATH,
  backoffSeconds,
  evaluateOrdinaryChecks,
  execGhApi,
  fetchOrdinaryCheckRuns,
  ghApiArgs,
  isPassableCheckSnapshot,
  isRateLimitError,
  mergeCheckSnapshots,
  nextCheckRefresh,
  parseGhApiIncludeOutput,
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
  assert.equal(isRateLimitError({ httpStatus: 429, stderr: 'HTTP 429' }), true);
  assert.equal(isRateLimitError('You have exceeded a secondary rate limit'), true);
  assert.equal(isRateLimitError({
    httpStatus: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '99' },
    body: '{"message":"API rate limit exceeded"}',
  }), true);
  assert.equal(isRateLimitError({
    httpStatus: 403,
    headers: { 'retry-after': '12' },
    body: '{"message":"You have exceeded a secondary rate limit"}',
  }), true);
  assert.equal(isRateLimitError({ message: 'HTTP 403 Forbidden' }), false);
  assert.equal(isRateLimitError({
    httpStatus: 403,
    headers: { 'x-ratelimit-remaining': '12' },
    body: '{"message":"Resource not accessible by integration"}',
    message: 'HTTP 403 Forbidden',
  }), false);
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
    remaining: null,
  });
  assert.deepEqual(parseRateLimitHeaders({
    'Retry-After': '15',
    'X-RateLimit-Reset': '1100',
    'X-RateLimit-Remaining': '0',
  }), {
    retryAfter: 15,
    resetEpoch: 1100,
    remaining: 0,
  });
  assert.equal(resetEpochFromRateLimit({
    resources: {
      core: { remaining: 12, reset: 50 },
      search: { remaining: 0, reset: 20 },
    },
  }), 20);
  assert.equal(resetEpochFromRateLimit({ rate: { reset: 77 } }), 77);
  const included = parseGhApiIncludeOutput([
    'HTTP/2.0 429 Too Many Requests',
    'Retry-After: 9',
    'X-RateLimit-Reset: 123',
    '',
    '{"message":"API rate limit exceeded"}',
  ].join('\n'));
  assert.equal(included.status, 429);
  assert.equal(included.headers['retry-after'], '9');
  assert.equal(included.headers['x-ratelimit-reset'], '123');
  assert.equal(included.json.message, 'API rate limit exceeded');
});

test('backoff and poll intervals stay capped and increase 30/60/90', () => {
  assert.equal(backoffSeconds(0, { random: () => 1, cap: 32 }), 4);
  assert.equal(backoffSeconds(3, { random: () => 1, cap: 32 }), 32);
  assert.deepEqual(POLL_INTERVAL_SECONDS, [30, 60, 90]);
  assert.deepEqual([0, 1, 2, 3].map((index) => pollIntervalSeconds(index)), [30, 60, 90, 90]);
  assert.equal(DEFAULT_WAIT_BUDGET_SECONDS, 64 * 30);
  assert.equal(MAX_RATE_LIMIT_SLEEP_SECONDS, 120);
  assert.equal(GH_API_MAX_BUFFER, 64 * 1024 * 1024);
});

test('nextCheckRefresh uses one check-runs list call every poll', () => {
  assert.deepEqual(nextCheckRefresh({ pendingIds: null, pollIndex: 0 }), { mode: 'all' });
  assert.deepEqual(nextCheckRefresh({ pendingIds: [2, 3], pollIndex: 1 }), { mode: 'all' });
  assert.deepEqual(nextCheckRefresh({ pendingIds: [2], pollIndex: 3 }), { mode: 'all' });
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

test('pollOrdinaryGate backs the interval off and uses one list call per poll', () => {
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
  assert.deepEqual(plans, [{ mode: 'all' }, { mode: 'all' }, { mode: 'all' }]);
  assert.equal(polls, 3);
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

test('execGhApi and ghApiArgs read HTTP headers and cap the process buffer', () => {
  const args = ghApiArgs('repos/example/compare/a...b?page=1', {
    jq: '[.files[].filename]',
    includeHeaders: true,
  });
  assert.deepEqual(args.slice(0, 2), ['api', 'repos/example/compare/a...b?page=1']);
  assert.ok(args.includes('--jq'));
  assert.equal(args.includes('-i'), false);

  let maxBuffer;
  const parsed = execGhApi(['api', '-i', 'rate_limit'], {
    exec: (_cmd, _args, options) => {
      maxBuffer = options.maxBuffer;
      return [
        'HTTP/2.0 200 OK',
        'Retry-After: 4',
        'X-RateLimit-Reset: 88',
        '',
        '{"ok":true}',
      ].join('\n');
    },
  });
  assert.equal(maxBuffer, GH_API_MAX_BUFFER);
  assert.equal(parsed.status, 200);
  assert.equal(parsed.headers['retry-after'], '4');
  assert.deepEqual(parsed.json, { ok: true });
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

test('an all-pending check snapshot never passes the ordinary gate', () => {
  const pending = [
    { id: 1, name: 'build', status: 'queued', conclusion: null },
    { id: 2, name: 'Analyze (actions)', status: 'in_progress', conclusion: null },
  ];
  const snapshot = evaluateOrdinaryChecks(pending);
  assert.equal(snapshot.allPending, true);
  assert.equal(snapshot.ready, false);
  assert.equal(isPassableCheckSnapshot(snapshot), false);

  const errors = [];
  const code = pollOrdinaryGate({
    repo: 'example/repo', sha: 'abc', token: 'unused', initialWait: 0, waitBudgetSeconds: 30, maxPolls: 1,
  }, {
    fetchChecks: () => pending,
    sleep: () => {},
    now: () => 0,
    log: () => {},
    error: (text) => errors.push(text),
    resolveWorkflows: () => ({}),
  });
  assert.equal(code, 1);
  assert.match(errors.join('\n'), /Timed out waiting for/);
});

test('a multi-page check list with a red check on page 2 fails', () => {
  const page1 = {
    total_count: 101,
    check_runs: Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      name: index === 0 ? 'Analyze (actions)' : `ok-${index}`,
      status: 'completed',
      conclusion: 'success',
    })),
  };
  const page2 = {
    total_count: 101,
    check_runs: [{
      id: 101,
      name: 'Named feature tests on ubuntu-latest (9/10)',
      status: 'completed',
      conclusion: 'failure',
    }],
  };
  const calls = [];
  const runs = fetchOrdinaryCheckRuns('example/repo', 'abc', 'unused', { mode: 'all' }, {
    request: (requestPath) => {
      calls.push(requestPath);
      return requestPath.endsWith('page=1') ? page1 : page2;
    },
  });
  assert.deepEqual(calls, [
    'commits/abc/check-runs?per_page=100&page=1',
    'commits/abc/check-runs?per_page=100&page=2',
  ]);
  assert.equal(runs.length, 101);
  assert.equal(evaluateOrdinaryChecks(runs).failed[0].conclusion, 'failure');

  const code = pollOrdinaryGate({
    repo: 'example/repo', sha: 'abc', token: 'unused', initialWait: 0, waitBudgetSeconds: 600,
  }, {
    fetchChecks: () => runs,
    sleep: () => {},
    now: () => 0,
    log: () => {},
    error: () => {},
    resolveWorkflows: () => ({}),
  });
  assert.equal(code, 1);
});

test('a generic 403 fails closed and a 429 with Retry-After retries', () => {
  const generic = Object.assign(new Error('HTTP 403 Forbidden'), {
    httpStatus: 403,
    headers: { 'x-ratelimit-remaining': '12' },
    body: '{"message":"Resource not accessible by integration"}',
  });
  assert.equal(isRateLimitError(generic), false);
  assert.throws(() => withRateLimitRetry(() => {
    throw generic;
  }, { sleep: () => {}, now: () => 0, startedAt: 0, budgetSeconds: 60 }), /HTTP 403/);

  const genericPoll = pollOrdinaryGate({
    repo: 'example/repo', sha: 'abc', token: 'unused', initialWait: 0, waitBudgetSeconds: 600,
  }, {
    fetchChecks: () => {
      throw generic;
    },
    sleep: () => {},
    now: () => 0,
    log: () => {},
    error: () => {},
  });
  assert.equal(genericPoll, 1);

  const sleeps = [];
  let calls = 0;
  const limited = Object.assign(new Error('HTTP 429'), {
    httpStatus: 429,
    headers: { 'retry-after': '9', 'x-ratelimit-reset': '1009' },
    body: '{"message":"API rate limit exceeded"}',
  });
  const value = withRateLimitRetry(() => {
    calls += 1;
    if (calls === 1) throw limited;
    return 'ok';
  }, {
    sleep: (seconds) => sleeps.push(seconds),
    now: () => 0,
    startedAt: 0,
    budgetSeconds: 60,
  });
  assert.equal(value, 'ok');
  assert.deepEqual(sleeps, [9]);
  assert.equal(rateLimitSleepSeconds({
    error: limited,
    nowSeconds: 1_000,
  }), 9);
});

test('ordinary waiter skips only a Visual tour comment proven by workflow path', () => {
  const comment = {
    id: 106,
    name: 'comment',
    status: 'in_progress',
    conclusion: null,
  };
  const skipped = evaluateOrdinaryChecks([feature, analyze, comment], {
    workflowsByCheckId: { 106: { path: VISUAL_TOUR_WORKFLOW_PATH } },
  });
  assert.equal(skipped.ready, true);
  assert.equal(skipped.others.some((run) => run.name === 'comment'), false);

  const foreign = evaluateOrdinaryChecks([feature, analyze, comment], {
    workflowsByCheckId: { 106: { path: '.github/workflows/other.yml' } },
  });
  assert.equal(foreign.ready, false);
  assert.deepEqual(foreign.pending.map((run) => run.id), [106]);

  const unattributed = evaluateOrdinaryChecks([feature, analyze, comment]);
  assert.equal(unattributed.ready, false);
});
