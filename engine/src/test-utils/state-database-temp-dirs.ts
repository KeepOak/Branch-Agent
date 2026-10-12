import { afterEach, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import {
  closeBranchStateDatabaseAsync,
  closeBranchStateDatabaseForTest,
} from "../state/branch-state-db.js";

export function useStateDatabaseTempDirs() {
  return useAutoCleanupTempDirTracker((cleanup) =>
    afterEach(async () => {
      vi.restoreAllMocks();
      await closeBranchStateDatabaseAsync();
      closeBranchStateDatabaseForTest();
      cleanup();
    }),
  );
}
