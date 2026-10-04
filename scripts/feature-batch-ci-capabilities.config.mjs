import { sharedVitestConfig } from '../engine/test/vitest/vitest.shared.config.ts';
import { engineRoot } from './feature-batch-ci-runtime.mjs';
import { capabilityTests } from './feature-batch-ci-targets.mjs';

// Capability regressions run beside the named batch so neither job crosses the CI time cap.
export default {
  ...sharedVitestConfig,
  root: engineRoot,
  test: {
    ...sharedVitestConfig.test,
    include: capabilityTests(),
    projects: undefined,
    // Native gateway and agent-admission tests need a main thread; POSIX defaults to worker threads.
    pool: 'forks',
    maxWorkers: 2,
    fileParallelism: true,
    isolate: true,
    passWithNoTests: false,
  },
};
