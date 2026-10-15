import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { isSqliteMaintenanceDeferred } from "../infra/sqlite-maintenance-deferral.js";
import { createDeferredCore } from "../shared/deferred.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import {
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "./agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "./agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";

// #967: the deletion-journal read is not under test here; it answers at once.
vi.mock("./agent-deletion-journal.read.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./agent-deletion-journal.read.js")>()),
  readAgentDeletionJournalStatusInWorker: async () => "absent" as const,
}));

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

async function closeDatabases() {
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeStateDatabaseForTest();
}

afterEach(closeDatabases);

it("defers incremental vacuum until every pending agent is admitted (#967)", async () => {
  const env = {
    BRANCH_STATE_DIR: tempDirs.make("branch-startup-maintenance-"),
    BRANCH_AGENT_PREPARATION_RETRY_MS: "1",
  };
  const agentIds = ["projects-manager", "builder-ash"];
  const paths = new Map(
    agentIds.map((agentId) => [agentId, openBranchAgentDatabase({ agentId, env }).path]),
  );
  await closeDatabases();
  const slow = createDeferredCore();
  let stop: (() => Promise<void>) | undefined;
  expect(isSqliteMaintenanceDeferred()).toBe(false);
  await withAgentDatabaseStartupAdmission(async (admission) => {
    const refusals = admission.defer({
      env,
      inspections: agentIds.map((agentId) => ({
        target: { agentId, path: paths.get(agentId)! },
        result: Promise.resolve({ incompatible: [], indeterminate: [] }),
      })),
      reason: "Inspection continues after the Gateway listener binds.",
    });
    recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
    stop = admission.adopt().stop;
    // Pending agents hold the deferral from the moment they are deferred.
    expect(isSqliteMaintenanceDeferred()).toBe(true);
    admission.activate({
      isCurrent: () => true,
      // Opening on a slow disk: opens run side by side, so only this agent waits.
      openAgent: async ({ agentId }) => {
        if (agentId === "projects-manager") {
          await slow.promise;
        }
      },
      prepareAgent: async () => {},
      replaceAgent: async () => {},
    });
  });
  const admitted = (agentId: string) =>
    vi.waitFor(() => expect(readAgentDatabaseAdmissionRefusal(agentId, { env })).toBeUndefined(), {
      timeout: 20_000,
      interval: 10,
    });
  try {
    await admitted("builder-ash");
    // One agent is still preparing on a slow disk: maintenance still waits.
    expect(isSqliteMaintenanceDeferred()).toBe(true);
    slow.resolve();
    await admitted("projects-manager");
    await vi.waitFor(() => expect(isSqliteMaintenanceDeferred()).toBe(false));
  } finally {
    slow.resolve();
    await stop?.();
  }
  expect(isSqliteMaintenanceDeferred()).toBe(false);
});
