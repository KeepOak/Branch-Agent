import { sharedVitestConfig } from '../engine/test/vitest/vitest.shared.config.ts';
import { engineRoot } from './feature-batch-ci-runtime.mjs';
import { harvestTests } from './feature-batch-ci-targets.mjs';

export default {
  ...sharedVitestConfig,
  root: engineRoot,
  test: {
    ...sharedVitestConfig.test,
    include: harvestTests('engine'),
    projects: undefined,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
