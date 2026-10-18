// Fail pull request commits dated at or after the cutoff whose author, committer,
// or Co-authored-by address is not a GitHub noreply or cursoragent@cursor.com.
// The report never prints a full personal email; only a short SHA, field, and masked domain.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GH_API_MAX_BUFFER,
  execGhApi,
  fetchGitHubRateLimit,
  ghApiArgs,
  httpStatusOf,
  isRateLimitError,
  isTransientGitHubError,
  withRateLimitRetry,
} from './merge-gate-rate-limit.mjs';
import { PR_COMMITS_CAP, ghApi } from './merge-gate-trusted.mjs';

export const CUTOFF_ISO = '2026-10-08T04:05:00Z';
export const CUTOFF_MS = Date.parse(CUTOFF_ISO);
export const ALLOWED_EXACT = new Set(['noreply@github.com', 'cursoragent@cursor.com']);
export const ALLOWED_SUFFIX = '@users.noreply.github.com';
export const FIX_LINES = [
  'Cloud agents: end the commit message with `Co-authored-by: Taofik Bishi <189563683+stabrea@users.noreply.github.com>`. Others: set git user.email to a GitHub noreply address. Add a new commit; don\'t force-push.',
  'if this commit is already pushed, open a fresh branch from main with clean commits',
];
export const COMMIT_EMAIL_WAIT_SECONDS = 600;
export const NOT_CHECKED = 'not checked';
export const RATE_LIMIT_RERUN_LINE = `${NOT_CHECKED}: rate limited, re-run`;
export { PR_COMMITS_CAP };

export function commitCapLine(count, cap = PR_COMMITS_CAP) {
  return `GitHub only lists the first ${cap} pull request commits; this PR has ${count} or more, so commit emails cannot be checked.`;
}

export function parseTrailers(message) {
  const emails = [];
  for (const raw of String(message ?? '').split(/\r?\n/)) {
    const match = /^co-authored-by:\s*(.+)$/i.exec(raw.trim());
    if (!match) continue;
    const email = emailFromTrailerValue(match[1]);
    if (email) emails.push(email);
  }
  return emails;
}

export function classifyAddress(address) {
  const email = String(address ?? '').trim().toLowerCase();
  if (!email) return { allowed: false, domain: '' };
  const domain = domainOf(email);
  if (ALLOWED_EXACT.has(email) || email.endsWith(ALLOWED_SUFFIX)) {
    return { allowed: true, domain };
  }
  return { allowed: false, domain };
}

export function maskEmail(address) {
  const domain = classifyAddress(address).domain;
  return domain ? `***@${domain}` : '***';
}

export function evaluateCommits(commits, cutoffMs = CUTOFF_MS) {
  const failures = [];
  for (const commit of commits ?? []) {
    const committerDate = commit?.commit?.committer?.date;
    const when = Date.parse(committerDate ?? '');
    if (Number.isFinite(when) && when < cutoffMs) continue;

    const sha = shortSha(commit?.sha);
    const message = commit?.commit?.message ?? '';
    const authorEmail = commit?.commit?.author?.email ?? '';
    const committerEmail = commit?.commit?.committer?.email ?? '';

    for (const email of parseTrailers(message)) {
      if (!classifyAddress(email).allowed) {
        failures.push({ sha, field: 'co-author', hint: maskEmail(email) });
      }
    }
    if (!classifyAddress(authorEmail).allowed) {
      failures.push({ sha, field: 'author', hint: maskEmail(authorEmail) });
    }
    if (!classifyAddress(committerEmail).allowed) {
      failures.push({ sha, field: 'committer', hint: maskEmail(committerEmail) });
    }
  }
  return failures;
}

export function formatReport(failures) {
  const lines = (failures ?? []).map((failure) =>
    `${failure.sha} ${failure.field} ${failure.hint}`);
  lines.push(...FIX_LINES);
  return lines.join('\n');
}

export function commitsFromGhPages(payload) {
  if (!Array.isArray(payload)) return [];
  if (payload.every((item) => item && typeof item.sha === 'string')) return payload;
  return payload.flatMap((page) => (Array.isArray(page) ? page : []));
}

export function defaultCommitRequest(repo, token, requestPath, options = {}) {
  const paginate = options.paginate === true;
  const parsed = execGhApi(ghApiArgs(`repos/${repo}/${requestPath}`, {
    paginate,
    includeHeaders: !paginate,
  }), {
    token,
    includeHeaders: !paginate,
    maxBuffer: GH_API_MAX_BUFFER,
    exec: options.exec,
  });
  if (!Array.isArray(parsed.json)) {
    throw Object.assign(new Error('GitHub API returned unreadable pull request commits'), {
      httpStatus: parsed.status,
      body: parsed.body,
    });
  }
  return parsed.json;
}

export function fetchPrCommitsWithApi({
  repo,
  prNumber,
  token,
  api = ghApi,
  perPage = 100,
} = {}) {
  const payload = api(repo, token, `pulls/${prNumber}/commits?per_page=${perPage}`, { paginate: true });
  const commits = commitsFromGhPages(payload);
  if (commits.length >= PR_COMMITS_CAP) {
    throw Object.assign(new Error(commitCapLine(commits.length)), { commitCapExceeded: true });
  }
  return commits;
}

function sleepSeconds(seconds) {
  execFileSync('sleep', [String(seconds)], { windowsHide: true });
}

// One rate-limit budget for the whole job. The commits list is one paginated call; the budget still
// bounds any retry waits so they cannot outlast the 15-minute job.
export function createEmailCheckApi({
  budgetSeconds = COMMIT_EMAIL_WAIT_SECONDS,
  now = Date.now,
  request = defaultCommitRequest,
  sleep = sleepSeconds,
  fetchRateLimit,
  random,
  log,
} = {}) {
  const startedAt = now();
  return function emailCheckApi(repo, token, requestPath, options = {}) {
    const remaining = budgetSeconds - (now() - startedAt) / 1000;
    if (remaining < 1) {
      throw Object.assign(new Error(`rate-limit wait budget of ${budgetSeconds}s used up before ${requestPath}`), {
        budgetExhausted: true,
      });
    }
    return withRateLimitRetry(() => request(repo, token, requestPath, options), {
      sleep,
      now,
      startedAt,
      budgetSeconds,
      maxRetries: Number.POSITIVE_INFINITY,
      fetchRateLimit: fetchRateLimit ?? (() => fetchGitHubRateLimit(token)),
      random,
      log,
    });
  };
}

export function classifyFetchError(error) {
  if (error?.commitCapExceeded) {
    return { exitCode: 1, conclusion: 'failure' };
  }
  if (error?.budgetExhausted || isRateLimitError(error)) {
    return { exitCode: 2, conclusion: 'failure' };
  }
  return { exitCode: 1, conclusion: 'failure' };
}

export function apiFailureLine(error, prNumber) {
  if (error?.commitCapExceeded) return error.message;
  if (error?.budgetExhausted || isRateLimitError(error)) {
    return RATE_LIMIT_RERUN_LINE;
  }
  const status = httpStatusOf(error);
  const label = status ? `HTTP ${status}` : 'error (no HTTP status)';
  let why = 'not retried (not a rate limit or a transient error)';
  if (isTransientGitHubError(error)) why = 'retried with backoff, then gave up';
  return `GitHub API ${label} while reading commits for PR #${prNumber}; ${why}.`;
}

export function runCommitEmailCheck({ repo, prNumber, token, api = createEmailCheckApi() }) {
  let commits;
  try {
    commits = fetchPrCommitsWithApi({ repo, prNumber, token, api });
  } catch (error) {
    const classified = classifyFetchError(error);
    return { ...classified, lines: [apiFailureLine(error, prNumber)] };
  }
  const failures = evaluateCommits(commits);
  if (failures.length === 0) {
    return {
      exitCode: 0,
      conclusion: 'success',
      lines: [`Checked ${commits.length} commit(s); all in-scope addresses are allowed.`],
    };
  }
  return { exitCode: 1, conclusion: 'failure', lines: [formatReport(failures)] };
}

function emailFromTrailerValue(value) {
  const angled = /<([^<>]+)>/.exec(value);
  if (angled) return angled[1].trim();
  const token = String(value ?? '').trim();
  return token.includes('@') ? token : '';
}

function domainOf(email) {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1);
}

function shortSha(sha) {
  const value = String(sha ?? '');
  return value.length > 7 ? value.slice(0, 7) : value || 'unknown';
}

async function main() {
  const repo = process.env.REPO || process.env.GITHUB_REPOSITORY;
  const prNumber = process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!repo || !prNumber || !token) {
    console.error('Set REPO, PR_NUMBER and GITHUB_TOKEN.');
    process.exitCode = 1;
    return;
  }
  const result = runCommitEmailCheck({ repo, prNumber, token });
  for (const line of result.lines) {
    if (result.exitCode === 0) console.log(line);
    else console.error(line);
  }
  process.exitCode = result.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
