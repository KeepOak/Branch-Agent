import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as coverage from './changed-test-coverage.mjs';
import {
  allowlistedDesktopRunTargets,
  changedTestPaths,
  coverageTargets,
  desktopRunTargets,
  handoffRunTargets,
  loadUnlistedRunner,
  unlistedDesktopTargets,
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
  const noNamedLists = { namedFor: () => [], namedE2eFor: () => [] };
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

const STAND_IN_RUNNER = [
  "import { existsSync, readdirSync, readFileSync } from 'node:fs';",
  "import { join } from 'node:path';",
  "export const EXCLUDED = [['scripts/excluded.test.mjs', 'needs a display']];",
  'export function pickUnlistedTests({ desktopDir, workflowPath, excluded = EXCLUDED }) {',
  "  const workflow = readFileSync(workflowPath, 'utf8');",
  '  const skip = new Set(excluded.map(([file]) => file));',
  "  const dir = join(desktopDir, 'scripts');",
  '  if (!existsSync(dir)) return [];',
  "  return readdirSync(dir).filter((name) => name.endsWith('.test.mjs')).map((name) => `scripts/${name}`)",
  '    .filter((file) => !workflow.includes(file) && !skip.has(file));',
  '}',
  '',
].join('\n');

// A temporary repo root; with the stand-in runner written into it when asked. Never the real repo.
function tempRepo(withRunner) {
  const dir = mkdtempSync(path.join(tmpdir(), 'unlisted-runner-'));
  if (withRunner) {
    mkdirSync(path.join(dir, 'desktop/scripts'), { recursive: true });
    writeFileSync(path.join(dir, 'desktop/scripts/run-unlisted-tests.mjs'), STAND_IN_RUNNER);
  }
  return dir;
}

const UNNAMED_WORKFLOW = 'on:\n  pull_request:\njobs:\n  desktop:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n';

// The CLI's own steps: the gate's targets, plus what the runner (if the repo has it) would run.
async function uncoveredWithRunner(file, withRunner) {
  const dir = tempRepo(withRunner);
  try {
    const runner = await loadUnlistedRunner(dir);
    assert.equal(runner === null, !withRunner);
    const changed = changedTestPaths(`A\t${file}\n`);
    const covered = coverageTargets(UNNAMED_WORKFLOW, '', '', '', { namedFor: () => [], namedE2eFor: () => [] });
    for (const target of unlistedDesktopTargets(runner, changed, UNNAMED_WORKFLOW)) covered.add(target);
    return uncoveredTests(changed, covered);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('without the unlisted-tests runner file, a desktop test no step names is still uncovered', async () => {
  assert.deepEqual(await uncoveredWithRunner('desktop/scripts/new.test.mjs', false), ['desktop/scripts/new.test.mjs']);
});

test('with the unlisted-tests runner present, a desktop test it picks up is covered', async () => {
  assert.deepEqual(await uncoveredWithRunner('desktop/scripts/new.test.mjs', true), []);
});

test('with the unlisted-tests runner present, a desktop test in its EXCLUDED list is still uncovered', async () => {
  assert.deepEqual(await uncoveredWithRunner('desktop/scripts/excluded.test.mjs', true), ['desktop/scripts/excluded.test.mjs']);
});

test('a changed test that no CI job runs is still a coverage failure', () => {
  const workflow = readFileSync(new URL('../.github/workflows/desktop-checks.yml', import.meta.url), 'utf8');
  const covered = coverageTargets(workflow);
  const missing = 'window/src/not-in-ci.test.tsx';
  assert.equal(covered.has(missing), false);
  assert.deepEqual(uncoveredTests([missing], covered), [missing]);
});

test('a changed engine e2e test is covered only when the named e2e list (run by feature-batch-ci) has it', () => {
  const file = 'engine/ui/src/e2e/about.e2e.test.ts';
  const none = { namedFor: () => [], namedE2eFor: () => [] };
  assert.deepEqual(uncoveredTests([file], coverageTargets('', '', '', '', none)), [file]);
  const e2eListed = { namedFor: () => [], namedE2eFor: (lane) => (lane === 'engine' ? ['ui/src/e2e/about.e2e.test.ts'] : []) };
  assert.deepEqual(uncoveredTests([file], coverageTargets('', '', '', '', e2eListed)), []);
  assert.deepEqual(uncoveredTests(['engine/ui/src/e2e/other.e2e.test.ts'], coverageTargets('', '', '', '', e2eListed)),
    ['engine/ui/src/e2e/other.e2e.test.ts']);
});

test('feature-batch-ci runs named e2e tests in runFeatureTests only, and preflight checks they exist', () => {
  const src = readFileSync(new URL('./feature-batch-ci.mjs', import.meta.url), 'utf8');
  const body = (name) => src.slice(src.indexOf(`function ${name}(`), src.indexOf('\n}\n', src.indexOf(`function ${name}(`)));
  assert.doesNotMatch(body('validateScope'), /runNamedE2eTests/);
  assert.match(body('validateScope'), /namedE2eTests\(lane\)\) await fs\.access/);
  const run = body('runFeatureTests');
  assert.ok(run.indexOf('runNamedE2eTests(env, shard)') > run.indexOf('const shard = shardOf()'));
  // Only full-scope Linux shards run them (PR Linux shards always run); never the touched or non-Linux jobs.
  assert.match(body('runNamedE2eTests'), /if \(!namedE2eScope\(\)\) return;/);
  assert.match(src, /scope !== 'touched' && platform === 'linux'/);
});

test('named e2e entries stay out of the unit named list that feeds the vitest shards', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const targets = await import('./feature-batch-ci-targets.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'named-'));
  writeFileSync(join(dir, 'x.txt'), [
    'engine:ui/src/e2e/about.e2e.test.ts',
    'engine:test/gateway-desktop-handoff.e2e.test.ts',
    'engine:src/foo.test.ts',
  ].join('\n'));
  targets.setNamedListDir(dir);
  try {
    assert.deepEqual(targets.namedTestFiles('engine'), ['src/foo.test.ts']);
    assert.deepEqual(targets.namedTestFiles('engine', undefined, { e2e: true }), ['ui/src/e2e/about.e2e.test.ts']);
  } finally {
    targets.setNamedListDir(fileURLToPath(new URL('./feature-batch-ci-named/', import.meta.url)));
  }
});

function inventoryFixture() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'test-inventory-'));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: 'pipe' });
  const write = (file, text = '') => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), text);
    git('add', '--', file);
  };
  git('init', '-q');
  return { cwd, git, write, close: () => rmSync(cwd, { recursive: true, force: true }) };
}

test('full-tree: new uncovered test fails, then a named entry covers it', () => {
  const r = inventoryFixture();
  try {
    r.write('engine/src/new.test.ts');
    let out = coverage.checkAllTests({ cwd: r.cwd });
    assert.equal(out.exitCode, 1);
    assert.match(out.text, /Uncovered test: engine\/src\/new.test.ts/);
    r.write('scripts/feature-batch-ci-named/new.txt', 'engine:src/new.test.ts\n');
    out = coverage.checkAllTests({ cwd: r.cwd });
    assert.equal(out.exitCode, 0, out.text);
  } finally { r.close(); }
});

test('full-tree: new live test is local-only without a baseline entry', () => {
  const r = inventoryFixture();
  try {
    r.write('engine/src/new.live.test.ts');
    const out = coverage.checkAllTests({ cwd: r.cwd });
    assert.equal(out.exitCode, 0, out.text);
    assert.equal(out.localOnly, 1);
    assert.equal(out.baseline, 0);
  } finally { r.close(); }
});

test('full-tree: a covered baseline entry fails and must shrink', () => {
  const r = inventoryFixture();
  try {
    r.write('engine/src/new.test.ts');
    r.write('scripts/feature-batch-ci-named/new.txt', 'engine:src/new.test.ts\n');
    r.write('scripts/ci-uncovered-baseline/engine-src-new.txt', 'engine:src/new.test.ts\n');
    const out = coverage.checkAllTests({ cwd: r.cwd });
    assert.equal(out.exitCode, 1);
    assert.match(out.text, /Baseline test now covered:.*delete that line/);
  } finally { r.close(); }
});

test('full-tree: deleted baseline entries only warn, and an unlisted deletion passes', () => {
  const r = inventoryFixture();
  try {
    r.write('scripts/ci-uncovered-baseline/engine-src-gone.txt', 'engine:src/gone.test.ts\n');
    const out = coverage.checkAllTests({ cwd: r.cwd });
    assert.equal(out.exitCode, 0, out.text);
    assert.match(out.text, /Warning: Deleted baseline test:.*delete that line/);
    r.write('engine/src/unlisted.test.ts');
    r.git('rm', '-f', '--', 'engine/src/unlisted.test.ts');
    assert.equal(coverage.checkAllTests({ cwd: r.cwd }).exitCode, 0);
  } finally { r.close(); }
});

test('full-tree: dangling named and harvest entries fail even with no changed tests', () => {
  const r = inventoryFixture();
  try {
    for (const dir of ['feature-batch-ci-named', 'feature-batch-ci-harvest']) {
      r.write(`scripts/${dir}/missing.txt`, `engine:src/${dir}.test.ts\n`);
    }
    const out = coverage.checkAllTests({ cwd: r.cwd });
    assert.equal(out.exitCode, 1);
    assert.equal(out.errors.filter(line => /CI selector names missing file/.test(line)).length, 2);
  } finally { r.close(); }
});

test('full-tree: working-directory resolves desktop defaults and root overrides', () => {
  const workflow = `on: [pull_request]
jobs:
  desktop:
    defaults:
      run:
        working-directory: desktop
    steps:
      - run: node --test scripts/a.test.mjs
      - name: root after run
        run: node --test scripts/check-merge-command.test.mjs
        working-directory: \${{ github.workspace }}
      - name: root before run
        working-directory: \${{ github.workspace }}
        run: node --test scripts/check-packaged-no-key-plugin.test.mjs
      - run: node --test scripts/disabled.test.mjs
        if: false
      - run: |
          cd ../engine
          node scripts/run-vitest.mjs run src/a.spec.ts
  root:
    steps:
      - run: node --test scripts/root.node-test.mjs
`;
  assert.deepEqual([...coverage.workflowRunTargets(workflow)], ['desktop/scripts/a.test.mjs',
    'scripts/check-merge-command.test.mjs', 'scripts/check-packaged-no-key-plugin.test.mjs',
    'engine/src/a.spec.ts', 'scripts/root.node-test.mjs']);
  const real = readFileSync(new URL('../.github/workflows/desktop-checks.yml', import.meta.url), 'utf8');
  const targets = coverage.workflowRunTargets(real);
  assert.ok(targets.has('scripts/check-merge-command.test.mjs'));
  assert.ok(!targets.has('desktop/scripts/check-merge-command.test.mjs'));
  // The trusted desktop path (desktopRunTargets) keeps its own desktop/ resolution unchanged.
  assert.ok(desktopRunTargets(real).has('desktop/scripts/check-merge-command.test.mjs'));
});

test('full-tree: all four test suffixes count and only specified trees are excluded', () => {
  const r = inventoryFixture();
  try {
    for (const file of ['engine/src/a.test.ts', 'window/src/a.spec.tsx', 'scripts/a.node-test.mjs',
      'engine/src/a.native-tests.mts', 'engine/src/fixtures/still.test.ts', 'mobile/a.test.ts',
      'engine/.github/a.test.ts', 'engine/test/fixtures/a.test.ts',
      'scripts/ci-uncovered-baseline/engine-src-a.test.ts.txt', 'engine/src/not-a-test.test.ts.txt',
      'engine/src/__snapshots__/a.test.ts.snap', 'engine/test/tsconfig/tsconfig.test.root.json']) r.write(file);
    const out = coverage.checkAllTests({ cwd: r.cwd });
    assert.equal(out.tests, 5);
    assert.equal(out.errors.length, 5);
  } finally { r.close(); }
});

test('full-tree: baseline and local-only additions require exact-head review; removals do not', () => {
  const head = 'a'.repeat(40);
  const input = { files: ['engine/src/a.test.ts'], covered: new Set(), baseline: ['engine/src/a.test.ts'],
    localOnly: ['engine/src/local.test.ts'], baseBaseline: [], baseLocalOnly: [] };
  assert.equal(coverage.evaluateTestInventory(input).errors.length, 2);
  assert.equal(coverage.evaluateTestInventory({ ...input, reviewed: true }).errors.length, 0);
  const r = inventoryFixture();
  try {
    r.write('scripts/ci-uncovered-baseline/a.txt', 'engine:src/a.test.ts\n');
    r.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base');
    r.write('scripts/ci-local-only-tests.txt', 'engine:src/local.test.ts\n');
    assert.equal(coverage.checkAllTests({ cwd: r.cwd, base: 'HEAD', head, body: `gate-change-reviewed: ${'b'.repeat(40)}` }).exitCode, 1);
    assert.equal(coverage.checkAllTests({ cwd: r.cwd, base: 'HEAD', head, body: `gate-change-reviewed: ${head}` }).exitCode, 0);
    r.write('scripts/ci-local-only-tests.txt', '');
    r.write('scripts/ci-uncovered-baseline/a.txt', '');
    assert.equal(coverage.checkAllTests({ cwd: r.cwd, base: 'HEAD' }).exitCode, 0);
  } finally { r.close(); }
});

test('full-tree: without review markers (local pre-push) new entries only warn', () => {
  const input = { files: ['engine/src/a.test.ts'], covered: new Set(), baseline: ['engine/src/a.test.ts'],
    localOnly: ['engine/src/local.test.ts'], baseBaseline: [], baseLocalOnly: [], reviewMarkers: false };
  const out = coverage.evaluateTestInventory(input);
  assert.equal(out.errors.length, 0);
  assert.equal(out.warnings.filter(line => /^New (?:baseline|local-only) entry: .*CI requires gate-change-reviewed/.test(line)).length, 2);
  assert.equal(coverage.evaluateTestInventory({ ...input, files: [], reviewMarkers: false }).errors.length, 0);
  assert.equal(coverage.evaluateTestInventory({ ...input, covered: new Set(['engine/src/a.test.ts']) }).errors
    .filter(line => /Baseline test now covered/.test(line)).length, 1);
});

function carryFixture() {
  const r = inventoryFixture();
  const git = (...args) => r.git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args);
  const sha = () => r.git('rev-parse', 'HEAD').trim();
  r.write('engine/src/a.test.ts');
  r.write('scripts/ci-uncovered-baseline/a.txt', 'engine:src/a.test.ts\n');
  git('commit', '-qm', 'base');
  const base = sha();
  r.write('engine/src/b.test.ts');
  r.write('scripts/ci-uncovered-baseline/a.txt', 'engine:src/a.test.ts\nengine:src/b.test.ts\n');
  git('commit', '-qm', 'add entry');
  const marker = sha();
  r.git('checkout', '-q', base);
  r.write('README.md', 'main moved\n');
  git('commit', '-qm', 'main moves');
  const mainTip = sha();
  r.git('checkout', '-q', marker);
  git('merge', '-q', '--no-edit', mainTip);
  const head = sha();
  const prFile = { filename: 'scripts/ci-uncovered-baseline/a.txt', status: 'modified',
    patch: '@@ -1 +1,2 @@\n engine:src/a.test.ts\n+engine:src/b.test.ts' };
  const commits = [{ sha: marker, parents: [{ sha: base }] }, { sha: head, parents: [{ sha: marker }, { sha: mainTip }] }];
  const review = (files = [prFile]) => ({ baseRef: 'main', commits, files, protectedPaths: new Set(), repoDir: r.cwd,
    request: (requestPath) => {
      if (requestPath === 'compare/' + mainTip + '...main') return { status: 'identical', behind_by: 0 };
      if (requestPath === 'compare/main...' + marker) return { files: [prFile] };
      throw new Error('unexpected request ' + requestPath);
    } });
  return { ...r, base, marker, head, prFile, review };
}

test('full-tree: a reviewed marker carries across a clean main merge via gateChangeMarkerCarriesForward', () => {
  const r = carryFixture();
  try {
    const args = { cwd: r.cwd, base: r.base, head: r.head, body: 'gate-change-reviewed: ' + r.marker };
    assert.equal(coverage.checkAllTests(args).exitCode, 1);
    assert.equal(coverage.checkAllTests({ ...args, review: r.review() }).exitCode, 0);
    assert.equal(coverage.checkAllTests({ ...args, review: () => r.review() }).exitCode, 0);
    // The inventory files count as protected: a head whose baseline diff differs from the reviewed one fails.
    const changed = { ...r.prFile, patch: r.prFile.patch + '\n+engine:src/c.test.ts' };
    assert.equal(coverage.checkAllTests({ ...args, review: r.review([changed]) }).exitCode, 1);
    // A marker that is not on the pull request does not carry.
    assert.equal(coverage.checkAllTests({ ...args, body: 'gate-change-reviewed: ' + 'c'.repeat(40), review: r.review() }).exitCode, 1);
  } finally { r.close(); }
});

test('full-tree: %2E in an inventory entry decodes to a dot and keeps the personal-info scan quiet', async () => {
  const { findPersonalInfo } = await import('./check-personal-info.mjs');
  const encoded = 'engine:src/x-y%2Elocal-z.test.ts';
  assert.deepEqual(coverage.inventoryLines(encoded), ['engine/src/x-y.local-z.test.ts']);
  assert.equal(findPersonalInfo(encoded).length, 0);
  assert.ok(findPersonalInfo('engine:src/x-y.local-z.test.ts').length > 0);
  const root = new URL('../', import.meta.url);
  const files = [coverage.LOCAL_ONLY_FILE, ...execFileSync('git', ['ls-files', '--', coverage.BASELINE_DIR],
    { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)];
  for (const file of files) {
    const text = readFileSync(new URL(file, root), 'utf8');
    assert.deepEqual(findPersonalInfo(text).map(hit => hit.match), [], file);
    if (file.startsWith(coverage.BASELINE_DIR + '/')) {
      assert.ok(text.split('\n').length <= 1000, file + ' must stay under 1,000 lines so the API returns its patch');
    }
  }
});

test('full-tree: missing active slice entries fail, inactive slice entries only warn', () => {
  const out = coverage.evaluateTestInventory({ files: [], covered: new Set(),
    missingEntries: ['engine/src/active.node-test.ts'], inactiveEntries: ['engine/src/inactive.node-test.ts'] });
  assert.equal(out.errors.length, 1);
  assert.equal(out.warnings.length, 1);
  const several = coverage.evaluateTestInventory({ files: [], covered: new Set(),
    inactiveEntries: ['engine/src/a.node-test.ts', 'engine/src/b.test.ts', 'window/src/c.test.tsx'] });
  assert.deepEqual(several.errors, []);
  assert.deepEqual(several.warnings, ['engine/src/a.node-test.ts', 'engine/src/b.test.ts', 'window/src/c.test.tsx']
    .map(file => `Inactive feature slice names missing file: ${file}`));
});

test('full-tree: real repository inventory passes and reports inactive slice debt separately', () => {
  const out = coverage.checkAllTests();
  assert.equal(out.exitCode, 0, out.text);
  assert.deepEqual(out.errors, []);
  // The live debt count moves as slices land or retire, so only its kind is pinned, not its size.
  const inactivePrefix = 'Inactive feature slice names missing file: ';
  for (const line of out.warnings) {
    assert.ok(line.startsWith(inactivePrefix), line);
    assert.equal(existsSync(fileURLToPath(new URL('../' + line.slice(inactivePrefix.length), import.meta.url))), false, line);
  }
  assert.match(out.text, new RegExp(`0 error\\(s\\), ${out.warnings.length} warning\\(s\\)\\.$`));
  assert.ok(out.tests > 20000);
  assert.ok(out.localOnly > 1000);
});
