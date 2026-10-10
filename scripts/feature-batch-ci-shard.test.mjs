// node --test scripts/feature-batch-ci-shard.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expectedShardSeconds, featureTestWeight, featureTestWeightKeys, firstShardReserveSeconds, harvestE2eError, harvestMatrix, harvestTestFiles, harvestTests, mainPushShardCounts, namedTests, planShards, plannedSlowestSeconds, setNamedListDir, pullRequestLinuxShardCount, resolvedShardCounts, runnerTestScale, shardBudgetFor, shardBudgetSeconds, shardCountFor, shardOf, shardTests, touchedHarvestTests, touchedTests, windowsSmokeTests } from './feature-batch-ci-targets.mjs';
import { featureBatchMatrix, validateFeatureBatchMatrix } from './feature-batch-ci-matrix.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('no FEATURE_SHARD runs everything in one job', () => {
  assert.deepEqual(shardOf(''), { index: 0, total: 1 });
  assert.deepEqual(shardTests(['a', 'b'], shardOf('')), ['a', 'b']);
});

test('the shards split the named list with nothing lost or run twice', () => {
  for (const lane of ['engine', 'window']) {
    const all = namedTests(lane);
    for (const total of [2, 3, 5, 6, 10]) {
      const parts = Array.from({ length: total }, (_, index) => shardTests(all, shardOf(`${index + 1}/${total}`)));
      assert.deepEqual(parts.flat().sort(), [...all].sort());
      assert.equal(new Set(parts.flat()).size, all.length);
    }
  }
});

test('slow files land on different shards instead of the same index stripe', () => {
  // Sorted-index round-robin puts every third file on shard 1. These three would share it.
  const tests = ['slow-a', 'fast-a', 'fast-b', 'slow-b', 'fast-c', 'fast-d', 'slow-c', 'fast-e', 'fast-f'];
  const weights = new Map([['slow-a', 100], ['slow-b', 90], ['slow-c', 80]]);
  const parts = [1, 2, 3].map(n => shardTests(tests, shardOf(`${n}/3`), weights));
  assert.deepEqual(parts.map(part => part.filter(file => file.startsWith('slow-'))), [['slow-c'], ['slow-a'], ['slow-b']]);
  assert.deepEqual(parts.flat().sort(), [...tests].sort());
});

test('duration weighting keeps named engine shards within one heavy file', () => {
  const known = new Set([...namedTests('engine'), ...namedTests('window')]);
  for (const file of featureTestWeightKeys()) assert.ok(known.has(file), `${file} is not a named test`);
  const all = namedTests('engine');
  const heaviest = Math.max(...all.map(file => featureTestWeight(file)));
  for (const total of [3, 6, 7, 8, 10]) {
    const plan = planShards(all, total);
    const testLoads = plan.loads.map((load, index) => load - (index === 0 ? firstShardReserveSeconds : 0));
    const span = Math.max(...testLoads) - Math.min(...testLoads);
    assert.ok(span <= heaviest, `engine ${total}: shard span ${span}s is wider than the slowest file ${heaviest}s`);
    assert.ok(Math.max(...testLoads) / Math.min(...testLoads) < 1.25, `engine ${total}: ${testLoads.join(',')}`);
  }
});

test('the workflow takes its matrix from the planner, and every planned shard fits its budget', () => {
  const yaml = readFileSync(new URL('../.github/workflows/feature-batch-checks.yml', import.meta.url), 'utf8');
  assert.match(yaml, /timeout-minutes: 15/);
  assert.doesNotMatch(yaml, /timeout-minutes: 20/);
  assert.match(yaml, /matrix: \$\{\{ fromJSON\(needs\.plan\.outputs\.matrix\) \}\}/);
  assert.doesNotMatch(yaml, /fromJSON\(github\.event_name/);
  const counts = resolvedShardCounts();
  const push = featureBatchMatrix({ event: 'push' }).include;
  const pr = featureBatchMatrix({ event: 'pull_request' }).include;
  const labels = (rows, os) => rows.filter(row => row.os === os).map(row => row.label);
  assert.deepEqual(labels(pr, 'ubuntu-latest'), Array.from({ length: counts.pullRequestLinux }, (_, index) => `${index + 1}/${counts.pullRequestLinux}`));
  assert.deepEqual(pr.filter(row => row.os === 'windows-latest').map(row => row.label), ['touched']);
  assert.deepEqual(labels(push, 'ubuntu-latest'), Array.from({ length: counts.ubuntu }, (_, index) => `${index + 1}/${counts.ubuntu}`));
  assert.deepEqual(labels(push, 'windows-latest'), Array.from({ length: counts.windows }, (_, index) => `${index + 1}/${counts.windows}`));
  assert.deepEqual(labels(push, 'macos-latest'), Array.from({ length: counts.macos }, (_, index) => `${index + 1}/${counts.macos}`));
  for (const [os, total] of [['ubuntu', counts.ubuntu], ['windows', counts.windows], ['macos', counts.macos], ['ubuntu', counts.pullRequestLinux]]) {
    const slowest = plannedSlowestSeconds(os, total);
    assert.ok(slowest <= shardBudgetFor(os), `${os} shard is ${slowest}s, over the ${shardBudgetFor(os)}s budget`);
  }
});

test('macOS and Windows main-push shards keep ten percent budget headroom', () => {
  const counts = resolvedShardCounts();
  for (const os of ['macos', 'windows']) {
    const slowest = plannedSlowestSeconds(os, counts[os]);
    assert.ok(slowest <= shardBudgetSeconds * 0.9, `${os} shard is ${slowest}s, over the ${shardBudgetSeconds * 0.9}s headroom budget`);
  }
});

test('a PR adding 60 unweighted engine tests still fits every planned shard budget', () => {
  // The rebrand docs PRs (#919-#922) name about 60 engine tests with no duration weight, so each
  // counts at the 5s default. The counts for those PRs are derived from the same weights.
  const extraTests = Array.from({ length: 60 }, (_, index) => `src/pr-batch-${String(index + 1).padStart(2, '0')}.test.ts`);
  const counts = resolvedShardCounts({ extraTests });
  for (const os of ['ubuntu', 'windows', 'macos']) {
    const slowest = plannedSlowestSeconds(os, counts[os], { extraTests });
    assert.ok(slowest <= shardBudgetFor(os), `${os} shard is ${slowest}s with 60 extra tests, over the ${shardBudgetFor(os)}s budget`);
  }
});

test('adding weight past the ceiling adds one shard and never fails', () => {
  // A PR that pushes the Windows total over the ceiling gets one more shard. The matrix grows,
  // the budget still holds, and nothing throws.
  const base = shardCountFor('windows');
  const added = [];
  let count = base;
  for (let index = 0; count === base && index < 5000; index += 1) {
    added.push(`src/regression-${String(index).padStart(4, '0')}.test.ts`);
    count = shardCountFor('windows', { extraTests: added });
  }
  assert.equal(count, base + 1, 'the first increase should be exactly one shard');
  assert.ok(plannedSlowestSeconds('windows', count, { extraTests: added }) <= shardBudgetFor('windows'));
  const windowsRows = featureBatchMatrix({ event: 'push', extraTests: added }).include.filter(row => row.os === 'windows-latest');
  assert.equal(windowsRows.length, base + 1);
});

test('a malformed shard is an error, not a silent skip', () => {
  for (const bad of ['0/2', '3/2', '1', 'a/b', '1/0']) assert.throws(() => shardOf(bad));
});

test('Windows PR scope runs touched named tests plus the smoke set, never unlisted files', () => {
  const engine = namedTests('engine');
  const touched = engine.find((file) => !windowsSmokeTests.engine.includes(file));
  const picked = touchedTests('engine', [`engine/${touched}`, 'engine/src/not-a-test.ts', 'window/src/x.ts']);
  assert.deepEqual([...picked].sort(), [...new Set([touched, ...windowsSmokeTests.engine])].sort());
  for (const file of windowsSmokeTests.engine) assert.ok(engine.includes(file), `${file} must be a named test`);
  assert.deepEqual(touchedTests('window', ['engine/src/x.ts']), []);
});

test('Harvest lists stay out of named tests and PRs select touched lists and test files', () => {
  const all = harvestTests('engine');
  const pilot = harvestTestFiles('engine', ['feat-harvest-pilot-a-1.txt']);
  assert.equal(pilot.length, 21);
  assert.ok(all.every(file => !namedTests('engine').includes(file)));
  const list = 'scripts/feature-batch-ci-harvest/feat-harvest-pilot-a-1.txt';
  assert.deepEqual(touchedHarvestTests('engine', [list]), [...pilot].sort());
  assert.deepEqual(touchedHarvestTests('engine', [`engine/${all[0]}`]), [all[0]]);
  assert.deepEqual(touchedHarvestTests('engine', ['engine/src/unlisted.test.ts']), []);
  assert.deepEqual(touchedHarvestTests('window', [list]), []);
  const shards = harvestMatrix([list]).filter(item => item.lane === 'engine');
  assert.equal(shards.length, Math.ceil(pilot.length / 4));
  assert.deepEqual(shards.flatMap(item => shardTests([...pilot].sort(), shardOf(item.shard))).sort(), [...pilot].sort());
  assert.equal(harvestMatrix().filter(item => item.lane === 'engine').length, Math.ceil(all.length / 8));
});

test('Harvest lists reject e2e files that Harvest vitest excludes', () => {
  assert.match(harvestE2eError('engine', 'src/commands/doctor.auth-profile-consumers.e2e.test.ts'), /e2e suite/);
  assert.match(harvestE2eError('window', 'src/foo.e2e.test.tsx'), /e2e suite/);
  assert.equal(harvestE2eError('engine', 'src/commands/doctor.test.ts'), undefined);
  const all = [...harvestTests('engine'), ...harvestTests('window')];
  assert.equal(all.find(file => harvestE2eError('engine', file) || harvestE2eError('window', file)), undefined);
});

test('an empty feature-batch matrix fails closed instead of skipping every feature job', () => {
  assert.throws(() => validateFeatureBatchMatrix({ include: [] }, 'push'), /matrix is empty/);
  assert.throws(() => validateFeatureBatchMatrix({}, 'push'), /matrix is empty/);
  assert.throws(() => validateFeatureBatchMatrix({ include: [] }, 'pull_request'), /matrix is empty/);
});

test('a feature-batch matrix below the shard floors fails closed', () => {
  const real = featureBatchMatrix({ event: 'push' });
  const fewerWindows = { include: real.include.filter((row) => row.os !== 'windows-latest') };
  assert.throws(() => validateFeatureBatchMatrix(fewerWindows, 'push'), /windows-latest shard\(s\), below the floor/);
  const fewerLinux = { include: real.include.slice(mainPushShardCounts.ubuntu - 1) };
  assert.throws(() => validateFeatureBatchMatrix(fewerLinux, 'push'), /ubuntu-latest shard\(s\), below the floor/);
  assert.equal(validateFeatureBatchMatrix(real, 'push'), real);
});

test('the planner reads the PR named lists as data, from the directory it is given', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'named-lists-'));
  writeFileSync(path.join(dir, 'pr-added.txt'), 'engine:src/pr-added-data.test.ts\n');
  const before = namedTests('engine');
  try {
    setNamedListDir(dir);
    const after = namedTests('engine');
    // The PR's directory is the only named-list source now: its file is read, and the repo's named lists are not.
    assert.ok(after.includes('src/pr-added-data.test.ts'));
    assert.ok(after.length < before.length, 'the repo named lists are not read from the PR directory');
  } finally {
    setNamedListDir(fileURLToPath(new URL('./feature-batch-ci-named/', import.meta.url)));
  }
});

test('the plan job uses the default-branch planner when it exists, and only a reviewed fallback literal before', () => {
  const yaml = readFileSync(new URL('../.github/workflows/feature-batch-checks.yml', import.meta.url), 'utf8');
  assert.match(yaml, /if \[ -f base\/scripts\/feature-batch-ci-matrix\.mjs \]; then/);
  const literals = [...yaml.matchAll(/echo 'matrix=(\{.*?\})' >> "\$GITHUB_OUTPUT"/g)].map((m) => JSON.parse(m[1]));
  assert.equal(literals.length, 2, 'one fallback for pull requests, one for pushes');
  const [pr, push] = literals;
  assert.doesNotThrow(() => validateFeatureBatchMatrix(pr, 'pull_request'));
  assert.doesNotThrow(() => validateFeatureBatchMatrix(push, 'push'));
  assert.equal(pr.include.filter((row) => row.os === 'ubuntu-latest').length, pullRequestLinuxShardCount);
  assert.equal(push.include.filter((row) => row.os === 'windows-latest').length, mainPushShardCounts.windows);
  assert.equal(push.include.filter((row) => row.os === 'macos-latest').length, mainPushShardCounts.macos);
  assert.equal(push.include.filter((row) => row.os === 'ubuntu-latest').length, mainPushShardCounts.ubuntu);
});
