// Detect a squash or rebase PR landing on main (one parent + associated PR).
// Dry-run: node scripts/detect-non-merge-commit.mjs --dry-run
// Apply (default): open or update one tracking issue. Never revert.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GH_API_MAX_BUFFER, withRateLimitRetry } from './merge-gate-rate-limit.mjs';

// The job has a 5-minute limit, so a rate-limit wait must end well before it.
export const GH_RATE_LIMIT_BUDGET_SECONDS = 180;

export const TRACKING_ISSUE_TITLE = 'Non-merge-commit landing on main';

export const ISSUE_INTRO = [
  'A pull request reached main as a squash or rebase (the new head has one parent).',
  'This workflow does not revert the landing.',
  '',
  'The PR Closer merges by hand as a merge commit pinned to the reviewed head SHA.',
  '',
  '## Landings',
  '',
].join('\n');

export function parseArgs(argv, env = process.env) {
  const parsed = {
    dryRun: false,
    sha: env.SHA || env.GITHUB_SHA || '',
    repo: env.REPO || env.GITHUB_REPOSITORY || '',
    serverUrl: env.GITHUB_SERVER_URL || 'https://github.com',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--sha') parsed.sha = argv[++i] || '';
    else if (arg === '--repo') parsed.repo = argv[++i] || '';
    else if (arg === '--server-url') parsed.serverUrl = argv[++i] || parsed.serverUrl;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

export function parentCount(commit) {
  return Array.isArray(commit?.parents) ? commit.parents.length : 0;
}

export function associatedPulls(pulls) {
  if (!Array.isArray(pulls)) return [];
  return pulls.flatMap((pull) => {
    const number = Number(pull?.number);
    if (!Number.isInteger(number) || number <= 0) return [];
    const url = typeof pull.html_url === 'string' ? pull.html_url
      : typeof pull.url === 'string' && pull.url.includes('/pull/') ? pull.url
        : '';
    return [{ number, url }];
  });
}

export function shouldTrackLanding({ parents, pulls }) {
  return parentCount({ parents }) === 1 && associatedPulls(pulls).length > 0;
}

export function formatLandingLine({ sha, pulls, repo, serverUrl = 'https://github.com' }) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error('landing requires a commit SHA');
  }
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('landing requires owner/repo');
  }
  const commitUrl = `${serverUrl.replace(/\/$/, '')}/${repo}/commit/${sha}`;
  const listed = associatedPulls(pulls).map((pull) => {
    const url = pull.url || `${serverUrl.replace(/\/$/, '')}/${repo}/pull/${pull.number}`;
    return `#${pull.number} ${url}`;
  }).join(', ');
  return listed ? `- ${sha} ${commitUrl} ${listed}` : `- ${sha} ${commitUrl}`;
}

export function buildIssueBody(landing, opts) {
  return `${ISSUE_INTRO}${formatLandingLine(landing, opts)}\n`;
}

export function upsertIssueBody(existingBody, landing, opts) {
  const body = typeof existingBody === 'string' ? existingBody : '';
  if (body.includes(landing.sha)) return { body, changed: false };
  const prefix = body.includes('## Landings') ? body.trimEnd() : `${ISSUE_INTRO.trimEnd()}\n${body.trim()}`.trimEnd();
  return { body: `${prefix}\n${formatLandingLine(landing, opts)}\n`, changed: true };
}

export function findTrackingIssue(issues, title = TRACKING_ISSUE_TITLE) {
  if (!Array.isArray(issues)) return null;
  return issues.find((issue) => issue?.title === title) ?? null;
}

export function nextIssueAction(existing, landing, opts) {
  if (!landing?.shouldTrack) return { action: 'none' };
  if (!existing) {
    return { action: 'create', title: TRACKING_ISSUE_TITLE, body: buildIssueBody(landing, opts) };
  }
  const { body, changed } = upsertIssueBody(existing.body, landing, opts);
  if (!changed) return { action: 'none', number: existing.number };
  const closed = String(existing.state || '').toLowerCase() === 'closed';
  if (closed) return { action: 'reopen-and-update', number: existing.number, body };
  return { action: 'update', number: existing.number, body };
}

export function inspectLanding({ sha, repo, commit, pulls, serverUrl }) {
  const pullsList = associatedPulls(pulls);
  return {
    sha,
    repo,
    serverUrl,
    parentCount: parentCount(commit),
    pulls: pullsList,
    shouldTrack: shouldTrackLanding({ parents: commit?.parents, pulls }),
  };
}

// A landing commit's JSON carries every changed patch, so the default 1 MiB execFileSync buffer
// overflows (spawnSync gh ENOBUFS). Rate limits are waited out inside one budget for the whole job,
// shared by every gh call, so several rate-limited calls cannot add up past the job's limit.
const jobBudget = { startedAt: null };

export function runGh(args, env = process.env, {
  exec = execFileSync,
  sleep = (seconds) => execFileSync('sleep', [String(seconds)], { windowsHide: true }),
  now = Date.now,
  budget = jobBudget,
} = {}) {
  budget.startedAt ??= now();
  return withRateLimitRetry(() => exec('gh', args, {
    encoding: 'utf8',
    windowsHide: true,
    env,
    maxBuffer: GH_API_MAX_BUFFER,
  }), { sleep, now, startedAt: budget.startedAt, budgetSeconds: GH_RATE_LIMIT_BUDGET_SECONDS });
}

function readJson(stdout) {
  const text = String(stdout ?? '').trim();
  return text ? JSON.parse(text) : null;
}

export function fetchCommit(repo, sha, env) {
  return readJson(runGh(['api', `repos/${repo}/commits/${sha}`], env));
}

export function fetchAssociatedPulls(repo, sha, env) {
  const pulls = readJson(runGh(['api', `repos/${repo}/commits/${sha}/pulls`], env));
  return Array.isArray(pulls) ? pulls : [];
}

export function fetchTrackingIssues(repo, env) {
  const query = `in:title "${TRACKING_ISSUE_TITLE}"`;
  const issues = readJson(runGh([
    'issue', 'list', '--repo', repo, '--state', 'all', '--limit', '20',
    '--search', query, '--json', 'number,title,body,state,url',
  ], env));
  return Array.isArray(issues) ? issues : [];
}

export function applyIssueAction(repo, action, env) {
  if (action.action === 'none') return action;
  if (action.action === 'create') {
    const url = runGh([
      'issue', 'create', '--repo', repo, '--title', action.title, '--body', action.body,
    ], env).trim();
    return { ...action, url };
  }
  if (action.action === 'reopen-and-update') {
    runGh(['issue', 'reopen', String(action.number), '--repo', repo], env);
    runGh(['issue', 'edit', String(action.number), '--repo', repo, '--body', action.body], env);
    return action;
  }
  if (action.action === 'update') {
    runGh(['issue', 'edit', String(action.number), '--repo', repo, '--body', action.body], env);
    return action;
  }
  throw new Error(`Unknown issue action: ${action.action}`);
}

export function detectAndRecord({ sha, repo, serverUrl, dryRun, env = process.env }) {
  if (!sha) throw new Error('missing commit SHA (set SHA or pass --sha)');
  if (!repo) throw new Error('missing repository (set REPO or pass --repo)');
  const commit = fetchCommit(repo, sha, env);
  const pulls = fetchAssociatedPulls(repo, sha, env);
  const landing = inspectLanding({ sha, repo, commit, pulls, serverUrl });
  if (!landing.shouldTrack) {
    return { landing, action: { action: 'none' }, dryRun };
  }
  const existing = findTrackingIssue(fetchTrackingIssues(repo, env));
  const action = nextIssueAction(existing, landing, { repo, serverUrl });
  if (!dryRun) applyIssueAction(repo, action, env);
  return { landing, action, dryRun };
}

function main(argv, env = process.env) {
  const args = parseArgs(argv, env);
  const result = detectAndRecord({ ...args, env });
  if (!result.landing.shouldTrack) {
    console.log(`ok: ${result.landing.sha} has ${result.landing.parentCount} parent(s) and ${result.landing.pulls.length} associated pull request(s); not tracking.`);
    return 0;
  }
  const mode = result.dryRun ? 'dry-run' : 'applied';
  console.log(`${mode}: ${result.action.action} tracking issue for ${result.landing.sha} (${result.landing.pulls.map((pull) => `#${pull.number}`).join(', ')})`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv);
}
