// #967: a finished helper's result waits for its parent's admission instead of being dropped.
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../../test/helpers/temp-dir.js";
import {
  createAgentDatabaseInspectionRefusal,
  recordAgentDatabaseAdmissions,
} from "../../../state/agent-database-admission.js";
import {
  holdDeliveryWindowForAdmission,
  isRequesterAwaitingAdmission,
  resolveDeferredCleanupDecision,
} from "./subagent-registry-cleanup.js";
import type { SubagentRunRecord } from "./subagent-registry.types.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const MINUTE = 60_000;
const WINDOW_MS = 30 * MINUTE;

function completedHelper(endedAt: number): SubagentRunRecord {
  return {
    runId: "run-helper",
    childSessionKey: "agent:projects-manager:subagent:helper",
    requesterSessionKey: "agent:projects-manager:main",
    requesterDisplayKey: "main",
    requesterAgentId: "projects-manager",
    task: "investigate",
    cleanup: "keep",
    createdAt: 0,
    expectsCompletionMessage: true,
    execution: { status: "terminal", endedAt },
    delivery: { status: "pending", windowStartedAt: endedAt, deadlineAt: endedAt + WINDOW_MS },
  };
}

function decide(entry: SubagentRunRecord, now: number, requesterAwaitingAdmission: boolean) {
  return resolveDeferredCleanupDecision({
    entry,
    now,
    requesterAwaitingAdmission,
    activeDescendantRuns: 0,
    announceExpiryMs: 5 * MINUTE,
    announceCompletionHardExpiryMs: WINDOW_MS,
    deferDescendantDelayMs: 1_000,
    resolveAnnounceRetryDelayMs: () => 5 * MINUTE,
  });
}

describe("subagent completion while the parent is not admitted", () => {
  it("keeps the result queued through a 45-minute admission and still delivers after it", () => {
    const entry = completedHelper(0);
    // The parent refuses every attempt ("has not completed startup inspection") for 45 minutes.
    for (let now = 5 * MINUTE; now <= 45 * MINUTE; now += 5 * MINUTE) {
      expect(decide(entry, now, true).kind).toBe("retry");
      holdDeliveryWindowForAdmission(entry.delivery!, now, WINDOW_MS);
    }
    // On main the 30-minute window ran out while the parent was locked out: the result was dropped.
    // Now the parent is admitted at 50 minutes and the result is still due.
    expect(decide(entry, 50 * MINUTE, false).kind).toBe("retry");
    // A parent that never takes it within a full window after admission still expires.
    expect(decide(entry, 45 * MINUTE + WINDOW_MS, false)).toMatchObject({
      kind: "give-up",
      reason: "expiry",
    });
  });

  it("never holds a delivery that failed permanently", () => {
    const entry = completedHelper(0);
    entry.delivery!.disposition = "permanent_failure";
    expect(decide(entry, MINUTE, true)).toMatchObject({ kind: "give-up", reason: "permanent_failure" });
  });

  it("reads the parent's pending startup admission", () => {
    const env = { BRANCH_STATE_DIR: tempDirs.make("branch-announce-admission-") };
    const entry = completedHelper(0);
    expect(isRequesterAwaitingAdmission(entry, { env })).toBe(false);
    recordAgentDatabaseAdmissions(
      [
        createAgentDatabaseInspectionRefusal({
          agentId: "projects-manager",
          paths: [],
          pending: true,
          reason: "Agent projects-manager has not completed startup inspection and preparation.",
        }),
      ],
      { env, source: "startup" },
    );
    expect(isRequesterAwaitingAdmission(entry, { env })).toBe(true);
    // A database that failed for good needs Doctor; waiting for it would hold the result forever.
    recordAgentDatabaseAdmissions(
      [
        createAgentDatabaseInspectionRefusal({
          agentId: "projects-manager",
          paths: [],
          reason: "corrupt",
        }),
      ],
      { env, source: "startup" },
    );
    expect(isRequesterAwaitingAdmission(entry, { env })).toBe(false);
    recordAgentDatabaseAdmissions([], { env, source: "startup" });
    expect(isRequesterAwaitingAdmission(entry, { env })).toBe(false);
  });
});
