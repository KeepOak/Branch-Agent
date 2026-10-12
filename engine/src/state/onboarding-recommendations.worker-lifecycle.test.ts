import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { createMockStateReadSource } from "./branch-state-read-mock.test-support.js";
import type { BranchStateReadOutcome } from "./branch-state-read.types.js";

const mocks = vi.hoisted(() => {
  const writableClosed = new Error("Writable SQLite actor admission is closed");
  return {
    writableClosed,
    write: vi.fn(async () => {
      throw writableClosed;
    }),
    read: vi.fn<() => Promise<BranchStateReadOutcome>>(),
    close: vi.fn(async () => undefined),
  };
});
vi.mock("./branch-state-worker-store.js", () => ({
  executeBranchStateWorker: mocks.write,
  runBranchStateWorkerOperation: mocks.write,
}));
vi.mock("./branch-state-read-worker.js", () => ({
  captureBranchStateReadSource: () =>
    createMockStateReadSource({
      read: mocks.read,
      close: mocks.close,
    }),
}));

import { createOnboardingRecommendationsStore } from "./onboarding-recommendations.js";
import { closeBranchStateDatabaseAsync } from "./branch-state-db.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeBranchStateDatabaseAsync();
    cleanup();
  }),
);

it("reads independently while writable actor admission is closed", async () => {
  const root = tempDirs.make("onboarding-read-lifecycle-");
  const pathname = path.join(root, "state.sqlite");
  // The real source owner selects this file; the synthetic transport never opens SQLite.
  fs.writeFileSync(pathname, "synthetic reader source");
  const record = {
    inventoryHash: "synthetic-inventory",
    matches: [],
    offeredAt: 1,
    acceptedAt: null,
    updatedAt: 1,
  };
  mocks.read.mockResolvedValue({
    value: { ok: true, type: "onboardingRecommendations.read", sourceAdmitted: true, record },
  });
  const store = createOnboardingRecommendationsStore({
    workspaceDir: root,
    database: { path: pathname, env: { BRANCH_STATE_DIR: root } },
  });

  await expect(store.clear()).rejects.toBe(mocks.writableClosed);
  await expect(store.read()).resolves.toEqual(record);

  expect(mocks.write).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledOnce();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(fs.readFileSync(pathname, "utf8")).toBe("synthetic reader source");
});
