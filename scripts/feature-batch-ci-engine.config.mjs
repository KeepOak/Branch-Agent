import { sharedVitestConfig } from '../engine/test/vitest/vitest.shared.config.ts';
import { engineRoot } from './feature-batch-ci-runtime.mjs';
import { namedTests } from './feature-batch-ci-targets.mjs';

// Keep production source aliases and test-home setup while avoiding project discovery.
export default {
  ...sharedVitestConfig,
  root: engineRoot,
  test: {
    ...sharedVitestConfig.test,
    include: namedTests('engine'),
    projects: undefined,
    // Upstream runs host-owned SQLite broker consumers in forked processes (vitest.database-worker-core-paths.mjs);
    // worker threads cannot admit agent or shared-state stores. Windows already used forks.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
