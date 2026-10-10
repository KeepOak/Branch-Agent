#!/usr/bin/env node
// Event-driven gate recheck, with one API call per event. It runs on a content check's completion and on a
// merge gate's own completion. A gate is rerun only when every other check on the head has finished and passed,
// so the last event to land always decides. A gate attempt that was itself a rerun is never rerun again.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const GATE_NAMES = ['Merge gate', 'Merge gate trusted'];
const ORDINARY_GATE = 'Merge gate';
const TRUSTED_GATE = 'Merge gate trusted';
// The recheck workflow's own runs are not content: an in-progress recheck must never hold a gate back.
export const RECHECK_NAME = 'Merge gate recheck';
const PASS = new Set(['success', 'skipped', 'neutral']);

// runs: every run on the head, as { id, workflowName, status, conclusion, createdAt }.
export function summarizeRuns(runs) {
  const gates = Object.fromEntries(GATE_NAMES.map((name) => {
    const named = runs.filter((run) => run.workflowName === name)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return [name, named[0] ?? null];
  }));
  // Only the newest run per workflow counts: a cancelled or failed older run is superseded by its rerun or its replacement.
  const newest = new Map();
  for (const run of runs) {
    if (GATE_NAMES.includes(run.workflowName) || run.workflowName === RECHECK_NAME) continue;
    const current = newest.get(run.workflowName);
    if (!current || String(run.createdAt).localeCompare(String(current.createdAt)) > 0) newest.set(run.workflowName, run);
  }
  const content = [...newest.values()];
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

function listRuns(repo, sha) {
  const out = execFileSync('gh', ['run', 'list', '-R', repo, '--commit', sha, '--limit', '200',
    '--json', 'databaseId,workflowName,status,conclusion,createdAt'], { encoding: 'utf8', env: process.env });
  return JSON.parse(out || '[]').map((run) => ({
    id: run.databaseId, workflowName: run.workflowName, status: run.status, conclusion: run.conclusion, createdAt: run.createdAt,
  }));
}

// Returns the exit code. A failed run listing reports "Attribution lookup failed" instead of crashing.
export function runRecheck({
  repo, sha, trigger, currentRunId, list = listRuns, rerun = rerunGate, log = console.log, error = console.error,
}) {
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
  execFileSync('gh', ['run', 'rerun', String(id), '-R', repo], { stdio: 'inherit', env: process.env });
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
