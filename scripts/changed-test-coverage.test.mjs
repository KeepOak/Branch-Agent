import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { changedTestPaths, coverageTargets, desktopRunTargets, uncoveredTests } from './changed-test-coverage.mjs';

test('covered and uncovered changed tests are distinguished; deleted tests are ignored', () => {
  const changed = changedTestPaths('M\tengine/src/covered.test.ts\nA\twindow/src/missing.test.tsx\n' +
    'M\tengine/src/native.test.mts\nA\tdesktop/scripts/desktop.test.mjs\nD\tengine/src/deleted.test.ts\n');
  assert.deepEqual(changed, ['engine/src/covered.test.ts', 'window/src/missing.test.tsx',
    'engine/src/native.test.mts', 'desktop/scripts/desktop.test.mjs']);
  assert.deepEqual(uncoveredTests(changed, new Set(['engine/src/covered.test.ts', 'desktop/scripts/desktop.test.mjs'])),
    ['engine/src/native.test.mts', 'window/src/missing.test.tsx']);
});

test('desktop coverage requires an executable --test argument', () => {
  const workflow = '      # run: node --test scripts/commented.test.mjs\n' +
    '      - run: node --test scripts/covered.test.mjs scripts/part-*.test.mjs smoke.test.mts\n';
  const targets = desktopRunTargets(workflow);
  assert.deepEqual([...targets], ['desktop/scripts/covered.test.mjs', 'desktop/scripts/part-*.test.mjs',
    'desktop/smoke.test.mts']);
  assert.deepEqual(uncoveredTests(['desktop/scripts/part-one.test.mjs', 'desktop/scripts/other.test.mjs'], targets),
    ['desktop/scripts/other.test.mjs']);
});

test('coverage includes actual slice, priority, Harvest and desktop CI targets', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-checks.yml', import.meta.url), 'utf8');
  const covered = coverageTargets(workflow);
  const changed = [
    'engine/src/agents/sessions/tools/write.test.ts', // exact engine slice
    'window/src/composer/input-preservation.test.tsx', // exact window slice
    'engine/src/config/sessions/goals.test.ts', // priority suite
    'engine/extensions/memory-core/src/short-term-promotion.test.ts', // filtered priority suite
    'engine/extensions/admin-http-rpc/index.test.ts', // Harvest shard
    'desktop/scripts/gateway-ready.test.mjs', // desktop-checks run line
  ];
  assert.deepEqual(uncoveredTests(changed, covered), []);
  assert.deepEqual(uncoveredTests(['engine/src/agents/agent-scope.test.ts'], covered),
    ['engine/src/agents/agent-scope.test.ts']);
});
