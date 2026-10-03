import { join } from "node:path";
import { afterEach } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { closeBranchAgentDatabasesAsync } from "../../state/branch-agent-db.js";
import { waitForReplyRunSuccessorAdmission } from "./reply-run-registry.js";

export function createReplyAgentSessionFixture() {
  const sessionKeys = new Set<string>();
  const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
    afterEach(async () => {
      // Reply completion starts asynchronous recovery-owner release. Join it before
      // deleting stores so late cleanup cannot recreate a previous case's database.
      await Promise.all(
        [...sessionKeys].map((sessionKey) => waitForReplyRunSuccessorAdmission(sessionKey, null)),
      );
      for (const dir of tempDirs.dirs) {
        await closeBranchAgentDatabasesAsync(dir);
      }
      sessionKeys.clear();
      cleanup();
    }),
  );
  return {
    sessionKeys,
    tempDirs,
    async createSessionStoreFile(
      this: void,
      entry: SessionEntry,
      sessionKey = "main",
    ): Promise<string> {
      sessionKeys.add(sessionKey);
      const dir = tempDirs.make("branch-agent-runner-");
      const storePath = join(dir, "sessions.json");
      await replaceSessionEntry({ storePath, sessionKey }, entry);
      return storePath;
    },
  };
}
