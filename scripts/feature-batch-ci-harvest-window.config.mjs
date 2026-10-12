import config from '../window/vite.config.ts';
import { windowRoot } from './feature-batch-ci-runtime.mjs';
import { harvestTests } from './feature-batch-ci-targets.mjs';

export default {
  ...config,
  root: windowRoot,
  test: {
    ...config.test,
    include: harvestTests('window'),
    projects: undefined,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
