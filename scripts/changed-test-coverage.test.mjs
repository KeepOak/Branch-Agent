import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  allowlistedDesktopRunTargets,
  changedTestPaths,
  coverageTargets,
  desktopRunTargets,
  handoffRunTargets,
  pullRequestDesktopRunTargets,
  uncoveredTests,
  workflowHasPullRequestTrigger,
} from './changed-test-coverage.mjs';

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

test('desktop coverage ignores if: false steps and commented run lines', () => {
  const workflow = [
    '      # run: node --test scripts/commented.test.mjs\n',
    '      - name: disabled literal\n',
    '        if: false\n',
    '        run: node --test scripts/disabled.test.mjs\n',
    '      - name: disabled expression\n',
    '        if: ${{ false }}\n',
    '        run: node --test scripts/disabled-expr.test.mjs\n',
    '      - if: false\n',
    '        run: node --test scripts/disabled-short.test.mjs\n',
    '      - name: live\n',
    '        run: node --test scripts/live.test.mjs\n',
  ].join('');
  assert.deepEqual([...desktopRunTargets(workflow)], ['desktop/scripts/live.test.mjs']);
});

test('pull-request desktop coverage requires an on.pull_request trigger', () => {
  const run = '      - run: node --test scripts/covered.test.mjs\n';
  assert.equal(workflowHasPullRequestTrigger(run), false);
  assert.deepEqual([...pullRequestDesktopRunTargets(run)], []);
  const withTrigger = 'on:\n  pull_request:\n    paths: [desktop/**]\n' + run;
  assert.equal(workflowHasPullRequestTrigger(withTrigger), true);
  assert.deepEqual([...pullRequestDesktopRunTargets(withTrigger)], ['desktop/scripts/covered.test.mjs']);
  const mapping = 'on: [pull_request, push]\n' + run;
  assert.equal(workflowHasPullRequestTrigger(mapping), true);
  assert.deepEqual([...pullRequestDesktopRunTargets(mapping)], ['desktop/scripts/covered.test.mjs']);
});

test('real-engine handoff coverage requires the executable sharded Vitest command and configured file', () => {
  const workflow = readFileSync(new URL('../.github/workflows/engine-handoff-checks.yml', import.meta.url), 'utf8');
  const config = readFileSync(new URL('../engine/test/vitest/vitest.desktop-handoff.config.ts', import.meta.url), 'utf8');
  assert.deepEqual([...handoffRunTargets(workflow, config)], ['engine/test/gateway-desktop-handoff.e2e.test.ts']);
  assert.deepEqual([...handoffRunTargets('run: node scripts/run-vitest.mjs run', config)], []);
  assert.deepEqual([...handoffRunTargets(workflow, 'include: []')], []);
});

test('allowlisted desktop coverage counts #677\'s plain post-build step on the real workflow', () => {
  const real = readFileSync(new URL('../.github/workflows/desktop-checks.yml', import.meta.url), 'utf8');
  const withReadiness = real.replace(
    '        run: npm run build\n      - name: Check updates, startup and owned process cleanup',
    '        run: npm run build\n      - name: Check component release readiness\n'
      + '        run: node --test scripts/component-release-readiness.test.mjs\n'
      + '      - name: Check updates, startup and owned process cleanup',
  );
  const targets = allowlistedDesktopRunTargets(withReadiness);
  assert.ok(targets.has('desktop/scripts/component-release-readiness.test.mjs'));
  assert.ok(targets.has('desktop/scripts/handoff-timeouts.test.mjs'));
  assert.ok(!targets.has('desktop/scripts/gateway-ready.test.mjs'));
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
