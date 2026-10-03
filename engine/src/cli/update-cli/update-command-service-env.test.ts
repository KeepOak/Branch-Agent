import { afterEach, expect, it, vi } from "vitest";
import { withUpdateEnv } from "./update-command-service-env.js";

afterEach(() => vi.unstubAllEnvs());

it.each([false, true])("restores only update phase overrides after failure=%s", async (fails) => {
  vi.stubEnv("BRANCH_UPDATE_IN_PROGRESS", "previous");
  vi.stubEnv("BRANCH_UPDATE_POST_CORE_CONVERGENCE", "inherited");
  vi.stubEnv("BRANCH_UPDATE_TEST_OTHER", "before");
  vi.stubEnv("BRANCH_UPDATE_TEST_NEW", undefined);
  const failure = new Error("phase failed");
  const run = withUpdateEnv(
    {
      BRANCH_UPDATE_IN_PROGRESS: "1",
      BRANCH_UPDATE_POST_CORE_CONVERGENCE: undefined,
      BRANCH_UPDATE_TEST_NEW: "created",
    },
    async () => {
      expect(process.env.BRANCH_UPDATE_IN_PROGRESS).toBe("1");
      expect(process.env.BRANCH_UPDATE_POST_CORE_CONVERGENCE).toBeUndefined();
      expect(process.env.BRANCH_UPDATE_TEST_NEW).toBe("created");
      process.env.BRANCH_UPDATE_TEST_OTHER = "phase-owned";
      if (fails) {
        throw failure;
      }
      return "completed";
    },
  );
  if (fails) {
    await expect(run).rejects.toBe(failure);
  } else {
    await expect(run).resolves.toBe("completed");
  }
  expect(process.env.BRANCH_UPDATE_IN_PROGRESS).toBe("previous");
  expect(process.env.BRANCH_UPDATE_POST_CORE_CONVERGENCE).toBe("inherited");
  expect(process.env.BRANCH_UPDATE_TEST_NEW).toBeUndefined();
  expect(process.env.BRANCH_UPDATE_TEST_OTHER).toBe("phase-owned");
});
