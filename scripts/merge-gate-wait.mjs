// Wait logic for .github/workflows/merge-gate.yml `wait-for-checks`.
// Check jobs stay under 15 minutes. This waiter is the documented exception.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Jobs this waiter must not block on:
// - This workflow's own jobs, so the poll cannot wait on itself.
// - Jobs that only post PR comments. Visual tour `comment` writes the screenshot
//   grid (`continue-on-error: true`, "must never block a merge"). Waiting on it
//   timed out merge-gate after tour already passed (#490 at 12322df).
export const ignoredCheckNames = [
  'merge-gate',
  'wait-for-checks',
  'changed-test-coverage',
  'comment',
];

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

export function relevantChecks(checkRuns) {
  return parseCheckRuns(checkRuns).filter((run) => !ignoredCheckNames.includes(run.name));
}

export function classifyChecks(checkRuns) {
  const relevant = relevantChecks(checkRuns);
  const pending = relevant.filter((run) => run.status !== 'completed');
  const failed = relevant.filter((run) =>
    run.status === 'completed' && !okConclusions.has(run.conclusion));
  return { relevant, pending, failed };
}

export function evaluateChecks(checkRuns) {
  const { relevant, pending, failed } = classifyChecks(checkRuns);
  if (failed.length) return { status: 'failed', relevant, pending, failed };
  if (pending.length) return { status: 'waiting', relevant, pending, failed };
  return { status: 'ok', relevant, pending, failed };
}

export function timeoutMessage(pending) {
  const names = [...new Set((pending ?? []).map((run) => run.name).filter(Boolean))].sort();
  const waitingOn = names.length ? names.join(', ') : '(no named pending check)';
  return `Timed out waiting for: ${waitingOn}. Re-run the merge-gate workflow on this commit; do not merge main just to get a fresh run.`;
}

export function waitLoopBudgetSeconds() {
  return initialSleepSeconds + waitAttempts * pollSeconds;
}

function printEvaluate(result) {
  const lines = [result.status];
  if (result.status === 'failed') {
    for (const run of result.failed) lines.push(`${run.name}: ${run.conclusion}`);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const text = await readStdin();
  const payload = JSON.parse(text);
  const result = evaluateChecks(payload);
  if (command === 'timeout-message') {
    process.stdout.write(`${timeoutMessage(result.pending)}\n`);
    process.exit(1);
  }
  if (command !== 'evaluate') {
    console.error('usage: merge-gate-wait.mjs evaluate | timeout-message < check-runs.json');
    process.exit(2);
  }
  printEvaluate(result);
  if (result.status === 'failed') process.exit(2);
  if (result.status === 'waiting') process.exit(3);
}
