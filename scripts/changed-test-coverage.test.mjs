import assert from 'node:assert/strict';
import test from 'node:test';
import { changedTestPaths, desktopRunTargets, uncoveredTests } from './changed-test-coverage.mjs';

test('covered and uncovered changed tests are distinguished; deleted tests are ignored', () => {
  const changed = changedTestPaths('M\tengine/src/covered.test.ts\nA\twindow/src/missing.test.tsx\n' +
    'M\tengine/src/native.test.mts\nA\tdesktop/scripts/desktop.test.mjs\nD\tengine/src/deleted.test.ts\n');
  assert.deepEqual(changed, ['engine/src/covered.test.ts', 'window/src/missing.test.tsx',
    'engine/src/native.test.mts', 'desktop/scripts/desktop.test.mjs']);
  assert.deepEqual(uncoveredTests(changed, new Set(['engine/src/covered.test.ts', 'desktop/scripts/desktop.test.mjs'])),
    ['engine/src/native.test.mts', 'window/src/missing.test.tsx']);
});

test('desktop coverage requires an executable --test argument', () => {
  const workflow = '      # run: node --test scripts/commented.test.mjs\n      - run: node --test scripts/covered.test.mjs scripts/part-*.test.mjs\n';
  const targets = desktopRunTargets(workflow);
  assert.deepEqual([...targets], ['desktop/scripts/covered.test.mjs', 'desktop/scripts/part-*.test.mjs']);
  assert.deepEqual(uncoveredTests(['desktop/scripts/part-one.test.mjs', 'desktop/scripts/other.test.mjs'], targets),
    ['desktop/scripts/other.test.mjs']);
});
