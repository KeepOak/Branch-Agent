// Fail pull request commits dated at or after the cutoff whose author, committer,
// or Co-authored-by address is not a GitHub noreply or cursoragent@cursor.com.
// The report never prints a full personal email; only a short SHA, field, and masked domain.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ghApi } from './merge-gate-trusted.mjs';

export const CUTOFF_ISO = '2026-10-08T04:05:00Z';
export const CUTOFF_MS = Date.parse(CUTOFF_ISO);
export const ALLOWED_EXACT = new Set(['noreply@github.com', 'cursoragent@cursor.com']);
export const ALLOWED_SUFFIX = '@users.noreply.github.com';
export const FIX_LINES = [
  'Cloud agents: end the commit message with `Co-authored-by: Taofik Bishi <189563683+stabrea@users.noreply.github.com>`. Others: set git user.email to a GitHub noreply address. Add a new commit; don\'t force-push.',
  'if this commit is already pushed, open a fresh branch from main with clean commits',
];

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

export function nextLink(linkHeader) {
  if (!linkHeader) return null;
  const match = /<([^>]+)>\s*;\s*rel="next"/i.exec(linkHeader);
  return match?.[1] ?? null;
}

export function commitsFromGhPages(payload) {
  if (!Array.isArray(payload)) return [];
  if (payload.every((item) => item && typeof item.sha === 'string')) return payload;
  return payload.flatMap((page) => (Array.isArray(page) ? page : []));
}

export function fetchPrCommitsWithApi({
  repo,
  prNumber,
  token,
  api = ghApi,
  perPage = 100,
} = {}) {
  const payload = api(repo, token, `pulls/${prNumber}/commits?per_page=${perPage}`, { paginate: true });
  return commitsFromGhPages(payload);
}

export async function fetchPrCommits({
  repo,
  prNumber,
  token,
  api,
  fetchImpl = globalThis.fetch,
  perPage = 100,
} = {}) {
  if (typeof api === 'function') {
    return fetchPrCommitsWithApi({ repo, prNumber, token, api, perPage });
  }
  const commits = [];
  let url = `https://api.github.com/repos/${repo}/pulls/${prNumber}/commits?per_page=${perPage}`;
  while (url) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'branch-commit-email-check',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} while reading pull request commits`);
    }
    const page = await response.json();
    if (!Array.isArray(page)) {
      throw new Error('GitHub API returned a non-array commit list');
    }
    commits.push(...page);
    url = nextLink(typeof response.headers?.get === 'function'
      ? response.headers.get('link')
      : null);
  }
  return commits;
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
    process.exitCode = 2;
    return;
  }
  const commits = fetchPrCommitsWithApi({ repo, prNumber, token });
  const failures = evaluateCommits(commits);
  if (failures.length === 0) {
    console.log(`Checked ${commits.length} commit(s); all in-scope addresses are allowed.`);
    return;
  }
  console.error(formatReport(failures));
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
