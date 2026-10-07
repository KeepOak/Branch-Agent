import { sharedVitestConfig } from '../engine/test/vitest/vitest.shared.config.ts';
import { controlUiLocaleModulesPlugin } from '../engine/ui/config/control-ui-locales.ts';
import { engineRoot } from './feature-batch-ci-runtime.mjs';
import { harvestTests } from './feature-batch-ci-targets.mjs';

const setupFiles = [
  ...(sharedVitestConfig.test.setupFiles ?? []),
  'ui/src/test-helpers/lit-warnings.setup.ts',
];

export default {
  ...sharedVitestConfig,
  root: engineRoot,
  plugins: [...sharedVitestConfig.plugins, controlUiLocaleModulesPlugin()],
  test: {
    ...sharedVitestConfig.test,
    include: harvestTests('engine'),
    setupFiles,
    projects: undefined,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
