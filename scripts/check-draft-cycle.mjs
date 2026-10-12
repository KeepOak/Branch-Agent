import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gateApiBudget, ghApi } from './merge-gate-trusted.mjs';

// Check whole workflow runs, not individual skipped jobs: legitimate conditional
// jobs (release publishing, empty harvest shards) may still skip on a ready PR.
export function draftCycleFailures({ pr, sha, events, runs, jobsByRun }) {
  if (pr.draft || pr.state !== 'open' || pr.head?.sha !== sha) return ['PR is draft, closed, or no longer at this head'];
  const ready = events.filter((event) => event.event === 'ready_for_review')
    .map((event) => Date.parse(event.created_at));
  if (!ready.length) return [];
  if (ready.some((time) => !Number.isFinite(time))) return ['Invalid ready-for-review timestamp'];
  const since = Math.max(...ready);
  const latest = new Map();
  for (const run of runs) {
    if (run.event === 'pull_request' && run.head_sha === sha && !run.pull_requests?.length) {
      return ['Cannot attribute a head workflow run to its PR'];
    }
    if (run.event !== 'pull_request' || run.head_sha !== sha
      || !run.pull_requests?.some((item) => item.number === pr.number)
      || run.path === '.github/workflows/merge-gate.yml') continue;
    if (!run.path) return ['Cannot attribute a PR workflow run'];
    const previous = latest.get(run.path);
    if (!previous || run.id > previous.id) latest.set(run.path, run);
  }
  const failures = [];
  for (const [workflow, run] of latest) {
    if (!(Date.parse(run.created_at) >= since)) {
      failures.push(`${workflow}: no run since the latest ready_for_review event`);
      continue;
    }
    if (run.status !== 'completed' || run.conclusion !== 'success') {
      failures.push(`${workflow}: ${run.conclusion ?? run.status}`);
      continue;
    }
    const jobs = jobsByRun[run.id] ?? [];
    if (!jobs.length || !jobs.some((job) => job.conclusion === 'success')
      || jobs.some((job) => job.status !== 'completed'
        || !['success', 'skipped', 'neutral'].includes(job.conclusion))) {
      failures.push(`${workflow}: checks did not complete successfully (all-skipped is not coverage)`);
    }
  }
  return failures;
}

export function checkDraftCycle({ repo, token, prNumber, sha, api = ghApi }) {
  const read = (resource) => api(repo, token, resource);
  const list = (resource, key) => {
    const items = [];
    for (let page = 1; ; page += 1) {
      const payload = read(`${resource}${resource.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const entries = key ? payload?.[key] : payload;
      if (!Array.isArray(entries)) throw new Error('Invalid paginated GitHub response');
      items.push(...entries);
      if (entries.length < 100) return items;
    }
  };
  const pr = read(`pulls/${prNumber}`);
  const events = list(`issues/${prNumber}/events`);
  // The trusted gate separately requires path-matched workflows to register.
  // This guard prevents historical runs on the same SHA satisfying a new ready cycle.
  if (!events.some((event) => event.event === 'ready_for_review')) {
    return draftCycleFailures({ pr, sha, events, runs: [], jobsByRun: {} });
  }
  const runs = list(`actions/runs?head_sha=${sha}&event=pull_request`, 'workflow_runs');
  const jobsByRun = {};
  const latest = new Map();
  for (const run of runs) {
    if (run.event !== 'pull_request' || run.head_sha !== sha
      || !run.pull_requests?.some((item) => item.number === pr.number)
      || run.path === '.github/workflows/merge-gate.yml') continue;
    if (!latest.has(run.path) || latest.get(run.path).id < run.id) latest.set(run.path, run);
  }
  for (const run of latest.values()) {
    if (run.status !== 'completed' || run.conclusion !== 'success') continue;
    jobsByRun[run.id] = list(`actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
  }
  return draftCycleFailures({ pr, sha, events, runs, jobsByRun });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  gateApiBudget.budgetSeconds = 120;
  gateApiBudget.startedAt = Date.now();
  try {
    const { REPO: repo, GH_TOKEN: token, PR_NUMBER: prNumber, SHA: sha } = process.env;
    if (!repo || !token || !prNumber || !sha) throw new Error('Missing draft-cycle gate environment');
    const failures = checkDraftCycle({ repo, token, prNumber, sha });
    for (const failure of failures) console.error(failure);
    process.exitCode = failures.length ? 1 : 0;
  } catch (error) {
    console.error(`Draft-cycle check failed: ${error.message}`);
    process.exitCode = 1;
  }
}
