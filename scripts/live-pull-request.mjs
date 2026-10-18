// The pull request as it is now, read from the API. The event payload is a snapshot from when the event fired:
// a body edited after a push (the SELF-CHECK handover) is missing from it. CI checks read the live body instead.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  execGhApi,
  fetchGitHubRateLimit,
  ghApiArgs,
  isRateLimitError,
  withRateLimitRetry,
} from './merge-gate-rate-limit.mjs';

export const LIVE_READ_ATTEMPTS = 4;
export const LIVE_READ_DELAYS_SECONDS = [5, 10, 20];

// Match commit-emails' 10-minute budget, leaving room within the 15-minute job cap.
export const COVERAGE_RATE_LIMIT_BUDGET_SECONDS = 600;
export const COVERAGE_RATE_LIMIT_BUFFER_SECONDS = 15;

// Live mode when the repo, the PR number and a token are set. Local runs fall back to GITHUB_EVENT_PATH.
export function liveContext(env = process.env) {
  const token = env.GH_TOKEN || env.GITHUB_TOKEN;
  if (!env.REPO || !env.PR_NUMBER || !token) return null;
  return { repo: env.REPO, prNumber: env.PR_NUMBER, token };
}

function defaultRequest(ctx, exec) {
  const parsed = execGhApi(ghApiArgs(`repos/${ctx.repo}/pulls/${ctx.prNumber}`), {
    token: ctx.token,
    includeHeaders: true,
    ...(exec ? { exec } : {}),
  });
  if (!parsed.json || typeof parsed.json !== 'object') {
    throw new Error('GitHub API returned a non-object pull request');
  }
  return parsed.json;
}

function pullRequestSnapshot(pr) {
  return {
    body: typeof pr?.body === 'string' ? pr.body : '',
    headRef: pr?.head?.ref ?? '',
    headSha: pr?.head?.sha ?? '',
  };
}

// A rate-limit 403/429 waits until reset (x-ratelimit-reset, or `gh api rate_limit`) plus a small buffer,
// inside one budget for the step. Any other error keeps the short retries and still fails closed.
export function readLivePullRequest(ctx, {
  exec,
  request = (current) => defaultRequest(current, exec),
  sleep = defaultSleep,
  now = Date.now,
  fetchRateLimit,
  budgetSeconds = COVERAGE_RATE_LIMIT_BUDGET_SECONDS,
  bufferSeconds = COVERAGE_RATE_LIMIT_BUFFER_SECONDS,
  maxSleep = budgetSeconds,
  random,
  log = console.log,
} = {}) {
  const startedAt = now();
  const readWithShortRetries = () => {
    let lastError = null;
    for (let attempt = 1; attempt <= LIVE_READ_ATTEMPTS; attempt += 1) {
      try {
        return pullRequestSnapshot(request(ctx));
      } catch (error) {
        if (isRateLimitError(error)) throw error;
        lastError = error;
        if (attempt < LIVE_READ_ATTEMPTS) sleep(LIVE_READ_DELAYS_SECONDS[attempt - 1]);
      }
    }
    const detail = String(lastError?.message ?? lastError).split('\n')[0];
    throw new Error(`${detail} (after ${LIVE_READ_ATTEMPTS} attempts)`);
  };

  try {
    return withRateLimitRetry(readWithShortRetries, {
      sleep,
      now,
      fetchRateLimit: fetchRateLimit ?? (() => fetchGitHubRateLimit(ctx.token)),
      startedAt,
      budgetSeconds,
      maxSleep,
      bufferSeconds,
      retryTransient: false,
      random,
      log,
    });
  } catch (error) {
    if (!isRateLimitError(error)) throw error;
    const detail = String(error?.message ?? error).split('\n')[0];
    throw new Error(
      `checks-unavailable: GitHub API rate limit outlasted the ${budgetSeconds}s wait while reading pull request #${ctx.prNumber}. Not a coverage failure; re-run the check. ${detail}`,
    );
  }
}

function defaultSleep(seconds) {
  execFileSync('sleep', [String(seconds)], { windowsHide: true });
}

// The job's one live read, written by a step and shared by check-ui-proof and check-self-check through
// PR_SNAPSHOT_FILE. A missing or unreadable file throws, so the caller fails closed instead of reading the API again.
export function snapshotFromEnv(env = process.env, { read = readFileSync } = {}) {
  const file = env.PR_SNAPSHOT_FILE;
  if (!file) return null;
  const pr = JSON.parse(read(file, 'utf8'));
  return {
    body: typeof pr?.body === 'string' ? pr.body : '',
    headRef: typeof pr?.headRef === 'string' ? pr.headRef : '',
    headSha: typeof pr?.headSha === 'string' ? pr.headSha : '',
  };
}

export function main(args = process.argv.slice(2), { env = process.env, ...readOptions } = {}) {
  const ctx = liveContext(env);
  const outFile = args[0];
  if (!ctx || !outFile) {
    console.error('Usage: REPO, PR_NUMBER and GH_TOKEN set; node scripts/live-pull-request.mjs <out.json>');
    return 1;
  }
  try {
    writeFileSync(outFile, JSON.stringify(readLivePullRequest(ctx, readOptions)));
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
