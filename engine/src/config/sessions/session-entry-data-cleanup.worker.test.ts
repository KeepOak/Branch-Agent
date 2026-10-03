import { expect, it, vi } from "vitest";
import { invalidateRegisteredAgentDatabasesMemo } from "../../state/branch-agent-db-registry-listing.js";
import { openBranchAgentDatabase } from "../../state/branch-agent-db.js";
import { withBranchTestState } from "../../test-utils/branch-test-state.js";
import { writeSessionEntry } from "./session-accessor.sqlite-entry-store.js";
import { readExpiredCronRunEntriesInWorker } from "./session-entry-read-runtime.js";
import { maintenanceLane } from "./session-transcript-worker-resources.js";

it("checks the captured registry after cron data cleanup", async () => {
  await withBranchTestState({ label: "readonly-entry-cleanup" }, async ({ env, path }) => {
    const storePath = path("shared.sqlite");
    const database = openBranchAgentDatabase({ agentId: "main", path: storePath, env });
    const sessionKey = "agent:main:cron:job:run:cleanup";
    writeSessionEntry(database, sessionKey, { sessionId: "cleanup-session", updatedAt: 1 });
    const pool = maintenanceLane.pool;
    const rotate = pool.rotate.bind(pool);
    const closeResources = pool.closeResources.bind(pool);
    let cleanupCalled = false;
    const cleanup = process.versions.bun
      ? vi.spyOn(pool, "rotate").mockImplementation(async () => {
          await rotate();
          cleanupCalled = true;
          invalidateRegisteredAgentDatabasesMemo({ env });
        })
      : vi.spyOn(pool, "closeResources").mockImplementation(async (key) => {
          await closeResources(key);
          cleanupCalled = true;
          invalidateRegisteredAgentDatabasesMemo({ env });
        });
    try {
      const pending = readExpiredCronRunEntriesInWorker({
        agentId: "main",
        storePath,
        env,
        updatedBefore: 2,
      });
      await expect(pending).rejects.toThrow("registry changed");
      expect(cleanupCalled).toBe(true);
    } finally {
      cleanup.mockRestore();
    }
  });
});
