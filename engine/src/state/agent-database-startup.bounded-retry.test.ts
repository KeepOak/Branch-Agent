import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { closeStateDatabaseForTest } from "../test-utils/database-cleanup.js";
import {
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "./agent-database-admission.js";
// A namespace import: on a base without the retry request, the assertions below fail, not the import.
import * as startup from "./agent-database-startup.js";
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

const retryStartup = (agentId: string): boolean =>
  (
    startup as { retryAgentDatabaseStartupPreparation?: (agentId: string) => boolean }
  ).retryAgentDatabaseStartupPreparation?.(agentId) ?? false;

async function startDeferredPreparation(
  prepareAgent: (input: { signal: AbortSignal }) => Promise<void>,
  extraEnv: Record<string, string>,
) {
  const env = { BRANCH_STATE_DIR: tempDirs.make("branch-startup-bounded-"), ...extraEnv };
  const agentId = "tk";
  const path = openBranchAgentDatabase({ agentId, env }).path;
  await closeDatabases();
  const clean: BranchDatabaseSchemaPreflight = { incompatible: [], indeterminate: [] };
  const openAgent = vi.fn(async () => {});
  const replaceAgent = vi.fn(async (_input: { agentId: string; reason: Error }) => {});
  let stop: (() => Promise<void>) | undefined;
  await startup.withAgentDatabaseStartupAdmission(async (admission) => {
    const refusals = admission.defer({
      env,
      inspections: [{ target: { agentId, path }, result: Promise.resolve(clean) }],
      reason: "Inspection continues after the Gateway listener binds.",
    });
    recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
    stop = admission.adopt().stop;
    admission.activate({ isCurrent: () => true, openAgent, prepareAgent, replaceAgent });
  });
  const admitted = () =>
    vi.waitFor(() => expect(readAgentDatabaseAdmissionRefusal(agentId, { env })).toBeUndefined(), {
      timeout: 10000,
    });
  return { env, agentId, openAgent, replaceAgent, admitted, stop: stop! };
}

describe("agent database startup preparation that keeps failing", () => {
  it("keeps recovering on its own past twelve failures, replacing the preparation before every retry", async () => {
    let calls = 0;
    const prepareAgent = vi.fn(async () => {
      calls += 1;
      // Six failures, a restart; six more, another restart; then the failure clears by itself.
      if (calls <= 14) {
        throw new Error(NOT_PUBLISHED);
      }
    });
    const started = await startDeferredPreparation(prepareAgent, {
      BRANCH_AGENT_PREPARATION_RETRY_MS: "1",
    });
    try {
      await started.admitted();
      expect(prepareAgent).toHaveBeenCalledTimes(15);
      // Every retry, the two restarts from scratch included, first replaced what the failed
      // attempt left running (its model builds).
      expect(started.replaceAgent).toHaveBeenCalledTimes(14);
      expect(started.replaceAgent).toHaveBeenCalledWith(
        expect.objectContaining({ agentId: "tk", reason: expect.any(Error) }),
      );
    } finally {
      await started.stop();
    }
  });

  it("stops retrying after five failed starts in a row, needs attention, and starts a fresh series when asked", async () => {
    let fail = true;
    const prepareAgent = vi.fn(async () => {
      if (fail) {
        throw new Error(NOT_PUBLISHED);
      }
    });
    const started = await startDeferredPreparation(prepareAgent, {
      BRANCH_AGENT_PREPARATION_RETRY_MS: "1",
    });
    const preparation = () =>
      readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env })?.preparation;
    try {
      // Five starts (the first and four restarts from scratch) of six failed attempts each.
      await vi.waitFor(() => expect(preparation()).toMatchObject({ state: "needs-attention" }), {
        timeout: 20000,
      });
      expect(preparation()).toEqual({ state: "needs-attention", failures: 30, restarts: 4 });
      expect(prepareAgent).toHaveBeenCalledTimes(30);
      // What the last attempt left running is still replaced, once per failure.
      await vi.waitFor(() => expect(started.replaceAgent).toHaveBeenCalledTimes(30));
      // Nothing retries it on its own any more.
      await new Promise((resolve) => {
        setTimeout(resolve, 300);
      });
      expect(prepareAgent).toHaveBeenCalledTimes(30);

      // A retry request starts it again with a fresh series: five more failed starts before it stops.
      expect(retryStartup(started.agentId)).toBe(true);
      await vi.waitFor(() => expect(prepareAgent.mock.calls.length).toBeGreaterThan(30));
      expect(preparation()?.state).toBe("retrying");
      await vi.waitFor(
        () => expect(preparation()).toMatchObject({ state: "needs-attention", failures: 60 }),
        { timeout: 20000 },
      );
      expect(prepareAgent).toHaveBeenCalledTimes(60);

      fail = false;
      expect(retryStartup(started.agentId)).toBe(true);
      await started.admitted();
      expect(prepareAgent).toHaveBeenCalledTimes(61);
    } finally {
      await started.stop();
    }
  });

  it("reports retrying while it keeps failing, before its fifth failed start", async () => {
    let fail = true;
    const prepareAgent = vi.fn(async () => {
      if (fail) {
        throw new Error(NOT_PUBLISHED);
      }
    });
    const started = await startDeferredPreparation(prepareAgent, {
      // Slow enough that it is still short of its fifth failed start when the failure clears.
      BRANCH_AGENT_PREPARATION_RETRY_MS: "5",
    });
    try {
      await vi.waitFor(
        () => {
          const refusal = readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env });
          expect(refusal).toMatchObject({
            code: "agent-database-inspection-pending",
            preparation: { state: "retrying" },
          });
          // Past the second restart from scratch, where it used to stop and wait for a person.
          expect(refusal?.preparation?.restarts).toBeGreaterThanOrEqual(2);
        },
        { timeout: 10000 },
      );
      // The second restart is recorded once the twelfth attempt has failed, before the next starts.
      const tried = prepareAgent.mock.calls.length;
      expect(tried).toBeGreaterThanOrEqual(12);
      // Still trying on its own: no retry request is needed to reach the next attempt.
      await vi.waitFor(() => expect(prepareAgent.mock.calls.length).toBeGreaterThan(tried + 1), {
        timeout: 10000,
      });
      fail = false;
      await started.admitted();
    } finally {
      await started.stop();
    }
  });

  it("starts a running, hung attempt again from scratch when asked, not only during the backoff", async () => {
    const hung = Promise.withResolvers<void>();
    let calls = 0;
    const prepareAgent = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error(NOT_PUBLISHED);
      }
      if (calls === 2) {
        hung.resolve();
        // Never settles and ignores its abort signal: only the retry request can end the attempt
        // (its watchdog is two minutes).
        await new Promise(() => {});
      }
    });
    const started = await startDeferredPreparation(prepareAgent, {
      BRANCH_AGENT_PREPARATION_RETRY_MS: "1",
    });
    try {
      await hung.promise;
      expect(retryStartup(started.agentId)).toBe(true);
      await started.admitted();
      expect(prepareAgent).toHaveBeenCalledTimes(3);
      // Once after the first failure, once more for the hung attempt the request ended.
      expect(started.replaceAgent).toHaveBeenCalledTimes(2);
      expect(retryStartup(started.agentId)).toBe(false);
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
      await vi.waitFor(() => expect(prepareAgent).toHaveBeenCalledTimes(1), { timeout: 10000 });
      await vi.waitFor(
        () =>
          expect(
            readAgentDatabaseAdmissionRefusal(started.agentId, { env: started.env }),
          ).toMatchObject({ preparation: { state: "retrying", failures: 1 } }),
        { timeout: 10000 },
      );
      expect(retryStartup(started.agentId)).toBe(true);
      await started.admitted();
      expect(prepareAgent).toHaveBeenCalledTimes(2);
      expect(started.replaceAgent).toHaveBeenCalledTimes(1);
      expect(retryStartup(started.agentId)).toBe(false);
    } finally {
      await started.stop();
    }
  });
});
