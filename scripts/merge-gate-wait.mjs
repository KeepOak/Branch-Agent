// Wait logic for .github/workflows/merge-gate.yml `wait-for-checks`.
// Check jobs stay under 15 minutes. This waiter is the documented exception.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This workflow's own jobs. Ignored by name so the poll cannot wait on itself.
export const ownCheckNames = [
  'merge-gate',
  'wait-for-checks',
  'changed-test-coverage',
];

// Visual tour `comment` only posts the screenshot grid (`continue-on-error: true`,
// "must never block a merge"). Waiting on it timed out merge-gate after tour
// already passed (#490 at 12322df). Skip that job only when the check run
// resolves to the visual-tour workflow. Check-run objects have no workflow path,
// so resolution goes through details_url / check_suite.id. If that fails, do
// not skip (fail closed): a job named `comment` in any other workflow still gates.
export const commentJobName = 'comment';
export const visualTourWorkflowPath = '.github/workflows/visual-tour.yml';
export const visualTourWorkflowName = 'Visual tour';

// 30s for path-filtered workflows to register, then 345 × 10s ≈ 58 minutes.
// Job timeout is 60 minutes so this message can print before GitHub kills the job.
// 35 minutes was not enough under today's queue (#489 at 897f45f61, #490 at 12322df).
export const initialSleepSeconds = 30;
export const pollSeconds = 10;
export const waitAttempts = 345;
export const timeoutMinutes = 60;

const okConclusions = new Set(['success', 'skipped', 'neutral']);

export function parseCheckRuns(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.check_runs)) return payload.check_runs;
  throw new Error('expected check-runs array or { check_runs: [...] }');
}

export function mergeCheckRunPages(payload) {
  const pages = normalizePages(payload);
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

function normalizePages(payload) {
  if (payload == null) return [];
  if (Array.isArray(payload)) {
    if (payload.length === 0) return payload;
    if (payload.every((item) => item && (Array.isArray(item.check_runs) || Number.isInteger(item.total_count)))) {
      return payload;
    }
    if (payload.every((item) => item && typeof item.name === 'string')) return [{ check_runs: payload, total_count: payload.length }];
    return payload;
  }
  if (payload.check_runs || Number.isInteger(payload.total_count)) return [payload];
  throw new Error('expected check-runs pages, { check_runs, total_count }, or a check-run array');
}

export function workflowRunIdFromCheckRun(checkRun) {
  const fromUrl = String(checkRun?.details_url ?? checkRun?.html_url ?? '').match(/\/actions\/runs\/(\d+)/);
  return fromUrl ? fromUrl[1] : null;
}

export function isVisualTourWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object') return false;
  const workflowPath = String(workflow.path ?? '');
  const workflowName = String(workflow.name ?? '');
  return workflowPath === visualTourWorkflowPath || workflowName === visualTourWorkflowName;
}

export function shouldIgnoreCheck(checkRun, workflow) {
  if (ownCheckNames.includes(checkRun.name)) return true;
  if (checkRun.name !== commentJobName) return false;
  return isVisualTourWorkflow(workflow);
}

export function relevantChecks(checkRuns, workflowsByCheckId = {}) {
  return parseCheckRuns(checkRuns).filter((run) => {
    const workflow = run.workflow ?? workflowsByCheckId[run.id] ?? null;
    return !shouldIgnoreCheck(run, workflow);
  });
}

export function classifyChecks(checkRuns, workflowsByCheckId = {}) {
  const relevant = relevantChecks(checkRuns, workflowsByCheckId);
  const pending = relevant.filter((run) => run.status !== 'completed');
  const failed = relevant.filter((run) =>
    run.status === 'completed' && !okConclusions.has(run.conclusion));
  return { relevant, pending, failed };
}

export function evaluateChecks(payload, options = {}) {
  const merged = options.checkRuns
    ? { checkRuns: options.checkRuns, totalCount: options.totalCount ?? options.checkRuns.length, complete: true }
    : mergeCheckRunPages(payload);
  const collectedCount = merged.checkRuns.length;
  const totalCount = options.totalCount ?? merged.totalCount;
  if (collectedCount < totalCount || merged.complete === false) {
    return {
      status: 'incomplete',
      relevant: [],
      pending: [],
      failed: [],
      collectedCount,
      totalCount,
    };
  }
  const resolveWorkflow = options.resolveWorkflow;
  const workflowsByCheckId = { ...options.workflowsByCheckId };
  for (const run of merged.checkRuns) {
    if (run.workflow) workflowsByCheckId[run.id] = run.workflow;
    else if (run.name === commentJobName && resolveWorkflow && workflowsByCheckId[run.id] === undefined) {
      try {
        workflowsByCheckId[run.id] = resolveWorkflow(run) ?? null;
      } catch {
        workflowsByCheckId[run.id] = null;
      }
    }
  }
  const { relevant, pending, failed } = classifyChecks(merged.checkRuns, workflowsByCheckId);
  if (failed.length) return { status: 'failed', relevant, pending, failed, collectedCount, totalCount };
  if (pending.length) return { status: 'waiting', relevant, pending, failed, collectedCount, totalCount };
  // Coverage runs in parallel with this waiter. An empty relevant set right after
  // the 30s start means other workflows have not registered yet — keep waiting.
  if (relevant.length === 0) {
    return { status: 'waiting', relevant, pending, failed, collectedCount, totalCount };
  }
  return { status: 'ok', relevant, pending, failed, collectedCount, totalCount };
}

export function timeoutMessage(pending, extra = {}) {
  if (extra.incomplete) {
    return `Timed out waiting for checks; collected ${extra.collectedCount} of ${extra.totalCount} check runs. Re-run the merge-gate workflow on this commit; do not merge main just to get a fresh run.`;
  }
  const names = [...new Set((pending ?? []).map((run) => run.name).filter(Boolean))].sort();
  const waitingOn = names.length ? names.join(', ') : '(no named pending check)';
  return `Timed out waiting for: ${waitingOn}. Re-run the merge-gate workflow on this commit; do not merge main just to get a fresh run.`;
}

export function waitLoopBudgetSeconds() {
  return initialSleepSeconds + waitAttempts * pollSeconds;
}

export function ghApi(repo, token, requestPath, { paginate = false, slurp = false } = {}) {
  const args = ['api', `repos/${repo}/${requestPath}`, '-H', 'Accept: application/vnd.github+json'];
  if (paginate) args.splice(1, 0, '--paginate');
  if (slurp) args.splice(1, 0, '--slurp');
  const result = execFileSync('gh', args, {
    env: { ...process.env, GH_TOKEN: token },
    encoding: 'utf8',
    windowsHide: true,
  });
  return result ? JSON.parse(result) : null;
}

export function fetchCheckRunPages(repo, sha, token, api = ghApi) {
  const payload = api(repo, token, `commits/${sha}/check-runs?per_page=100`, { paginate: true, slurp: true });
  return Array.isArray(payload) ? payload : [payload];
}

export function workflowFromActionsRun(run) {
  if (!run) return null;
  return {
    path: run.path ?? null,
    name: run.name ?? null,
    id: run.id ?? null,
  };
}

export function resolveWorkflowForCheckRun(repo, token, checkRun, api = ghApi) {
  const runId = workflowRunIdFromCheckRun(checkRun);
  if (runId) return workflowFromActionsRun(api(repo, token, `actions/runs/${runId}`));
  const suiteId = checkRun.check_suite?.id;
  if (!suiteId) return null;
  const payload = api(repo, token, `actions/runs?check_suite_id=${suiteId}&per_page=1`);
  return workflowFromActionsRun(payload?.workflow_runs?.[0]);
}

function printEvaluate(result) {
  const lines = [result.status];
  if (result.status === 'failed') {
    for (const run of result.failed) lines.push(`${run.name}: ${run.conclusion}`);
  } else if (result.status === 'incomplete') {
    lines.push(String(result.collectedCount));
    lines.push(String(result.totalCount));
  } else if (result.status === 'waiting') {
    lines.push(String(result.pending.length));
    for (const run of result.pending) lines.push(run.name);
  } else {
    lines.push(String(result.relevant.length));
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

function liveEvaluate() {
  const repo = process.env.REPO;
  const sha = process.env.SHA;
  const token = process.env.GH_TOKEN;
  const pages = fetchCheckRunPages(repo, sha, token);
  return evaluateChecks(pages, {
    resolveWorkflow: (run) => resolveWorkflowForCheckRun(repo, token, run),
  });
}

function exitFor(result) {
  if (result.status === 'failed') process.exit(2);
  if (result.status === 'waiting' || result.status === 'incomplete') process.exit(3);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'fetch-evaluate') {
    const result = liveEvaluate();
    printEvaluate(result);
    exitFor(result);
  } else if (command === 'timeout') {
    const result = liveEvaluate();
    process.stdout.write(`${timeoutMessage(result.pending, {
      incomplete: result.status === 'incomplete',
      collectedCount: result.collectedCount,
      totalCount: result.totalCount,
    })}\n`);
    process.exit(1);
  } else {
    const text = await readStdin();
    const payload = JSON.parse(text);
    const result = evaluateChecks(payload);
    if (command === 'timeout-message') {
      process.stdout.write(`${timeoutMessage(result.pending, {
        incomplete: result.status === 'incomplete',
        collectedCount: result.collectedCount,
        totalCount: result.totalCount,
      })}\n`);
      process.exit(1);
    }
    if (command !== 'evaluate') {
      console.error('usage: merge-gate-wait.mjs evaluate | timeout-message | fetch-evaluate | timeout');
      process.exit(2);
    }
    printEvaluate(result);
    exitFor(result);
  }
}
