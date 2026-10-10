#!/usr/bin/env node
// Event-driven gate recheck. A content check finished successfully on a PR head, so rerun each merge gate
// for that head that ended unsuccessfully. A gate still running will see the result itself, so it is left alone.
// Replaces the older rerun of merge-gate alone, which left a trusted gate that failed early stuck until a person reran it.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RECHECKED_GATES = [
  { workflow: 'merge-gate.yml' },
  { workflow: 'merge-gate-trusted.yml' },
];

// runs: the latest run of each gate for the head, as { workflow, id, status, conclusion } (missing when absent).
export function recheckPlan({ triggerConclusion, runs }) {
  if (triggerConclusion !== 'success') {
    return RECHECKED_GATES.map(({ workflow }) => ({ workflow, action: 'skip', reason: 'the triggering check did not succeed' }));
  }
  return RECHECKED_GATES.map(({ workflow }) => {
    const run = runs.find((item) => item.workflow === workflow);
    if (!run) return { workflow, action: 'skip', reason: 'no run for this commit' };
    if (run.status !== 'completed') return { workflow, action: 'wait', reason: `running (${run.status}); it will see the result`, id: run.id };
    if (run.conclusion === 'success') return { workflow, action: 'skip', reason: 'already passed', id: run.id };
    return { workflow, action: 'rerun', reason: `ended ${run.conclusion}`, id: run.id };
  });
}

function latestRun(repo, workflow, sha) {
  const out = execFileSync('gh', ['run', 'list', '-R', repo, '--workflow', workflow, '--commit', sha, '--limit', '1',
    '--json', 'databaseId,status,conclusion'], { encoding: 'utf8', env: process.env });
  const item = JSON.parse(out || '[]')[0];
  return item ? { workflow, id: item.databaseId, status: item.status, conclusion: item.conclusion } : { workflow };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const repo = process.env.REPO;
  const sha = process.env.SHA;
  const triggerConclusion = process.env.TRIGGER_CONCLUSION;
  if (!repo || !sha) throw new Error('Set REPO and SHA');
  const runs = RECHECKED_GATES.map(({ workflow }) => latestRun(repo, workflow, sha));
  for (const step of recheckPlan({ triggerConclusion, runs })) {
    console.log(`${step.workflow}: ${step.action} (${step.reason})`);
    if (step.action === 'rerun') execFileSync('gh', ['run', 'rerun', String(step.id), '-R', repo], { stdio: 'inherit', env: process.env });
  }
}
