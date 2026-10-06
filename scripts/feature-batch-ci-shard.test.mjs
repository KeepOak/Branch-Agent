// node --test scripts/feature-batch-ci-shard.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { namedTests, shardOf, shardTests, touchedTests, windowsSmokeTests } from './feature-batch-ci-targets.mjs';

test('no FEATURE_SHARD runs everything in one job', () => {
  assert.deepEqual(shardOf(''), { index: 0, total: 1 });
  assert.deepEqual(shardTests(['a', 'b'], shardOf('')), ['a', 'b']);
});

test('the shards split the named list with nothing lost or run twice', () => {
  for (const lane of ['engine', 'window']) {
    const all = namedTests(lane);
    for (const total of [2, 3]) {
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
