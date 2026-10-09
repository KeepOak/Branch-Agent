import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
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
import type { BranchDatabaseSchemaPreflight } from "./branch-database-preflight.types.js";

async function closeDatabases() {
  // Join worker ownership before Windows can remove the temporary state directory.
  await closeBranchAgentDatabasesAsync();
  closeBranchAgentDatabasesForTest();
  await closeStateDatabaseForTest();
}

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(closeDatabases);

const NOT_PUBLISHED = "Agent tk model preparation has not published";

async function startDeferredPreparation(
  prepareAgent: () => Promise<void>,
  extraEnv: Record<string, string>,
) {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-startup-bounded-"), ...extraEnv };
  const agentId = "tk";
  const path = openBranchAgentDatabase({ agentId, env }).path;
  await closeDatabases();
  const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
  const openAgent = vi.fn(async () => {});
  let stop: (() => Promise<void>) | undefined;
  let retryNow: ((agentId: string) => boolean) | undefined;
  await withAgentDatabaseStartupAdmission(async (admission) => {
    const refusals = admission.defer({
      env,
      inspections: [{ target: { agentId, path }, result: Promise.resolve(clean) }],
      reason: "Inspection continues after the Gateway listener binds.",
    });
    recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
    stop = admission.adopt().stop;
    retryNow = (id) => admission.retryNow(id);
    admission.activate({ isCurrent: () => true, openAgent, prepareAgent });
  });
  return { env, agentId, openAgent, stop: stop!, retryNow: retryNow! };
}

describe("agent database startup preparation that keeps failing", () => {
  it("backs off, then starts the preparation again from scratch instead of retrying it forever", async () => {
    let calls = 0;
    const prepareAgent = vi.fn(async () => {
      calls += 1;
      if (calls <= 6) {
        throw new Error(NOT_PUBLISHED);
      }
    });
    const started = await startDeferredPreparation(prepareAgent, {
      BRANCH_AGENT_PREPARATION_RETRY_MS: "10",
    });
    try {
      // While it retries, the pending refusal says so, for the window's status line.
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toMatchObject({
            code: "agent-database-inspection-pending",
            preparation: { failures: 6, restarts: 1 },
          }),
        { timeout: 10000 },
      );
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toBeUndefined(),
        { timeout: 10000 },
      );
      expect(prepareAgent).toHaveBeenCalledTimes(7);
    } finally {
      await started.stop();
    }
  });

  it("retries now, from scratch, when asked during the backoff", async () => {
    const prepareAgent = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error(NOT_PUBLISHED))
      .mockResolvedValue(undefined);
    // A one-minute backoff: only the retry request can admit the agent within the test.
    const started = await startDeferredPreparation(prepareAgent, {
      BRANCH_AGENT_PREPARATION_RETRY_MS: "60000",
    });
    try {
      await vi.waitFor(() => expect(started.retryNow(started.agentId)).toBe(true), {
        timeout: 10000,
      });
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toBeUndefined(),
        { timeout: 10000 },
      );
      expect(prepareAgent).toHaveBeenCalledTimes(2);
      expect(started.retryNow(started.agentId)).toBe(false);
    } finally {
      await started.stop();
    }
  });
});
