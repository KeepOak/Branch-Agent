import { sharedVitestConfig } from "../engine/test/vitest/vitest.shared.config.ts";
import { engineRoot } from "./feature-batch-ci-runtime.mjs";
import { priorityTests, priorityMemoryIntegration } from "./priority-capabilities-ci-targets.mjs";

export default {
  ...sharedVitestConfig,
  root: engineRoot,
  test: {
    ...sharedVitestConfig.test,
    include: [...priorityTests, priorityMemoryIntegration],
    projects: undefined,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
