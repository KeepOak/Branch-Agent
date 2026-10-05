import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import {
  AgentDatabasePreparationSupersededError,
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "./agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "./agent-database-startup.js";
import {
  closeBranchAgentDatabasesAsync,
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
} from "./branch-agent-db.js";
import type { BranchDatabaseSchemaPreflight } from "./branch-database-preflight.types.js";

async function closeDatabases() {
  // Join worker ownership before Windows can remove the temporary state directory.
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeStateDatabaseForTest();
}

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(closeDatabases);

async function startDeferredPreparation(prepareAgent: () => Promise<void>) {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-startup-superseded-") };
  const agentId = "tk";
  const path = openBranchAgentDatabase({ agentId, env }).path;
  await closeDatabases();
  const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
  const openAgent = vi.fn(async () => {});
  let stop: (() => Promise<void>) | undefined;
  await withAgentDatabaseStartupAdmission(async (admission) => {
    const refusals = admission.defer({
      env,
      inspections: [{ target: { agentId, path }, result: Promise.resolve(clean) }],
      reason: "Inspection continues after the Gateway listener binds.",
    });
    recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
    stop = admission.adopt().stop;
    admission.activate({ isCurrent: () => true, openAgent, prepareAgent });
  });
  return { env, agentId, openAgent, stop: stop! };
}

describe("agent database startup preparation", () => {
  it("retries preparation superseded by a config reload and admits the agent", async () => {
    const prepareAgent = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(
        new AgentDatabasePreparationSupersededError("Agent tk startup preparation was superseded"),
      )
      .mockResolvedValue(undefined);
    const started = await startDeferredPreparation(prepareAgent);
    try {
      expect(
        readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
      ).toMatchObject({ code: "agent-database-inspection-pending" });
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toBeUndefined(),
        { timeout: 10000 },
      );
      expect(prepareAgent).toHaveBeenCalledTimes(2);
      expect(started.openAgent).toHaveBeenCalledTimes(2);
    } finally {
      await started.stop();
    }
  });

  it("keeps the agent degraded when preparation fails for another reason", async () => {
    const prepareAgent = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("Agent tk model preparation has not published"));
    const started = await startDeferredPreparation(prepareAgent);
    try {
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toMatchObject({
            code: "agent-database-inspection-failed",
            reason: expect.stringContaining("model preparation has not published"),
          }),
        { timeout: 10000 },
      );
      expect(prepareAgent).toHaveBeenCalledTimes(1);
    } finally {
      await started.stop();
    }
  });
});
