import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { engineRoot, featureTestInvocations, repoRoot, windowRoot } from './feature-batch-ci-runtime.mjs';
import { namedTests } from './feature-batch-ci-targets.mjs';

test('every named engine target runs exactly once, with Codex on its canonical runtime fixture', () => {
  const invocations = featureTestInvocations('engine');
  assert.equal(invocations.length, 2);
  assert.deepEqual(invocations.flatMap(batch => batch.files).toSorted(), namedTests('engine').toSorted());
  for (const { root, args, files, env } of invocations) {
    assert.equal(root, engineRoot);
    const codex = files.every(file => file.startsWith('extensions/codex/'));
    assert.equal(args[3], path.join(repoRoot, 'scripts/feature-batch-ci-engine.config.mjs'));
    assert.equal(env.BRANCH_FEATURE_BATCH_ENGINE_PARTITION, codex ? 'codex' : 'ordinary');
    assert.deepEqual(args.slice(8), files);
    assert(args.includes('--passWithNoTests=false'));
    assert(args.includes('--maxWorkers=1'));
    assert(args.includes('--no-file-parallelism'));
    assert(args.includes('--isolate'));
  }
});

test('window targets remain unchanged and empty partitions never start Vitest discovery', () => {
  const [window] = featureTestInvocations('window');
  assert.equal(window.root, windowRoot);
  assert.deepEqual(window.files, namedTests('window'));
  assert.equal(featureTestInvocations('engine', ['extensions/codex/harness.test.ts']).length, 1);
  assert.equal(featureTestInvocations('engine', ['src/agents/identity.test.ts']).length, 1);
  assert.deepEqual(featureTestInvocations('engine', []), []);
  assert.throws(() => featureTestInvocations('unknown', []), /Unknown feature test lane/);
});

test('the bounded Codex config retains canonical runtime setup, aliases and teardown', async () => {
  const previous = process.env.BRANCH_FEATURE_BATCH_ENGINE_PARTITION;
  try {
    process.env.BRANCH_FEATURE_BATCH_ENGINE_PARTITION = 'codex';
    const [{ default: canonical }, { default: bounded }] = await Promise.all([
      import('../engine/test/vitest/vitest.extension-codex.config.ts'),
      import('./feature-batch-ci-engine.config.mjs?codex-fixture-proof'),
    ]);
    assert.deepEqual(bounded.test.setupFiles, canonical.test.setupFiles);
    assert(bounded.test.setupFiles.includes(path.join(engineRoot, 'test/setup.extensions.ts')));
    assert.deepEqual(bounded.resolve, canonical.resolve);
    assert.deepEqual(bounded.plugins, canonical.plugins);
    assert.deepEqual(bounded.test.exclude, canonical.test.exclude);
    assert.equal(bounded.test.runner, canonical.test.runner);
    assert.equal(bounded.test.isolate, canonical.test.isolate);
    assert.equal(bounded.test.root, engineRoot);
    assert.equal(bounded.test.dir, engineRoot);
    assert.deepEqual(bounded.test.include, namedTests('engine').filter(file => file.startsWith('extensions/codex/')));
  } finally {
    if (previous === undefined) delete process.env.BRANCH_FEATURE_BATCH_ENGINE_PARTITION;
    else process.env.BRANCH_FEATURE_BATCH_ENGINE_PARTITION = previous;
  }
});
