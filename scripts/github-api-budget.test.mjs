// node --test scripts/github-api-budget.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { STATE_FILE, budgetLine, parseCoreRate, readCoreRate, runBudget } from './github-api-budget.mjs';

const payload = (remaining, reset = 1_800_000_000) => ({
  resources: { core: { limit: 5000, remaining, reset }, search: { limit: 30, remaining: 30, reset: 1 } },
});

test('parseCoreRate reads only the core bucket and rejects malformed payloads', () => {
  assert.deepEqual(parseCoreRate(payload(4321)), { remaining: 4321, limit: 5000, reset: 1_800_000_000 });
  assert.equal(parseCoreRate({ resources: { search: { limit: 30, remaining: 1 } } }), null);
  assert.equal(parseCoreRate({ resources: { core: { limit: 5000, remaining: '12' } } }), null);
  assert.equal(parseCoreRate(null), null);
});

test('budgetLine reports the used calls inside one window and says the window is shared', () => {
  const before = parseCoreRate(payload(4000));
  const after = parseCoreRate(payload(3990));
  const line = budgetLine('merge-gate-recheck', before, after);
  assert.equal(
    line,
    'API budget merge-gate-recheck: before=4000 after=3990 used=10 limit=5000 (shared window, includes concurrent jobs)',
  );
});

test('budgetLine does not report a delta across a window reset', () => {
  const before = parseCoreRate(payload(100, 1000));
  const after = parseCoreRate(payload(4900, 4600));
  assert.match(budgetLine('job', before, after), /window reset during the job.*delta not comparable/);
  assert.doesNotMatch(budgetLine('job', before, after), /used=/);
});

test('budgetLine says which reading is missing instead of failing', () => {
  const reading = parseCoreRate(payload(10));
  assert.match(budgetLine('job', null, reading), /before reading unavailable; after=10\/5000/);
  assert.match(budgetLine('job', reading, null), /after reading unavailable/);
});

test('readCoreRate returns null when gh fails, so the job keeps going', () => {
  assert.equal(readCoreRate(() => {
    throw new Error('gh: HTTP 500');
  }), null);
  assert.deepEqual(readCoreRate(() => JSON.stringify(payload(77))), {
    remaining: 77, limit: 5000, reset: 1_800_000_000,
  });
});

test('runBudget before stores the reading, after logs one line from it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'api-budget-'));
  try {
    const logged = [];
    const readings = [payload(4000), payload(3985)];
    assert.equal(runBudget('before', { label: 'gate', dir, read: () => parseCoreRate(readings.shift()), log: (l) => logged.push(l) }), 0);
    assert.equal(JSON.parse(readFileSync(path.join(dir, STATE_FILE), 'utf8')).remaining, 4000);
    assert.equal(logged.length, 0, 'the before phase stays silent: one line per run');
    assert.equal(runBudget('after', { label: 'gate', dir, read: () => parseCoreRate(readings.shift()), log: (l) => logged.push(l) }), 0);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /before=4000 after=3985 used=15/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runBudget after without a stored reading still logs and exits 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'api-budget-'));
  try {
    const logged = [];
    assert.equal(runBudget('after', { label: 'gate', dir, read: () => parseCoreRate(payload(9)), log: (l) => logged.push(l) }), 0);
    assert.match(logged[0], /before reading unavailable/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runBudget never throws: a failing write is logged and the exit code stays 0', () => {
  const logged = [];
  const code = runBudget('before', {
    label: 'gate',
    dir: path.join(tmpdir(), 'api-budget-missing-dir', 'nope'),
    read: () => parseCoreRate(payload(1)),
    log: (l) => logged.push(l),
  });
  assert.equal(code, 0);
  assert.match(logged.join('\n'), /before failed/);
});
