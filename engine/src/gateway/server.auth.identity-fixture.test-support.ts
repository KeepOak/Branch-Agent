import path from "node:path";
import { afterEach } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { closeBranchStateDatabaseByPathAsync } from "../state/branch-state-db.js";

export function useAuthIdentityFixture() {
  const directories = useAutoCleanupTempDirTracker((cleanup) => {
    afterEach(async () => {
      for (const directory of directories.dirs) {
        await closeBranchStateDatabaseByPathAsync(path.join(directory, "device.sqlite"));
      }
      cleanup();
    });
  });
  // SQLite identities share state-owner locks by directory, regardless of filename.
  return (label: string) => path.join(directories.make(`${label}-`), "device.sqlite");
}
