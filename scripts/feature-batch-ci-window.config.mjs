import config from '../window/vite.config.ts';
import { windowRoot } from './feature-batch-ci-runtime.mjs';
import { harvestTests, namedTests } from './feature-batch-ci-targets.mjs';

// Use the real React plugin and jsdom environment with four explicit caller suites.
export default {
  ...config,
  root: windowRoot,
  test: {
    ...config.test,
    include: [...new Set([...namedTests('window'), ...harvestTests('window')])],
    projects: undefined,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
