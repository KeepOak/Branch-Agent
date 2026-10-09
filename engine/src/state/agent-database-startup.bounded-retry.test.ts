import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import {
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "./agent-database-admission.js";
import {
  retryAgentDatabaseStartupPreparation,
  withAgentDatabaseStartupAdmission,
} from "./agent-database-startup.js";
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
    let release!: () => void;
    const restarted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prepareAgent = vi.fn(async () => {
      calls += 1;
      if (calls <= 6) {
        throw new Error(NOT_PUBLISHED);
      }
      // The restarted attempt holds until the test has read the status it left.
      await restarted;
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
            preparation: { state: "retrying", failures: 6, restarts: 1 },
          }),
        { timeout: 10000 },
      );
      release();
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

  it("stops retrying once the restarted preparation fails as often again, and says it needs a restart", async () => {
    let fail = true;
    const prepareAgent = vi.fn(async () => {
      if (fail) {
        throw new Error(NOT_PUBLISHED);
      }
    });
    const started = await startDeferredPreparation(prepareAgent, {
      BRANCH_AGENT_PREPARATION_RETRY_MS: "5",
    });
    try {
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toMatchObject({
            code: "agent-database-inspection-pending",
            preparation: { state: "needs-restart", failures: 12, restarts: 1 },
          }),
        { timeout: 10000 },
      );
      // No timer retries it any more: well past the backoff it has still been tried 12 times.
      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
      expect(prepareAgent).toHaveBeenCalledTimes(12);
      // The window's Retry (agents.retryStartup) starts it again from scratch.
      fail = false;
      expect(retryAgentDatabaseStartupPreparation(started.agentId)).toBe(true);
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toBeUndefined(),
        { timeout: 10000 },
      );
      expect(prepareAgent).toHaveBeenCalledTimes(13);
      expect(retryAgentDatabaseStartupPreparation(started.agentId)).toBe(false);
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
