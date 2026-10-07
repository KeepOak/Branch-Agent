// node --test scripts/feature-batch-ci-shard.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { harvestMatrix, harvestTestFiles, harvestTests, namedTests, shardOf, shardTests, touchedHarvestTests, touchedTests, windowsSmokeTests } from './feature-batch-ci-targets.mjs';

test('no FEATURE_SHARD runs everything in one job', () => {
  assert.deepEqual(shardOf(''), { index: 0, total: 1 });
  assert.deepEqual(shardTests(['a', 'b'], shardOf('')), ['a', 'b']);
});

test('the shards split the named list with nothing lost or run twice', () => {
  for (const lane of ['engine', 'window']) {
    const all = namedTests(lane);
    for (const total of [2, 5, 7]) {
      const parts = Array.from({ length: total }, (_, index) => shardTests(all, shardOf(`${index + 1}/${total}`)));
      assert.deepEqual(parts.flat().sort(), [...all].sort());
      assert.equal(new Set(parts.flat()).size, all.length);
      assert.ok(Math.max(...parts.map((part) => part.length)) - Math.min(...parts.map((part) => part.length)) <= 1);
    }
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
