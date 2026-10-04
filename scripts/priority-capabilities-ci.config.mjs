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
    // The real headless exec fixture owns host shared-state admission. Threads
    // classify it as an application worker without the required host broker.
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    passWithNoTests: false,
  },
};
