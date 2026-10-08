import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_RATE_LIMIT_SLEEP_SECONDS = 120;
export const DEFAULT_WAIT_BUDGET_SECONDS = 32 * 60;
export const POLL_INTERVAL_SECONDS = [30, 60, 90];
export const IGNORE_CHECK_NAMES = new Set(['merge-gate', 'merge-gate-trusted']);
export const REQUIRED_ORDINARY_CHECKS = ['Analyze (actions)'];
export const PASS_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

export function errorText(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  return [error.stderr, error.message, error.stdout]
    .filter((part) => part != null && String(part).length > 0)
    .join('\n');
}

export function isRateLimitError(error) {
  const text = errorText(error);
  const lower = text.toLowerCase();
  if (lower.includes('secondary rate limit')) return true;
  if (!lower.includes('rate limit')) return false;
  return /rate limit exceeded/i.test(text) || /\b403\b/.test(text) || /\b429\b/.test(text);
}

export function parseRateLimitHeaders(text) {
  const src = String(text ?? '');
  const retryAfter = src.match(/retry-after:\s*(\d+)/i);
  const reset = src.match(/x-ratelimit-reset:\s*(\d+)/i);
  return {
    retryAfter: retryAfter ? Number(retryAfter[1]) : null,
    resetEpoch: reset ? Number(reset[1]) : null,
  };
}

export function resetEpochFromRateLimit(payload) {
  const resources = payload?.resources && typeof payload.resources === 'object'
    ? Object.values(payload.resources)
    : [];
  const candidates = resources.filter((item) => item && typeof item.reset === 'number');
  const depleted = candidates.filter((item) => item.remaining === 0);
  const pool = depleted.length ? depleted : candidates;
  if (pool.length) return Math.min(...pool.map((item) => item.reset));
  return typeof payload?.rate?.reset === 'number' ? payload.rate.reset : null;
}

export function backoffSeconds(retryAttempt, {
  random = Math.random,
  base = 4,
  cap = MAX_RATE_LIMIT_SLEEP_SECONDS,
} = {}) {
  const exp = Math.min(cap, base * (2 ** Math.max(0, retryAttempt)));
  const jittered = exp * (0.5 + random() * 0.5);
  return Math.min(cap, Math.max(1, Math.round(jittered)));
}

export function rateLimitSleepSeconds({
  error,
  nowSeconds,
  rateLimit,
  retryAttempt = 0,
  maxSleep = MAX_RATE_LIMIT_SLEEP_SECONDS,
  random = Math.random,
} = {}) {
  const headers = parseRateLimitHeaders(errorText(error));
  let seconds = null;
  if (Number.isFinite(headers.retryAfter)) seconds = headers.retryAfter;
  else if (Number.isFinite(headers.resetEpoch) && Number.isFinite(nowSeconds)) {
    seconds = headers.resetEpoch - nowSeconds;
  } else {
    const resetEpoch = resetEpochFromRateLimit(rateLimit);
    if (Number.isFinite(resetEpoch) && Number.isFinite(nowSeconds)) {
      seconds = resetEpoch - nowSeconds;
    }
  }
  if (seconds == null || seconds <= 0) {
    seconds = backoffSeconds(retryAttempt, { random, cap: maxSleep });
  }
  return Math.min(maxSleep, Math.max(1, Math.ceil(seconds)));
}

export function pollIntervalSeconds(pollIndex) {
  const index = Math.min(Math.max(0, Number(pollIndex) || 0), POLL_INTERVAL_SECONDS.length - 1);
  return POLL_INTERVAL_SECONDS[index];
}

export function nextCheckRefresh({
  pendingIds,
  pollIndex = 0,
  pendingLimit = 8,
  fullEvery = 3,
} = {}) {
  if (
    pendingIds == null
    || pendingIds.length === 0
    || pendingIds.length > pendingLimit
    || pollIndex % fullEvery === 0
  ) {
    return { mode: 'all' };
  }
  return { mode: 'pending', ids: pendingIds };
}

export function mergeCheckSnapshots(previousCompleted, fetched, plan = { mode: 'all' }) {
  const completed = plan.mode === 'all' ? new Map() : new Map(previousCompleted);
  const pending = [];
  for (const run of fetched ?? []) {
    if (run?.id == null) continue;
    if (run.status === 'completed') {
      completed.set(run.id, run);
    } else {
      completed.delete(run.id);
      pending.push(run);
    }
  }
  return { completed, pending };
}

export function evaluateOrdinaryChecks(checkRuns, {
  ignoreNames = IGNORE_CHECK_NAMES,
  requiredNames = REQUIRED_ORDINARY_CHECKS,
  passConclusions = PASS_CONCLUSIONS,
} = {}) {
  const others = (checkRuns ?? []).filter((run) => !ignoreNames.has(run.name));
  const incomplete = others.filter((run) => run.status !== 'completed');
  const failed = others.filter((run) =>
    run.status === 'completed' && !passConclusions.has(run.conclusion));
  const missingRequired = requiredNames
    .filter((name) => !others.some((run) => run.name === name))
    .map((name) => ({ name, status: 'missing', conclusion: null }));
  const pending = [...incomplete, ...missingRequired];
  return {
    others,
    pending,
    failed,
    ready: pending.length === 0 && failed.length === 0,
  };
}

export function fetchGitHubRateLimit(token, { exec = execFileSync } = {}) {
  const raw = exec('gh', ['api', 'rate_limit', '-H', 'Accept: application/vnd.github+json'], {
    env: { ...process.env, GH_TOKEN: token },
    encoding: 'utf8',
    windowsHide: true,
  });
  return raw ? JSON.parse(raw) : null;
}

export function withRateLimitRetry(fn, {
  sleep,
  now = Date.now,
  fetchRateLimit,
  startedAt,
  budgetSeconds = DEFAULT_WAIT_BUDGET_SECONDS,
  maxRetries = Number.POSITIVE_INFINITY,
  maxSleep = MAX_RATE_LIMIT_SLEEP_SECONDS,
  random = Math.random,
  log,
} = {}) {
  const start = startedAt ?? now();
  for (let retryAttempt = 0; ; retryAttempt += 1) {
    try {
      return fn();
    } catch (error) {
      if (!isRateLimitError(error)) throw error;
      const remaining = budgetSeconds - (now() - start) / 1000;
      if (retryAttempt >= maxRetries || remaining < 1) throw error;
      let rateLimit = error.rateLimit ?? null;
      if (rateLimit == null && fetchRateLimit) {
        try {
          rateLimit = fetchRateLimit();
        } catch {
          rateLimit = null;
        }
      }
      const wait = rateLimitSleepSeconds({
        error,
        nowSeconds: now() / 1000,
        rateLimit,
        retryAttempt,
        maxSleep,
        random,
      });
      const sleepFor = Math.min(wait, remaining);
      if (sleepFor < 1) throw error;
      log?.(`GitHub API rate limited; retrying in ${Math.ceil(sleepFor)}s…`);
      sleep(sleepFor);
    }
  }
}

function sleepSeconds(seconds) {
  execFileSync('sleep', [String(seconds)], { windowsHide: true });
}

export function waitOptionsFromEnv(env = process.env) {
  return {
    budgetSeconds: Number(env.MERGE_GATE_WAIT_SECONDS ?? DEFAULT_WAIT_BUDGET_SECONDS),
    maxSleep: Number(env.MERGE_GATE_MAX_SLEEP ?? MAX_RATE_LIMIT_SLEEP_SECONDS),
    startedAt: Number(env.MERGE_GATE_STARTED_AT_MS) || Date.now(),
  };
}

export function runGhWithRetry(args, {
  token = process.env.GH_TOKEN,
  exec = execFileSync,
  sleep = sleepSeconds,
  now = Date.now,
  fetchRateLimit,
  startedAt,
  budgetSeconds,
  maxSleep,
  random = Math.random,
  log = console.error,
} = {}) {
  const wait = waitOptionsFromEnv();
  return withRateLimitRetry(() => exec('gh', args, {
    env: { ...process.env, GH_TOKEN: token ?? process.env.GH_TOKEN },
    encoding: 'utf8',
    windowsHide: true,
  }), {
    sleep,
    now,
    fetchRateLimit: fetchRateLimit ?? (() => fetchGitHubRateLimit(token, { exec })),
    startedAt: startedAt ?? wait.startedAt,
    budgetSeconds: budgetSeconds ?? wait.budgetSeconds,
    maxSleep: maxSleep ?? wait.maxSleep,
    random,
    log,
  });
}

export function shouldSkipEditedRerun(runs, { runId, sha } = {}) {
  return (runs ?? []).some((run) => {
    if (runId != null && Number(run.id) === Number(runId)) return false;
    if (sha && run.head_sha && run.head_sha !== sha) return false;
    if (run.status !== 'completed') return true;
    return run.conclusion === 'success';
  });
}

export function fetchMergeGateRuns(repo, sha, token, { exec = execFileSync } = {}) {
  const raw = runGhWithRetry(
    ['api', `repos/${repo}/actions/workflows/merge-gate.yml/runs?head_sha=${sha}&per_page=20`],
    { token, exec },
  );
  const payload = raw ? JSON.parse(raw) : {};
  return payload.workflow_runs ?? [];
}

export function skipEditedMergeGate({
  repo,
  sha,
  token,
  runId,
  action = process.env.MERGE_GATE_ACTION ?? process.env.GITHUB_EVENT_ACTION,
  fetchRuns = fetchMergeGateRuns,
  outputFile = process.env.GITHUB_OUTPUT,
} = {}) {
  if (action !== 'edited') return false;
  const skip = shouldSkipEditedRerun(fetchRuns(repo, sha, token), { runId, sha });
  if (outputFile) appendFileSync(outputFile, `skip=${skip ? 'true' : 'false'}\n`);
  return skip;
}

export function fetchOrdinaryCheckRuns(repo, sha, token, plan = { mode: 'all' }, {
  exec = execFileSync,
} = {}) {
  const api = (requestPath) => {
    const raw = exec('gh', ['api', `repos/${repo}/${requestPath}`, '-H', 'Accept: application/vnd.github+json'], {
      env: { ...process.env, GH_TOKEN: token },
      encoding: 'utf8',
      windowsHide: true,
    });
    return raw ? JSON.parse(raw) : null;
  };
  if (plan.mode === 'pending') {
    return (plan.ids ?? []).map((id) => api(`check-runs/${id}`));
  }
  const payload = api(`commits/${sha}/check-runs?per_page=100`);
  return payload?.check_runs ?? [];
}

export function pollOrdinaryGate({
  repo,
  sha,
  token,
  initialWait = 30,
  waitBudgetSeconds = DEFAULT_WAIT_BUDGET_SECONDS,
  maxPolls = 64,
} = {}, {
  fetchChecks = fetchOrdinaryCheckRuns,
  sleep = sleepSeconds,
  now = Date.now,
  fetchRateLimit,
  log = console.log,
  error = console.error,
  random = Math.random,
} = {}) {
  const startedAt = now();
  if (initialWait > 0) {
    sleep(Math.min(initialWait, waitBudgetSeconds));
  }

  const completed = new Map();
  let pendingIds = null;
  let polls = 0;

  while (true) {
    const elapsed = (now() - startedAt) / 1000;
    if (elapsed >= waitBudgetSeconds) {
      error('Timed out waiting for checks.');
      return 1;
    }

    const plan = nextCheckRefresh({ pendingIds, pollIndex: polls });
    let fetched;
    try {
      fetched = withRateLimitRetry(
        () => fetchChecks(repo, sha, token, plan),
        {
          sleep,
          now,
          fetchRateLimit: fetchRateLimit ?? (() => fetchGitHubRateLimit(token)),
          startedAt,
          budgetSeconds: waitBudgetSeconds,
          random,
          log,
        },
      );
    } catch (err) {
      if (isRateLimitError(err)) {
        error('Timed out waiting for checks.');
        return 1;
      }
      error(errorText(err) || String(err));
      return 1;
    }

    const merged = mergeCheckSnapshots(completed, fetched, plan);
    completed.clear();
    for (const [id, run] of merged.completed) completed.set(id, run);
    pendingIds = merged.pending.map((run) => run.id);

    const result = evaluateOrdinaryChecks([...completed.values(), ...merged.pending]);
    if (result.failed.length) {
      error('Failed checks:');
      for (const run of result.failed) error(`${run.name}: ${run.conclusion}`);
      return 1;
    }
    if (result.ready) {
      log(`All ${result.others.length} other checks passed.`);
      return 0;
    }

    polls += 1;
    const remaining = waitBudgetSeconds - (now() - startedAt) / 1000;
    if (polls >= maxPolls || remaining < 1) {
      error('Timed out waiting for checks.');
      return 1;
    }
    log(`Waiting for ${result.pending.length} check(s)…`);
    sleep(Math.min(pollIntervalSeconds(polls - 1), remaining));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'gh') {
    const args = process.argv.slice(3);
    if (args[0] === '--') args.shift();
    try {
      process.stdout.write(runGhWithRetry(args) ?? '');
    } catch (error) {
      if (error.stderr) process.stderr.write(String(error.stderr));
      else console.error(errorText(error) || String(error));
      process.exit(error.status ?? 1);
    }
    process.exit(0);
  }

  const repo = process.env.REPO;
  const sha = process.env.SHA;
  const token = process.env.GH_TOKEN;
  if (!repo || !sha || !token) {
    console.error('Missing required environment variables: REPO, SHA, GH_TOKEN');
    process.exit(1);
  }

  if (command === 'skip-edited' || process.env.MERGE_GATE_ACTION === 'edited') {
    const skip = skipEditedMergeGate({
      repo,
      sha,
      token,
      runId: process.env.GITHUB_RUN_ID,
    });
    if (command === 'skip-edited') {
      if (skip) console.log('Skipping redundant edited merge-gate rerun for this SHA.');
      process.exit(0);
    }
    if (skip) {
      console.log('Skipping redundant edited merge-gate wait; another run for this SHA is in progress or succeeded.');
      process.exit(0);
    }
  }

  process.exit(pollOrdinaryGate({
    repo,
    sha,
    token,
    initialWait: Number(process.env.MERGE_GATE_INITIAL_WAIT ?? 30),
    waitBudgetSeconds: Number(process.env.MERGE_GATE_WAIT_SECONDS ?? DEFAULT_WAIT_BUDGET_SECONDS),
    maxPolls: Number(process.env.MERGE_GATE_MAX_ATTEMPTS ?? 64),
  }));
}
