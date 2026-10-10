#!/usr/bin/env node
// Event-driven gate recheck, with one API call per event. It runs on a content check's completion and on a
// merge gate's own completion. A gate is rerun only when every other check on the head has finished and passed,
// so the last event to land always decides. A gate attempt that was itself a rerun is never rerun again.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const GATE_NAMES = ['Merge gate', 'Merge gate trusted'];
const PASS = new Set(['success', 'skipped', 'neutral']);

// runs: every run on the head, as { id, workflowName, status, conclusion, createdAt }.
export function summarizeRuns(runs) {
  const gates = Object.fromEntries(GATE_NAMES.map((name) => {
    const named = runs.filter((run) => run.workflowName === name)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return [name, named[0] ?? null];
  }));
  const content = runs.filter((run) => !GATE_NAMES.includes(run.workflowName));
  return {
    gates,
    contentPending: content.some((run) => run.status !== 'completed'),
    contentFailed: content.some((run) => run.status === 'completed' && !PASS.has(run.conclusion)),
  };
}

// trigger: { kind: 'content' | 'gate', conclusion, attempt, name }.
export function recheckPlan({ trigger, runs }) {
  const state = summarizeRuns(runs);
  const skipAll = (reason) => GATE_NAMES.map((name) => ({ gate: name, action: 'skip', reason }));
  if (trigger.kind === 'content') {
    if (trigger.conclusion !== 'success') return skipAll('the triggering check did not succeed');
  } else if (trigger.kind === 'gate') {
    if (trigger.attempt >= 2) return skipAll('a rerun of a gate is not rerun again');
  } else {
    return skipAll('unknown trigger');
  }
  return GATE_NAMES.map((name) => {
    const run = state.gates[name];
    if (!run) return { gate: name, action: 'skip', reason: 'no run for this commit' };
    if (run.status !== 'completed') return { gate: name, action: 'wait', reason: `running (${run.status}); its completion triggers a recheck`, id: run.id };
    if (run.conclusion === 'success') return { gate: name, action: 'skip', reason: 'already passed', id: run.id };
    if (state.contentPending) return { gate: name, action: 'wait', reason: 'other checks still running; the last one to finish decides', id: run.id };
    if (state.contentFailed) return { gate: name, action: 'skip', reason: 'a check failed; the commit is red', id: run.id };
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
  for (const step of recheckPlan({ trigger, runs: listRuns(repo, sha) })) {
    console.log(`${step.gate}: ${step.action} (${step.reason})`);
    if (step.action === 'rerun') execFileSync('gh', ['run', 'rerun', String(step.id), '-R', repo], { stdio: 'inherit', env: process.env });
  }
}
