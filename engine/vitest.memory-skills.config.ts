// Bounded named-file verification for the memory/skills lane.
import { sharedVitestConfig } from "./test/vitest/vitest.shared.config.js";

export default {
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    include: [
      "src/skills/runtime/refresh-watch-path.test.ts",
      "extensions/memory-core/src/memory/temporal-decay.legacy-root.test.ts",
      "extensions/memory-core/src/memory/mmr.test.ts",
      "extensions/memory-core/src/memory-budget.test.ts",
      "extensions/memory-core/src/rings-dreams-file.test.ts",
    ],
  },
};
