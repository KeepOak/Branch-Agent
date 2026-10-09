import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  allowlistedDesktopRunTargets,
  changedTestPaths,
  coverageTargets,
  desktopRunTargets,
  handoffRunTargets,
  postMergeEngineRunTargets,
  pullRequestDesktopRunTargets,
  uncoveredTests,
  workflowDefaultsSetShell,
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

test('the post-merge catalog-fallback test counts as covered only through its executable run line', () => {
  const workflow = readFileSync(new URL('../.github/workflows/engine-lint-baselines.yml', import.meta.url), 'utf8');
  assert.deepEqual([...postMergeEngineRunTargets(workflow)], ['engine/test/scripts/control-ui-i18n.generated.test.ts']);
  assert.deepEqual([...postMergeEngineRunTargets('# run: node scripts/run-vitest.mjs run test/scripts/x.test.ts\n')], []);
  const desktop = readFileSync(new URL('../.github/workflows/desktop-checks.yml', import.meta.url), 'utf8');
  const file = 'engine/test/scripts/control-ui-i18n.generated.test.ts';
  // Hermetic: no named list from the repo, so the file is covered only by the post-merge run line.
  const noNamedLists = { namedFor: () => [] };
  assert.deepEqual(uncoveredTests([file], coverageTargets(desktop, '', '', '', noNamedLists)), [file]);
  assert.deepEqual(uncoveredTests([file], coverageTargets(desktop, '', '', workflow, noNamedLists)), []);
});

test('allowlisted desktop coverage counts #677\'s plain post-build step on the real workflow', () => {
  const real = readFileSync(new URL('../.github/workflows/desktop-checks.yml', import.meta.url), 'utf8');
  const targets = allowlistedDesktopRunTargets(real);
  assert.ok(targets.has('desktop/scripts/component-release-readiness.test.mjs'));
  assert.ok(targets.has('desktop/scripts/handoff-timeouts.test.mjs'));
  assert.ok(!targets.has('desktop/scripts/gateway-ready.test.mjs'));
});

test('workflowDefaultsSetShell fails closed on complex-key defaults and still allows a plain workflow', () => {
  const complex = [
    'on:\n  pull_request:\n',
    '? defaults\n',
    ': { run: { shell: bash } }\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  const mergeKey = [
    'on:\n  pull_request:\n',
    '<<: { defaults: { run: { shell: bash } } }\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  const documentMarker = [
    '---\n',
    'on:\n  pull_request:\n',
    'defaults: { run: { shell: bash } }\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  const plain = [
    'on:\n  pull_request:\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.equal(workflowDefaultsSetShell(complex), true);
  assert.equal(workflowDefaultsSetShell(mergeKey), true);
  assert.equal(workflowDefaultsSetShell(documentMarker), true);
  assert.equal(workflowDefaultsSetShell(plain), false);
  assert.deepEqual([...allowlistedDesktopRunTargets(complex)], []);
  assert.deepEqual([...allowlistedDesktopRunTargets(mergeKey)], []);
  assert.deepEqual([...allowlistedDesktopRunTargets(plain)], [
    'desktop/scripts/new.test.mjs',
  ]);
});

test('workflowDefaultsSetShell detects run.shell after jobs: and in flow style', () => {
  const afterJobs = [
    'on:\n  pull_request:\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
    'defaults:\n  run:\n    shell: bash\n',
  ].join('');
  const flow = [
    'on:\n  pull_request:\n',
    'defaults: { run: { shell: bash } }\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  const workingDirectoryOnly = [
    'on:\n  pull_request:\n',
    'defaults:\n  run:\n    working-directory: desktop\n',
    'jobs:\n  desktop:\n    steps:\n      - run: node --test scripts/new.test.mjs\n',
  ].join('');
  assert.equal(workflowDefaultsSetShell(afterJobs), true);
  assert.equal(workflowDefaultsSetShell(flow), true);
  assert.equal(workflowDefaultsSetShell(workingDirectoryOnly), false);
  assert.deepEqual([...allowlistedDesktopRunTargets(afterJobs)], []);
  assert.deepEqual([...allowlistedDesktopRunTargets(flow)], []);
  assert.deepEqual([...allowlistedDesktopRunTargets(workingDirectoryOnly)], [
    'desktop/scripts/new.test.mjs',
  ]);
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
