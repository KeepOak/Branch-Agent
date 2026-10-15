// The real-engine handoff test (test/gateway-desktop-handoff.e2e.test.ts) in its own job: it spawns built engines
// (dist/), so the job builds once and runs only this file, one test at a time.
import { sharedVitestConfig } from "./vitest.shared.config.ts";

export default {
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: ["test/gateway-desktop-handoff.e2e.test.ts"],
    exclude: [],
    projects: undefined,
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    passWithNoTests: false,
  },
};
