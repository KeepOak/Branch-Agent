import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  resolveOrdinaryWorkflow,
  resolveOrdinaryWorkflows,
  runGhWithRetry,
  shouldSkipEditedRerun,
  withIncludeFlag,
  TRANSIENT_RETRY_LIMIT,
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

const HEAD_SHA = 'head-sha';
const PR_NUMBER = 436;
const BASE_REF = 'main';
const ACTIONS_APP = { id: 15368 };

function desktopJob(id, suite, patch = {}) {
  return {
    id,
    app: ACTIONS_APP,
    name: 'Desktop on windows-latest',
    status: 'completed',
    conclusion: 'success',
    check_suite: { id: suite },
    ...patch,
  };
}

function desktopWorkflow(suite, patch = {}) {
  return {
    path: '.github/workflows/desktop-checks.yml',
    event: 'pull_request',
    headSha: HEAD_SHA,
    checkSuiteId: suite,
    pullRequests: [{ number: PR_NUMBER, base: BASE_REF }],
    ...patch,
  };
}

function ordinaryContext(workflowsByCheckId, context = {}) {
  return {
    workflowsByCheckId,
    sha: HEAD_SHA,
    prNumber: PR_NUMBER,
    baseRef: BASE_REF,
    ...context,
  };
}

test('ordinary gate supersedes an older same-workflow failure with a newer green run', () => {
  const olderSuite = 490;
  const newerSuite = 501;
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    const older = desktopJob(90, olderSuite, { conclusion });
    const newer = desktopJob(110, newerSuite);
    const workflowsByCheckId = {
      90: desktopWorkflow(olderSuite),
      110: desktopWorkflow(newerSuite),
    };
    for (const checkRuns of [
      [mergeGate, older, trusted, analyze, newer],
      [newer, analyze, older, mergeGate, trusted],
    ]) {
      const result = evaluateOrdinaryChecks(checkRuns, ordinaryContext(workflowsByCheckId));
      assert.equal(result.ready, true);
      assert.deepEqual(result.failed, []);
      assert.deepEqual(result.others.map((run) => run.id).sort((a, b) => a - b), [analyze.id, newer.id]);
    }
  }

  const olderSuccess = desktopJob(90, olderSuite);
  const newerFailure = desktopJob(110, newerSuite, { conclusion: 'failure' });
  const keptFailure = evaluateOrdinaryChecks(
    [olderSuccess, newerFailure, analyze],
    ordinaryContext({
      90: desktopWorkflow(olderSuite),
      110: desktopWorkflow(newerSuite),
    }),
  );
  assert.equal(keptFailure.ready, false);
  assert.deepEqual(keptFailure.failed.map((run) => run.id), [newerFailure.id]);

  const newerPending = desktopJob(110, newerSuite, { status: 'queued', conclusion: null });
  const waiting = evaluateOrdinaryChecks(
    [desktopJob(90, olderSuite, { conclusion: 'failure' }), newerPending, analyze],
    ordinaryContext({
      90: desktopWorkflow(olderSuite),
      110: desktopWorkflow(newerSuite),
    }),
  );
  assert.equal(waiting.ready, false);
  assert.equal(isPassableCheckSnapshot(waiting), false);
  assert.deepEqual(waiting.failed, []);
  assert.deepEqual(waiting.pending.map((run) => run.id), [newerPending.id]);

  const target = evaluateOrdinaryChecks(
    [desktopJob(90, olderSuite, { conclusion: 'failure' }), desktopJob(110, newerSuite), analyze],
    ordinaryContext({
      90: desktopWorkflow(olderSuite, { event: 'pull_request_target' }),
      110: desktopWorkflow(newerSuite, { event: 'pull_request_target' }),
    }),
  );
  assert.equal(target.ready, true);
  assert.deepEqual(target.failed, []);

  const errors = [];
  const code = pollOrdinaryGate({
    repo: 'example/repo',
    sha: HEAD_SHA,
    token: 'unused',
    prNumber: PR_NUMBER,
    baseRef: BASE_REF,
    initialWait: 0,
    waitBudgetSeconds: 600,
  }, {
    fetchChecks: () => [
      desktopJob(90, olderSuite, { conclusion: 'failure' }),
      desktopJob(110, newerSuite),
      analyze,
    ],
    resolveWorkflows: () => ({
      90: desktopWorkflow(olderSuite),
      110: desktopWorkflow(newerSuite),
    }),
    sleep: () => {},
    now: () => 0,
    log: () => {},
    error: (text) => errors.push(text),
  });
  assert.equal(code, 0, errors.join('\n'));
});

test('ordinary gate still fails an older failure from another workflow or with no attribution', () => {
  const older = desktopJob(90, 490, { conclusion: 'failure' });
  const newer = desktopJob(110, 501);
  const same = {
    90: desktopWorkflow(490),
    110: desktopWorkflow(501),
  };
  const cases = [
    ['different workflow path', {
      90: desktopWorkflow(490, { path: '.github/workflows/engine-handoff-checks.yml' }),
      110: desktopWorkflow(501),
    }],
    ['unattributed older run', { 110: same[110] }],
    ['unattributed newer run', { 90: same[90] }],
    ['no attribution', {}],
    ['workflow_dispatch', {
      90: same[90],
      110: desktopWorkflow(501, { event: 'workflow_dispatch' }),
    }],
    ['wrong SHA', {
      90: same[90],
      110: desktopWorkflow(501, { headSha: 'other-sha' }),
    }],
    ['wrong suite', {
      90: same[90],
      110: desktopWorkflow(501, { checkSuiteId: 999 }),
    }],
    ['another PR', {
      90: same[90],
      110: desktopWorkflow(501, { pullRequests: [{ number: 900, base: BASE_REF }] }),
    }],
    ['non-main base', {
      90: same[90],
      110: desktopWorkflow(501, {
        pullRequests: [
          { number: PR_NUMBER, base: BASE_REF },
          { number: 700, base: 'release' },
        ],
      }),
    }],
    ['pull_request_target cannot hide a pull_request failure', {
      90: same[90],
      110: desktopWorkflow(501, { event: 'pull_request_target' }),
    }],
    ['missing app', {
      90: same[90],
      110: same[110],
    }, desktopJob(110, 501, { app: undefined })],
  ];
  for (const [reason, workflowsByCheckId, newerRun = newer] of cases) {
    const result = evaluateOrdinaryChecks(
      [older, newerRun, analyze],
      ordinaryContext(workflowsByCheckId),
    );
    assert.equal(result.ready, false, reason);
    assert.deepEqual(result.failed.map((run) => run.id), [older.id], reason);
  }

  const missingContext = evaluateOrdinaryChecks(
    [older, newer, analyze],
    { workflowsByCheckId: same },
  );
  assert.deepEqual(missingContext.failed.map((run) => run.id), [older.id]);
  assert.deepEqual(
    missingContext.others.map((run) => run.id).sort((a, b) => a - b),
    [older.id, analyze.id, newer.id].sort((a, b) => a - b),
  );

  const pendingErrors = [];
  const pendingCode = pollOrdinaryGate({
    repo: 'example/repo',
    sha: HEAD_SHA,
    token: 'unused',
    prNumber: PR_NUMBER,
    baseRef: BASE_REF,
    initialWait: 0,
    waitBudgetSeconds: 30,
    maxPolls: 1,
  }, {
    fetchChecks: () => [older, desktopJob(110, 501, { status: 'queued', conclusion: null }), analyze],
    resolveWorkflows: () => same,
    sleep: () => {},
    now: () => 0,
    log: () => {},
    error: (text) => pendingErrors.push(text),
  });
  assert.equal(pendingCode, 1);
  assert.match(pendingErrors.join('\n'), /Timed out waiting for/);
  assert.doesNotMatch(pendingErrors.join('\n'), /Failed checks/);
});

test('resolveOrdinaryWorkflow reads run identity and does not fetch without a run url', () => {
  let calls = 0;
  assert.equal(resolveOrdinaryWorkflow('example/repo', 'unused', { id: 1, name: 'build' }, {
    request: () => {
      calls += 1;
      return null;
    },
  }), null);
  assert.equal(calls, 0);
  const workflow = resolveOrdinaryWorkflow('example/repo', 'unused', {
    id: 2,
    details_url: 'https://github.com/example/repo/actions/runs/410/job/2',
  }, {
    request: (requestPath) => {
      calls += 1;
      assert.equal(requestPath, 'actions/runs/410');
      return {
        path: '.github/workflows/desktop-checks.yml',
        name: 'Desktop',
        id: 410,
        event: 'pull_request',
        check_suite_id: 501,
        head_sha: HEAD_SHA,
        pull_requests: [{ number: PR_NUMBER, base: { ref: BASE_REF } }],
      };
    },
  });
  assert.equal(workflow.path, '.github/workflows/desktop-checks.yml');
  assert.equal(workflow.event, 'pull_request');
  assert.equal(workflow.headSha, HEAD_SHA);
  assert.equal(workflow.checkSuiteId, 501);
  assert.deepEqual(workflow.pullRequests, [{ number: PR_NUMBER, base: BASE_REF }]);
  assert.equal(calls, 1);

  const cache = new Map();
  const check = {
    id: 3,
    check_suite: { id: 77 },
  };
  let lookups = 0;
  const resolveWorkflow = () => {
    lookups += 1;
    if (lookups === 1) throw new Error('API 503');
    return { path: '.github/workflows/desktop-checks.yml', event: 'pull_request' };
  };
  assert.deepEqual(resolveOrdinaryWorkflows('example/repo', 'unused', [check], {
    resolveWorkflow,
    cache,
  }), {});
  assert.equal(resolveOrdinaryWorkflows('example/repo', 'unused', [check], {
    resolveWorkflow,
    cache,
  })[3].path, '.github/workflows/desktop-checks.yml');
  resolveOrdinaryWorkflows('example/repo', 'unused', [check], { resolveWorkflow, cache });
  assert.equal(lookups, 2);
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
    throw new Error('gh: Not Found (HTTP 404)');
  }, { sleep: () => {}, now: () => 0, startedAt: 0 }), /HTTP 404/);
});

test('withRateLimitRetry retries transient 5xx and network errors with a logged HTTP status', () => {
  const sleeps = [];
  const logs = [];
  let calls = 0;
  const value = withRateLimitRetry(() => {
    calls += 1;
    if (calls <= 2) throw new Error('gh: Something went wrong (HTTP 502)');
    return 'ok';
  }, {
    sleep: (seconds) => sleeps.push(seconds),
    log: (line) => logs.push(line),
    now: () => 0,
    startedAt: 0,
    budgetSeconds: 600,
    random: () => 1,
  });
  assert.equal(value, 'ok');
  assert.equal(calls, 3);
  assert.equal(sleeps.length, 2);
  assert.match(logs[0], /HTTP 502 \(transient\); retrying in \d+s \(1\/5\)/);
});

test('withRateLimitRetry gives up on transient errors after the retry limit', () => {
  let calls = 0;
  assert.throws(() => withRateLimitRetry(() => {
    calls += 1;
    throw new Error('read ECONNRESET');
  }, { sleep: () => {}, now: () => 0, startedAt: 0, budgetSeconds: 600 }), /ECONNRESET/);
  assert.equal(calls, TRANSIENT_RETRY_LIMIT + 1);
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
  assert.match(yaml, /node --test scripts\/merge-gate-trusted\.test\.mjs/);
  assert.match(yaml, /node --test scripts\/merge-gate-rate-limit\.test\.mjs scripts\/check-gate-files-fresh\.test\.mjs/);
  assert.match(yaml, /seq 1 1\)/);
  assert.match(yaml, /per_page=100&page=\$page/);
  assert.match(yaml, /node scripts\/merge-gate-rate-limit\.mjs gh --/);
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
  assert.match(fresh, /types:\s*\[opened, synchronize, reopened\]/);
  assert.match(fresh, /timeout-minutes:\s*5/);
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

test('parseGhApiIncludeOutput does not split a JSON body that mentions HTTP/', () => {
  const body = JSON.stringify({
    check_runs: [{
      name: 'build',
      output: {
        summary: 'saw HTTP/1.1 200 OK and HTTP/2 403 Forbidden in the log',
        text: 'HTTP/2 403 is inside this string\nHTTP/1.1 200 too',
      },
    }],
    total_count: 1,
  });
  const parsed = parseGhApiIncludeOutput([
    'HTTP/2.0 200 OK',
    'Content-Type: application/json',
    'X-RateLimit-Remaining: 12',
    '',
    body,
  ].join('\n'));
  assert.equal(parsed.status, 200);
  assert.equal(parsed.body, body);
  assert.equal(parsed.json.total_count, 1);
  assert.match(parsed.json.check_runs[0].output.summary, /HTTP\/1\.1 200/);
  assert.match(parsed.json.check_runs[0].output.text, /HTTP\/2 403/);
});

test('parseGhApiIncludeOutput uses the final status after 100 Continue', () => {
  const body = JSON.stringify({
    check_runs: [{ output: { summary: 'HTTP/1.1 200 then HTTP/2 403 in the log' } }],
    total_count: 1,
  });
  const parsed = parseGhApiIncludeOutput([
    'HTTP/1.1 100 Continue\r',
    '\r',
    'HTTP/2.0 200 OK\r',
    'Content-Type: application/json\r',
    'X-RateLimit-Remaining: 9\r',
    '\r',
    body,
  ].join('\n'));
  assert.equal(parsed.status, 200);
  assert.equal(parsed.headers['x-ratelimit-remaining'], '9');
  assert.equal(parsed.body, body);
  assert.equal(parsed.json.total_count, 1);
});

test('withIncludeFlag never sends --paginate together with -i', () => {
  assert.deepEqual(withIncludeFlag(['api', '--paginate', 'repos/example/commits/abc/check-runs']), {
    args: ['api', '--paginate', 'repos/example/commits/abc/check-runs'],
    includeHeaders: false,
  });
  assert.deepEqual(withIncludeFlag(['api', '-i', '--paginate', 'repos/example/commits/abc/check-runs']), {
    args: ['api', '--paginate', 'repos/example/commits/abc/check-runs'],
    includeHeaders: false,
  });
  assert.deepEqual(withIncludeFlag(['api', '--paginate', '--include', 'repos/example/commits/abc/check-runs']), {
    args: ['api', '--paginate', 'repos/example/commits/abc/check-runs'],
    includeHeaders: false,
  });
  const paginated = ghApiArgs('repos/example/commits/abc/check-runs', {
    paginate: true,
    includeHeaders: true,
  });
  assert.ok(paginated.includes('--paginate'));
  assert.equal(paginated.includes('-i'), false);
  assert.equal(paginated.includes('--include'), false);

  let seen;
  runGhWithRetry(['api', '--paginate', '-i', 'repos/example/commits/abc/check-runs'], {
    exec: (_cmd, args) => {
      seen = args;
      return '[]';
    },
    sleep() {},
  });
  assert.ok(seen.includes('--paginate'));
  assert.equal(seen.includes('-i'), false);
  assert.equal(seen.includes('--include'), false);
});

test('gh wrapper preserves a >1MB JSON body through a pipe', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'merge-gate-gh-'));
  const pad = 'HTTP/1.1 200 and HTTP/2 403 '.repeat(40_000);
  const payload = JSON.stringify({
    check_runs: [{ name: 'build', output: { summary: pad } }],
    total_count: 1,
  });
  assert.ok(Buffer.byteLength(payload) > 1_000_000);
  const bodyFile = path.join(dir, 'body.json');
  writeFileSync(bodyFile, payload);
  const fakeGh = path.join(dir, process.platform === 'win32' ? 'gh.cmd' : 'gh');
  writeFileSync(fakeGh, [
    '#!/usr/bin/env node',
    "const { readFileSync } = require('node:fs');",
    `const body = readFileSync(${JSON.stringify(bodyFile)}, 'utf8');`,
    "process.stdout.write(`HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n${body}`, () => {",
    '  process.exitCode = 0;',
    '});',
    '',
  ].join('\n'), { mode: 0o755 });
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('./merge-gate-rate-limit.mjs', import.meta.url)),
    'gh', '--', 'api', 'repos/example/commits/abc/check-runs?per_page=100&page=1',
  ], {
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const collect = async (stream) => {
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const [received, stderr] = await Promise.all([collect(child.stdout), collect(child.stderr)]);
  const code = await new Promise((resolve) => child.once('close', resolve));
  assert.equal(code, 0, stderr.toString());
  assert.equal(received.length, Buffer.byteLength(payload));
  const parsed = JSON.parse(received.toString());
  assert.equal(parsed.total_count, 1);
  assert.equal(parsed.check_runs[0].output.summary, pad);
});
