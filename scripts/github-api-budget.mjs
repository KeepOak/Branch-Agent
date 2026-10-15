#!/usr/bin/env node
// Measures the core API budget around one CI job, so its cost is measured instead of estimated.
//   node scripts/github-api-budget.mjs before   stores a reading in $RUNNER_TEMP
//   node scripts/github-api-budget.mjs after    prints one line with the reading before and after
// GET /rate_limit does not count against the core limit. Other jobs share the same budget, so the
// delta includes their calls. This never fails a job: every error is logged and the exit code is 0.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATE_FILE = 'api-budget-before.json';

// The core bucket from a GET /rate_limit payload, or null when it is missing or malformed.
export function parseCoreRate(json) {
  const core = json?.resources?.core;
  if (!core || !Number.isFinite(core.remaining) || !Number.isFinite(core.limit)) return null;
  return {
    remaining: core.remaining,
    limit: core.limit,
    reset: Number.isFinite(core.reset) ? core.reset : null,
  };
}

// One line: the delta is only comparable inside one rate-limit window, so a reset is reported instead.
export function budgetLine(label, before, after) {
  if (!after) return `API budget ${label}: after reading unavailable`;
  if (!before) return `API budget ${label}: before reading unavailable; after=${after.remaining}/${after.limit}`;
  if (before.reset !== after.reset) {
    return `API budget ${label}: window reset during the job; before=${before.remaining} after=${after.remaining} (delta not comparable)`;
  }
  const used = before.remaining - after.remaining;
  return `API budget ${label}: before=${before.remaining} after=${after.remaining} used=${used} limit=${after.limit} `
    + '(shared window, includes concurrent jobs)';
}

export function readCoreRate(exec = execFileSync) {
  try {
    return parseCoreRate(JSON.parse(exec('gh', ['api', 'rate_limit'], { encoding: 'utf8', env: process.env })));
  } catch {
    return null;
  }
}

// The stored file holds an already-parsed reading, not a payload, so it is checked field by field.
function readStoredReading(file) {
  if (!existsSync(file)) return null;
  try {
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    if (!Number.isFinite(stored?.remaining) || !Number.isFinite(stored?.limit)) return null;
    return { remaining: stored.remaining, limit: stored.limit, reset: Number.isFinite(stored.reset) ? stored.reset : null };
  } catch {
    return null;
  }
}

// Returns the exit code, which is always 0.
export function runBudget(phase, {
  label = process.env.BUDGET_LABEL || 'job',
  dir = process.env.RUNNER_TEMP || tmpdir(),
  read = readCoreRate,
  log = console.log,
} = {}) {
  const file = path.join(dir, STATE_FILE);
  try {
    if (phase === 'before') {
      writeFileSync(file, JSON.stringify(read()));
    } else if (phase === 'after') {
      log(budgetLine(label, readStoredReading(file), read()));
    } else {
      log(`API budget ${label}: unknown phase "${phase}"`);
    }
  } catch (error) {
    log(`API budget ${label}: ${phase} failed (${String(error?.message ?? error).split('\n')[0]})`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runBudget(process.argv[2]);
}
