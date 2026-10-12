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

// The journal read runs in a real worker, whose speed depends on the machine. A stage limit counts
// that time, so on a slow runner the lane test expired attempts that had not hung. Answer at once:
// these tests are about preparation and the lane, not the journal.
vi.mock("./agent-deletion-journal.read.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./agent-deletion-journal.read.js")>();
  return {
    ...actual,
    readAgentDeletionJournalStatusInWorker: async () => "absent" as const,
  };
});

async function closeDatabases() {
  // Join worker ownership before Windows can remove the temporary state directory.
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeStateDatabaseForTest();
}

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(closeDatabases);

async function startDeferredPreparation(
  prepareAgent: () => Promise<void>,
  extraEnv: Record<string, string> = {},
) {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-startup-superseded-"), ...extraEnv };
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

  it("retries a degraded preparation with backoff and admits the agent", async () => {
    const prepareAgent = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Agent tk model preparation has not published"))
      .mockResolvedValue(undefined);
    const started = await startDeferredPreparation(prepareAgent);
    try {
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
  it("expires only an attempt that hangs while holding the lane, then retries and admits the agent", async () => {
    // A hang that ignores the abort (as a stuck secret resolution did on the owner's app) must not
    // hold the preparation lane or keep the agent pending.
    const prepareAgent = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(() => {}))
      .mockResolvedValue(undefined);
    const started = await startDeferredPreparation(prepareAgent, {
      BRANCH_AGENT_PREPARATION_ATTEMPT_MS: "200",
    });
    try {
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toBeUndefined(),
        { timeout: 15000 },
      );
      expect(prepareAgent).toHaveBeenCalledTimes(2);
    } finally {
      await started.stop();
    }
  });
});
