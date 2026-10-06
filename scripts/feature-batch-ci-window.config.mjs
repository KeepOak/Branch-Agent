import config from '../window/vite.config.ts';
import { windowRoot } from './feature-batch-ci-runtime.mjs';
import { namedTests } from './feature-batch-ci-targets.mjs';

// Use the real React plugin and jsdom environment with four explicit caller suites.
export default {
  ...config,
  root: windowRoot,
  test: {
    ...config.test,
    include: namedTests('window'),
    projects: undefined,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
