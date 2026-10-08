// node --test scripts/feature-batch-ci-shard.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { featureTestWeight, featureTestWeightKeys, firstShardReserveSeconds, harvestE2eError, harvestMatrix, harvestTestFiles, harvestTests, namedTests, planShards, shardOf, shardTests, touchedHarvestTests, touchedTests, windowsSmokeTests } from './feature-batch-ci-targets.mjs';

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
  for (const total of [3, 6, 10]) {
    const plan = planShards(all, total);
    const testLoads = plan.loads.map((load, index) => load - (index === 0 ? firstShardReserveSeconds : 0));
    const span = Math.max(...testLoads) - Math.min(...testLoads);
    assert.ok(span <= heaviest, `engine ${total}: shard span ${span}s is wider than the slowest file ${heaviest}s`);
    assert.ok(Math.max(...testLoads) / Math.min(...testLoads) < 1.25, `engine ${total}: ${testLoads.join(',')}`);
  }
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
