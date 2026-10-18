#!/usr/bin/env node
// Event-driven gate recheck, with one API call per event. It runs on a content check's completion and on a
// merge gate's own completion. A gate is rerun only when every other check on the head has finished and passed,
// so the last event to land always decides. A gate attempt that was itself a rerun is never rerun again.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { withRateLimitRetry } from './merge-gate-rate-limit.mjs';

export const GATE_NAMES = ['Merge gate', 'Merge gate trusted'];
const ORDINARY_GATE = 'Merge gate';
const TRUSTED_GATE = 'Merge gate trusted';
// The recheck workflow's own runs are not content: an in-progress recheck must never hold a gate back.
export const RECHECK_NAME = 'Merge gate recheck';
const PASS = new Set(['success', 'skipped', 'neutral']);
// Shared by every gh call in this process. Fits inside the 15-minute job after the 30s settle.
export const RECHECK_RATE_LIMIT_BUDGET_SECONDS = 600;

const jobBudget = { startedAt: null };

function sleepSeconds(seconds) {
  execFileSync('sleep', [String(seconds)], { windowsHide: true });
}

// Rate limits (403/429) wait and retry. Other errors fail immediately, same as before.
export function runGh(args, env = process.env, {
  exec = execFileSync,
  sleep = sleepSeconds,
  now = Date.now,
  budget = jobBudget,
  budgetSeconds = Number(env.MERGE_GATE_API_WAIT_SECONDS) || RECHECK_RATE_LIMIT_BUDGET_SECONDS,
  log,
} = {}) {
  budget.startedAt ??= now();
  return withRateLimitRetry(() => exec('gh', args, {
    encoding: 'utf8',
    windowsHide: true,
    env,
  }), {
    sleep,
    now,
    startedAt: budget.startedAt,
    budgetSeconds,
    log,
  });
}

function isCancelledRun(run) {
  return run?.status === 'completed' && run.conclusion === 'cancelled';
}

// Newest non-cancelled run wins. A cancelled run is pending, not failed, when
// another run of the same workflow exists or is queued. Cancelled-only still
// counts as a failure, same as merge-gate and merge-gate-trusted.
function newestRelevant(runs) {
  const active = runs.filter((run) => !isCancelledRun(run));
  const pool = active.length ? active : runs;
  return [...pool].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

// runs: every run on the head, as { id, workflowName, status, conclusion, createdAt }.
export function summarizeRuns(runs) {
  const gates = Object.fromEntries(GATE_NAMES.map((name) => (
    [name, newestRelevant(runs.filter((run) => run.workflowName === name))]
  )));
  const byWorkflow = new Map();
  for (const run of runs) {
    if (GATE_NAMES.includes(run.workflowName) || run.workflowName === RECHECK_NAME) continue;
    const named = byWorkflow.get(run.workflowName);
    if (named) named.push(run);
    else byWorkflow.set(run.workflowName, [run]);
  }
  const content = [...byWorkflow.values()].map((named) => newestRelevant(named)).filter(Boolean);
  return {
    gates,
    contentPending: content.some((run) => run.status !== 'completed'),
    contentFailed: content.some((run) => run.status === 'completed' && !PASS.has(run.conclusion)),
  };
}

// trigger: { kind: 'content' | 'gate', conclusion, attempt, name }.
// The attempt guard is scoped to the gate that triggered the event. Each gate reruns at most once, and the
// trusted gate waits for the ordinary gate to pass first, so the two reruns cannot race each other.
export function recheckPlan({ trigger, runs }) {
  const state = summarizeRuns(runs);
  const skipAll = (reason) => GATE_NAMES.map((name) => ({ gate: name, action: 'skip', reason }));
  if (trigger.kind === 'content') {
    if (trigger.conclusion !== 'success') return skipAll('the triggering check did not succeed');
  } else if (trigger.kind === 'gate') {
    if (!trigger.name && trigger.attempt >= 2) return skipAll('a rerun of a gate is not rerun again');
  } else {
    return skipAll('unknown trigger');
  }
  const isRerunOfTrigger = (name) => trigger.kind === 'gate' && trigger.name === name && trigger.attempt >= 2;
  return GATE_NAMES.map((name) => {
    const run = state.gates[name];
    if (!run) return { gate: name, action: 'skip', reason: 'no run for this commit' };
    if (run.status !== 'completed') return { gate: name, action: 'wait', reason: `running (${run.status}); its completion triggers a recheck`, id: run.id };
    if (run.conclusion === 'success') return { gate: name, action: 'skip', reason: 'already passed', id: run.id };
    if (isRerunOfTrigger(name)) return { gate: name, action: 'skip', reason: 'this gate attempt was itself a rerun', id: run.id };
    if (state.contentPending) return { gate: name, action: 'wait', reason: 'other checks still running; the last one to finish decides', id: run.id };
    if (state.contentFailed) return { gate: name, action: 'skip', reason: 'a check failed; the commit is red', id: run.id };
    if (name === TRUSTED_GATE) {
      const ordinary = state.gates[ORDINARY_GATE];
      if (ordinary?.status !== 'completed' || ordinary.conclusion !== 'success') {
        return { gate: name, action: 'wait', reason: 'waits for Merge gate to pass; its completion triggers this recheck', id: run.id };
      }
    }
    return { gate: name, action: 'rerun', reason: `ended ${run.conclusion} with every other check passed`, id: run.id };
  });
}

// Decided from the trigger alone, so no listing is needed. Same outcome recheckPlan gives for these cases.
export function triggerSkipReason(trigger) {
  if (trigger.kind === 'content') return trigger.conclusion !== 'success' ? 'the triggering check did not succeed' : null;
  if (trigger.kind === 'gate') return !trigger.name && trigger.attempt >= 2 ? 'a rerun of a gate is not rerun again' : null;
  return 'unknown trigger';
}

function listRuns(repo, sha) {
  const out = runGh(['run', 'list', '-R', repo, '--commit', sha, '--limit', '200',
    '--json', 'databaseId,workflowName,status,conclusion,createdAt'], process.env, { log: console.log });
  return JSON.parse(out || '[]').map((run) => ({
    id: run.databaseId, workflowName: run.workflowName, status: run.status, conclusion: run.conclusion, createdAt: run.createdAt,
  }));
}

// Returns the exit code. A failed run listing reports "Attribution lookup failed" instead of crashing.
export function runRecheck({
  repo, sha, trigger, currentRunId, list = listRuns, rerun = rerunGate, log = console.log, error = console.error,
}) {
  const skipReason = triggerSkipReason(trigger);
  if (skipReason) {
    for (const gate of GATE_NAMES) log(`${gate}: skip (${skipReason})`);
    return 0;
  }
  let plan;
  try {
    const runs = list(repo, sha).filter((run) => String(run.id) !== String(currentRunId ?? ''));
    plan = recheckPlan({ trigger, runs });
  } catch (err) {
    error(`Attribution lookup failed: could not list the runs for ${sha}: ${String(err?.message ?? err).split('\n')[0]}`);
    return 1;
  }
  for (const step of plan) {
    log(`${step.gate}: ${step.action} (${step.reason})`);
    if (step.action === 'rerun') rerun(repo, step.id);
  }
  return 0;
}

function rerunGate(repo, id) {
  runGh(['run', 'rerun', String(id), '-R', repo], process.env, { log: console.log });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repo = process.env.REPO;
  const sha = process.env.SHA;
  if (!repo || !sha) throw new Error('Set REPO and SHA');
  const trigger = {
    kind: process.env.TRIGGER_KIND,
    conclusion: process.env.TRIGGER_CONCLUSION,
    attempt: Number(process.env.TRIGGER_ATTEMPT ?? 1),
    name: process.env.TRIGGER_NAME,
  };
  process.exitCode = runRecheck({ repo, sha, trigger, currentRunId: process.env.GITHUB_RUN_ID });
}
