import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newestChecksByIdentity, workflowFromActionsRun } from './merge-gate-trusted.mjs';

export const MAX_RATE_LIMIT_SLEEP_SECONDS = 120;
export const DEFAULT_WAIT_BUDGET_SECONDS = 32 * 60;
export const GH_API_MAX_BUFFER = 64 * 1024 * 1024;
export const POLL_INTERVAL_SECONDS = [30, 60, 90];
export const IGNORE_CHECK_NAMES = new Set(['merge-gate', 'merge-gate-trusted']);
export const REQUIRED_ORDINARY_CHECKS = ['Analyze (actions)'];
export const PASS_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);
export const COMMENT_JOB_NAME = 'comment';
export const VISUAL_TOUR_WORKFLOW_PATH = '.github/workflows/visual-tour.yml';
export const TIMEOUT_RERUN_LINE = 're-run merge-gate, do not merge main';

export function errorText(error) {
  if (error == null) return '';
  if (typeof error === 'string') return error;
  return [error.stderr, error.message, error.stdout, error.body]
    .filter((part) => part != null && String(part).length > 0)
    .join('\n');
}

function headerMap(headers) {
  if (headers == null || typeof headers !== 'object' || Array.isArray(headers)) return {};
  const normalized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) continue;
    normalized[String(key).toLowerCase()] = String(value);
  }
  return normalized;
}

function headerNumber(headers, name) {
  const value = headerMap(headers)[name];
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseHeaderLines(headerBlock) {
  const headers = {};
  for (const line of String(headerBlock).split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function leadingHttpStatus(text) {
  return String(text).match(/^HTTP\/\S+\s+(\d{3})[^\n]*\r?\n/);
}

function splitHeadersFromBody(rest) {
  if (rest.startsWith('\r\n')) return { headerBlock: '', bodyOffset: 2 };
  if (rest.startsWith('\n')) return { headerBlock: '', bodyOffset: 1 };
  const blank = rest.search(/\r?\n\r?\n/);
  if (blank === -1) return null;
  const separator = rest.slice(blank).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
  return { headerBlock: rest.slice(0, blank), bodyOffset: blank + separator.length };
}

export function parseGhApiIncludeOutput(text) {
  const src = String(text ?? '');
  let pos = 0;
  let status = null;
  let headers = {};
  while (pos < src.length) {
    const match = leadingHttpStatus(src.slice(pos));
    if (!match) break;
    const afterStatus = pos + match[0].length;
    const rest = src.slice(afterStatus);
    const split = splitHeadersFromBody(rest);
    if (!split) {
      status = Number(match[1]);
      headers = parseHeaderLines(rest);
      return { status, headers, body: '', json: null };
    }
    headers = parseHeaderLines(split.headerBlock);
    status = Number(match[1]);
    pos = afterStatus + split.bodyOffset;
    if (!leadingHttpStatus(src.slice(pos))) break;
  }
  const body = status == null ? src : src.slice(pos);
  let json = null;
  try {
    json = body.trim() ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  return { status, headers, body, json };
}

export function writeFully(stream, data) {
  return new Promise((resolve, reject) => {
    const payload = data ?? '';
    if (payload.length === 0) {
      resolve();
      return;
    }
    stream.write(payload, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function httpStatusOf(error) {
  if (error == null || typeof error === 'string') {
    const text = errorText(error);
    const match = text.match(/\bHTTP\/\S+\s+(\d{3})\b/i)
      || text.match(/\((?:HTTP\s+)?(\d{3})\)/)
      || text.match(/\bHTTP\s+(\d{3})\b/i);
    return match ? Number(match[1]) : null;
  }
  if (Number.isFinite(error.httpStatus)) return Number(error.httpStatus);
  if (Number.isFinite(error.statusCode)) return Number(error.statusCode);
  const text = errorText(error);
  const match = text.match(/\bHTTP\/\S+\s+(\d{3})\b/i)
    || text.match(/\((?:HTTP\s+)?(\d{3})\)/)
    || text.match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

export function isRateLimitError(error) {
  const status = httpStatusOf(error);
  const text = errorText(error);
  const body = String(error?.body ?? '');
  const combined = `${text}\n${body}`;
  const lower = combined.toLowerCase();
  const headers = headerMap(error?.headers);
  const remaining = headers['x-ratelimit-remaining'];
  const retryAfter = headers['retry-after'];

  if (status === 429 || /\b429\b/.test(combined)) return true;

  const secondary = lower.includes('secondary rate limit');
  const primary = /rate limit exceeded/i.test(combined) || lower.includes('api rate limit');
  const remainingZero = remaining === '0';
  const retryAfterPresent = retryAfter != null && retryAfter !== '';

  if (status === 403 || /\b403\b/.test(combined)) {
    // Primary: body or X-RateLimit-Remaining: 0. Secondary: body or Retry-After.
    return secondary || primary || remainingZero || retryAfterPresent;
  }
  return secondary || primary;
}

export function parseRateLimitHeaders(source) {
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const headers = source.headers ?? source;
    if (headers && typeof headers === 'object' && !Array.isArray(headers)
      && (headers['retry-after'] != null || headers['Retry-After'] != null
        || headers['x-ratelimit-reset'] != null || headers['X-RateLimit-Reset'] != null
        || headers.retryAfter != null || headers.resetEpoch != null)) {
      return {
        retryAfter: headerNumber(headers, 'retry-after') ?? (Number.isFinite(headers.retryAfter) ? headers.retryAfter : null),
        resetEpoch: headerNumber(headers, 'x-ratelimit-reset') ?? (Number.isFinite(headers.resetEpoch) ? headers.resetEpoch : null),
        remaining: headerNumber(headers, 'x-ratelimit-remaining'),
      };
    }
  }
  const src = String(source ?? '');
  const retryAfter = src.match(/retry-after:\s*(\d+)/i);
  const reset = src.match(/x-ratelimit-reset:\s*(\d+)/i);
  const remaining = src.match(/x-ratelimit-remaining:\s*(\d+)/i);
  return {
    retryAfter: retryAfter ? Number(retryAfter[1]) : null,
    resetEpoch: reset ? Number(reset[1]) : null,
    remaining: remaining ? Number(remaining[1]) : null,
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
  const fromObject = parseRateLimitHeaders(error?.headers ?? error);
  const fromText = parseRateLimitHeaders(errorText(error));
  const retryAfter = fromObject.retryAfter ?? fromText.retryAfter;
  const resetEpoch = fromObject.resetEpoch ?? fromText.resetEpoch;
  let seconds = null;
  if (Number.isFinite(retryAfter)) seconds = retryAfter;
  else if (Number.isFinite(resetEpoch) && Number.isFinite(nowSeconds)) {
    seconds = resetEpoch - nowSeconds;
  } else {
    const resetFromPayload = resetEpochFromRateLimit(rateLimit);
    if (Number.isFinite(resetFromPayload) && Number.isFinite(nowSeconds)) {
      seconds = resetFromPayload - nowSeconds;
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

export function nextCheckRefresh(_state = {}) {
  // One paginated list call per poll. Per-id refreshes miss later pages and
  // newly registered jobs.
  return { mode: 'all' };
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

export function mergeCheckRunPages(payload) {
  const pages = Array.isArray(payload) ? payload : payload == null ? [] : [payload];
  const checkRuns = pages.flatMap((page) => {
    if (Array.isArray(page)) return page;
    return page?.check_runs ?? [];
  });
  const reported = pages
    .map((page) => (page && !Array.isArray(page) ? page.total_count : null))
    .find((value) => Number.isInteger(value));
  const totalCount = reported ?? checkRuns.length;
  return {
    checkRuns,
    totalCount,
    complete: checkRuns.length >= totalCount,
  };
}

export function evaluateOrdinaryChecks(checkRuns, {
  ignoreNames = IGNORE_CHECK_NAMES,
  requiredNames = REQUIRED_ORDINARY_CHECKS,
  passConclusions = PASS_CONCLUSIONS,
  workflowsByCheckId = {},
  skipCommentWorkflowPath = VISUAL_TOUR_WORKFLOW_PATH,
  sha,
  prNumber,
  baseRef,
} = {}) {
  const others = newestChecksByIdentity(checkRuns ?? [], workflowsByCheckId, {
    sha,
    prNumber,
    baseRef,
  }).filter((run) => {
    if (ignoreNames.has(run.name)) return false;
    if (run.name === COMMENT_JOB_NAME) {
      const workflow = workflowsByCheckId[run.id] ?? workflowsByCheckId[String(run.id)];
      if (workflow?.path === skipCommentWorkflowPath) return false;
    }
    return true;
  });
  const incomplete = others.filter((run) => run.status !== 'completed');
  const failed = others.filter((run) =>
    run.status === 'completed' && !passConclusions.has(run.conclusion));
  const missingRequired = requiredNames
    .filter((name) => !others.some((run) => run.name === name))
    .map((name) => ({ name, status: 'missing', conclusion: null }));
  const pending = [...incomplete, ...missingRequired];
  const completed = others.filter((run) => run.status === 'completed');
  const allPending = others.length > 0 && completed.length === 0;
  return {
    others,
    pending,
    failed,
    allPending,
    ready: pending.length === 0 && failed.length === 0 && !allPending,
  };
}

export function isPassableCheckSnapshot(result) {
  if (!result) return false;
  if (result.failed?.length) return false;
  if (result.pending?.length) return false;
  if (result.allPending) return false;
  if (!result.ready) return false;
  return (result.others ?? []).some((run) => run.status === 'completed');
}

export function formatOrdinaryTimeout(pending, { missingAnalyze = false } = {}) {
  const names = [...new Set((pending ?? []).map((run) => run.name).filter(Boolean))];
  if (missingAnalyze && !names.includes('Analyze (actions)')) names.push('Analyze (actions)');
  names.sort();
  const waitingOn = names.length ? names.join(', ') : '(no named pending check)';
  return `Timed out waiting for: ${waitingOn}\n${TIMEOUT_RERUN_LINE}`;
}

export function fetchGitHubRateLimit(token, { exec = execFileSync } = {}) {
  const parsed = execGhApi(['api', 'rate_limit', '-H', 'Accept: application/vnd.github+json'], {
    token,
    exec,
    includeHeaders: false,
  });
  return parsed.json;
}

export function attachGhApiError(error, stdout) {
  const parsed = parseGhApiIncludeOutput(stdout ?? error?.stdout ?? '');
  if (parsed.status != null) error.httpStatus = parsed.status;
  if (Object.keys(parsed.headers).length) error.headers = { ...headerMap(error.headers), ...parsed.headers };
  if (parsed.body) error.body = parsed.body;
  return error;
}

export function execGhApi(args, {
  token = process.env.GH_TOKEN,
  exec = execFileSync,
  includeHeaders = !args.includes('--paginate')
    && (args.includes('-i') || args.includes('--include')),
  maxBuffer = GH_API_MAX_BUFFER,
} = {}) {
  try {
    const raw = exec('gh', args, {
      env: { ...process.env, GH_TOKEN: token ?? process.env.GH_TOKEN },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer,
    });
    if (!includeHeaders) {
      let json = null;
      try {
        json = raw?.trim() ? JSON.parse(raw) : null;
      } catch {
        json = null;
      }
      return { status: 200, headers: {}, body: raw ?? '', json, raw };
    }
    const parsed = parseGhApiIncludeOutput(raw);
    return { ...parsed, raw };
  } catch (error) {
    attachGhApiError(error, error.stdout);
    throw error;
  }
}

export function ghApiArgs(requestPath, {
  paginate = false,
  includeHeaders = !paginate,
  jq,
} = {}) {
  const args = ['api'];
  if (paginate) args.push('--paginate');
  else if (includeHeaders && !jq) args.push('-i');
  args.push(requestPath, '-H', 'Accept: application/vnd.github+json');
  if (jq) args.push('--jq', jq);
  return args;
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

export function withIncludeFlag(args) {
  if (!Array.isArray(args) || args[0] !== 'api') return { args, includeHeaders: false };
  if (args.includes('--paginate')) {
    return {
      args: args.filter((arg) => arg !== '-i' && arg !== '--include'),
      includeHeaders: false,
    };
  }
  if (args.includes('-i') || args.includes('--include')) return { args, includeHeaders: true };
  return { args: ['api', '-i', ...args.slice(1)], includeHeaders: true };
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
  const prepared = withIncludeFlag(args);
  const parsed = withRateLimitRetry(() => execGhApi(prepared.args, {
    token,
    exec,
    includeHeaders: prepared.includeHeaders,
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
  return prepared.includeHeaders ? (parsed.body ?? '') : (parsed.raw ?? parsed.body ?? '');
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

function defaultRequest(repo, token, requestPath, { exec = execFileSync } = {}) {
  const parsed = execGhApi(ghApiArgs(`repos/${repo}/${requestPath}`), { token, exec, includeHeaders: true });
  return parsed.json;
}

export function resolveCommentWorkflow(repo, token, checkRun, {
  exec = execFileSync,
  request,
} = {}) {
  const get = request ?? ((requestPath) => defaultRequest(repo, token, requestPath, { exec }));
  const fromUrl = String(checkRun?.details_url ?? checkRun?.html_url ?? '').match(/\/actions\/runs\/(\d+)/);
  if (fromUrl) {
    const run = get(`actions/runs/${fromUrl[1]}`);
    return run?.path ? { path: run.path } : null;
  }
  const suiteId = checkRun?.check_suite?.id;
  if (!suiteId) return null;
  const payload = get(`actions/runs?check_suite_id=${suiteId}&per_page=1`);
  const pathName = payload?.workflow_runs?.[0]?.path;
  return pathName ? { path: pathName } : null;
}

export function resolveCommentWorkflows(repo, token, checkRuns, {
  exec = execFileSync,
  request,
  resolveWorkflow = resolveCommentWorkflow,
} = {}) {
  const workflowsByCheckId = {};
  for (const run of checkRuns ?? []) {
    if (run?.name !== COMMENT_JOB_NAME) continue;
    const workflow = resolveWorkflow(repo, token, run, { exec, request });
    if (workflow) workflowsByCheckId[run.id] = workflow;
  }
  return workflowsByCheckId;
}

export function resolveOrdinaryWorkflow(repo, token, checkRun, {
  exec = execFileSync,
  request,
} = {}) {
  const get = request ?? ((requestPath) => defaultRequest(repo, token, requestPath, { exec }));
  const fromUrl = String(checkRun?.details_url ?? checkRun?.html_url ?? '').match(/\/actions\/runs\/(\d+)/);
  let payload = null;
  if (fromUrl) {
    payload = get(`actions/runs/${fromUrl[1]}`);
  } else if (checkRun?.check_suite?.id) {
    payload = get(`actions/runs?check_suite_id=${checkRun.check_suite.id}&per_page=1`)?.workflow_runs?.[0];
  } else {
    return null;
  }
  const workflow = workflowFromActionsRun(payload);
  return workflow?.path ? workflow : null;
}

export function resolveOrdinaryWorkflows(repo, token, checkRuns, {
  exec = execFileSync,
  request,
  resolveWorkflow = resolveOrdinaryWorkflow,
  cache,
} = {}) {
  const workflowsByCheckId = {};
  for (const run of checkRuns ?? []) {
    if (run?.id == null) continue;
    if (cache?.has(run.id)) {
      workflowsByCheckId[run.id] = cache.get(run.id);
      continue;
    }
    let workflow = null;
    try {
      workflow = resolveWorkflow(repo, token, run, { exec, request });
    } catch {
      // Retry on the next poll. An unattributed check never collapses.
      continue;
    }
    if (!workflow?.path) continue;
    workflowsByCheckId[run.id] = workflow;
    cache?.set(run.id, workflow);
  }
  return workflowsByCheckId;
}

export function fetchOrdinaryCheckRuns(repo, sha, token, plan = { mode: 'all' }, {
  exec = execFileSync,
  request,
} = {}) {
  const get = request ?? ((requestPath) => defaultRequest(repo, token, requestPath, { exec }));
  if (plan.mode === 'pending') {
    return (plan.ids ?? []).map((id) => get(`check-runs/${id}`));
  }
  const pages = [];
  for (let page = 1; ; page += 1) {
    const payload = get(`commits/${sha}/check-runs?per_page=100&page=${page}`);
    pages.push(payload);
    const merged = mergeCheckRunPages(pages);
    if (merged.complete) return merged.checkRuns;
    const pageLen = Array.isArray(payload?.check_runs) ? payload.check_runs.length : 0;
    if (pageLen === 0) return merged.checkRuns;
  }
}

export function pollOrdinaryGate({
  repo,
  sha,
  token,
  prNumber,
  baseRef,
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
  resolveWorkflows = resolveOrdinaryWorkflows,
} = {}) {
  const startedAt = now();
  const attributionCache = new Map();
  if (initialWait > 0) {
    sleep(Math.min(initialWait, waitBudgetSeconds));
  }

  let last = { pending: [], others: [] };
  let polls = 0;

  while (true) {
    const elapsed = (now() - startedAt) / 1000;
    if (elapsed >= waitBudgetSeconds) {
      const missingAnalyze = !(last.others ?? []).some((run) => run.name === 'Analyze (actions)');
      error(formatOrdinaryTimeout(last.pending, { missingAnalyze }));
      return 1;
    }

    const plan = nextCheckRefresh({ pollIndex: polls });
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
      if (isRateLimitError(err) || /HTTP\s*5\d\d/i.test(errorText(err))) {
        const missingAnalyze = !(last.others ?? []).some((run) => run.name === 'Analyze (actions)');
        error(formatOrdinaryTimeout(last.pending, { missingAnalyze }));
        return 1;
      }
      error(errorText(err) || String(err));
      return 1;
    }

    const workflowsByCheckId = resolveWorkflows(repo, token, fetched, { cache: attributionCache });
    const result = evaluateOrdinaryChecks(fetched, {
      workflowsByCheckId,
      sha,
      prNumber,
      baseRef,
    });
    last = result;
    if (result.failed.length) {
      error('Failed checks:');
      for (const run of result.failed) error(`${run.name}: ${run.conclusion}`);
      return 1;
    }
    if (isPassableCheckSnapshot(result)) {
      log(`All ${result.others.length} other checks passed.`);
      return 0;
    }

    polls += 1;
    const remaining = waitBudgetSeconds - (now() - startedAt) / 1000;
    if (polls >= maxPolls || remaining < 1) {
      const missingAnalyze = !(result.others ?? []).some((run) => run.name === 'Analyze (actions)');
      error(formatOrdinaryTimeout(result.pending, { missingAnalyze }));
      return 1;
    }
    log(`Waiting for ${result.pending.length} check(s)…`);
    sleep(Math.min(pollIntervalSeconds(polls - 1), remaining));
  }
}

async function runGhCli(args) {
  if (args[0] === '--') args.shift();
  try {
    await writeFully(process.stdout, runGhWithRetry(args) ?? '');
    process.exitCode = 0;
  } catch (error) {
    const errText = error.stderr != null && String(error.stderr).length > 0
      ? String(error.stderr)
      : `${errorText(error) || String(error)}\n`;
    await writeFully(process.stderr, errText);
    process.exitCode = error.status ?? 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'gh') {
    void runGhCli(process.argv.slice(3)).catch((error) => {
      console.error(errorText(error) || String(error));
      process.exitCode = 1;
    });
  } else {

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
      process.exit(skip ? 0 : 1);
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
    prNumber: process.env.PR_NUMBER,
    baseRef: process.env.BASE_REF,
    initialWait: Number(process.env.MERGE_GATE_INITIAL_WAIT ?? 30),
    waitBudgetSeconds: Number(process.env.MERGE_GATE_WAIT_SECONDS ?? DEFAULT_WAIT_BUDGET_SECONDS),
    maxPolls: Number(process.env.MERGE_GATE_MAX_ATTEMPTS ?? 64),
  }));
  }
}
