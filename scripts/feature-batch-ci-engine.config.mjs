import { sharedVitestConfig } from '../engine/test/vitest/vitest.shared.config.ts';
import codexVitestConfig from '../engine/test/vitest/vitest.extension-codex.config.ts';
import { engineRoot } from './feature-batch-ci-runtime.mjs';
import { namedTests } from './feature-batch-ci-targets.mjs';

const codexPartition = process.env.BRANCH_FEATURE_BATCH_ENGINE_PARTITION === 'codex';
const base = codexPartition ? codexVitestConfig : sharedVitestConfig;

// Retain the canonical Codex extension fixture, aliases and teardown. Explicit
// inventory paths are engine-root-relative, unlike the scoped shard's includes.
export default {
  ...base,
  root: engineRoot,
  test: {
    ...base.test,
    root: engineRoot,
    dir: engineRoot,
    include: namedTests('engine').filter(file => codexPartition === file.startsWith('extensions/codex/')),
    projects: undefined,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
