// Activity snapshots used for staged updates must ignore retained dead reply slots.
import { afterEach, describe, expect, it } from "vitest";
import { getActiveEmbeddedRunCount } from "../agents/embedded-agent-runner/active-run-projections.js";
import { getTotalPendingReplies } from "../auto-reply/reply/dispatcher-registry.js";
import { createReplyDispatcher } from "../auto-reply/reply/reply-dispatcher.js";
import { replyRunRegistry } from "../auto-reply/reply/reply-run-registry.js";
import { getActiveReplyRunCount } from "../auto-reply/reply/reply-run-registry.registry.js";
import { expireStaleReplyOperation } from "../auto-reply/reply/reply-run-registry.state.js";
import { createTestReplyOperation } from "../auto-reply/reply/reply-run-registry.test-helpers.js";
import { testing } from "../auto-reply/reply/reply-run-registry.test-support.js";
import { createGatewayActiveWorkSnapshot } from "./gateway-active-work.js";

let activeDispatcher: ReturnType<typeof createReplyDispatcher> | undefined;

function idleInspectors() {
  return {
    getQueueSize: () => 0,
    getBackgroundExecSessions: () => 0,
    getCronRuns: () => 0,
    getAgentRuns: () => 0,
    getAcpRuns: () => 0,
    getMediaRuns: () => 0,
    getRootRequests: () => 0,
    getSessionAdmissions: () => 0,
    getSessionMutations: () => 0,
    getChatRuns: () => 0,
    getQueuedTurns: () => 0,
    getTerminalPersistence: () => 0,
    getTerminalSessions: () => 0,
  };
}

function retainedBackend() {
  return {
    kind: "embedded" as const,
    cancel: () => {},
    isStreaming: () => true,
  };
}

function snapshotActivity() {
  return createGatewayActiveWorkSnapshot(idleInspectors());
}

afterEach(() => {
  activeDispatcher?.markComplete();
  activeDispatcher = undefined;
  testing.resetReplyRunRegistry();
});

describe("gateway active-work live reply counts", () => {
  it("counts a live reply run as embedded work", () => {
    const operation = createTestReplyOperation({
      sessionKey: "agent:main:update-idle-live",
      sessionId: "session-update-idle-live",
    });
    operation.setPhase("running");

    expect(replyRunRegistry.get(operation.key)).toBe(operation);
    expect(getActiveReplyRunCount()).toBe(1);
    expect(getActiveEmbeddedRunCount()).toBe(1);
    expect(snapshotActivity().counts.embeddedRuns).toBe(1);
    expect(snapshotActivity().idle).toBe(false);
  });

  it("does not count a finished reply that still occupies its slot", () => {
    const operation = createTestReplyOperation({
      sessionKey: "agent:main:update-idle-finished",
      sessionId: "session-update-idle-finished",
    });
    operation.setPhase("running");
    operation.retainFailureUntilComplete();
    operation.fail("run_failed");

    expect(operation.result).toEqual({ kind: "failed", code: "run_failed" });
    expect(replyRunRegistry.get(operation.key)).toBe(operation);
    expect(getActiveReplyRunCount()).toBe(0);
    expect(getActiveEmbeddedRunCount()).toBe(0);
    expect(snapshotActivity().counts.embeddedRuns).toBe(0);
  });

  it("does not count an aborted reply that still occupies its slot", () => {
    const operation = createTestReplyOperation({
      sessionKey: "agent:main:update-idle-aborted",
      sessionId: "session-update-idle-aborted",
    });
    operation.setPhase("running");
    operation.attachBackend(retainedBackend());
    expect(operation.abortByUser()).toBe(true);

    expect(operation.result).toEqual({ kind: "aborted", code: "aborted_by_user" });
    expect(replyRunRegistry.get(operation.key)).toBe(operation);
    expect(getActiveReplyRunCount()).toBe(0);
    expect(getActiveEmbeddedRunCount()).toBe(0);
    expect(snapshotActivity().counts.embeddedRuns).toBe(0);
  });

  it("does not count a stale-expired reply that still occupies its slot", () => {
    const operation = createTestReplyOperation({
      sessionKey: "agent:main:update-idle-stale",
      sessionId: "session-update-idle-stale",
    });
    operation.setPhase("running");
    operation.attachBackend(retainedBackend());
    expect(expireStaleReplyOperation(operation, "no_activity")).toBe(false);

    expect(operation.result).toEqual({ kind: "failed", code: "run_stalled" });
    expect(replyRunRegistry.get(operation.key)).toBe(operation);
    expect(getActiveReplyRunCount()).toBe(0);
    expect(getActiveEmbeddedRunCount()).toBe(0);
    expect(snapshotActivity().counts.embeddedRuns).toBe(0);
  });

  it("does not count a leftover pending-reply reservation with no live owner", () => {
    const sessionKey = "agent:main:update-idle-reservation";
    activeDispatcher = createReplyDispatcher({
      deliver: async () => {},
      silentReplyContext: { sessionKey },
    });
    const operation = createTestReplyOperation({
      sessionKey,
      sessionId: "session-update-idle-reservation",
    });
    operation.setPhase("running");
    operation.attachBackend(retainedBackend());
    expect(expireStaleReplyOperation(operation, "no_activity")).toBe(false);

    expect(getTotalPendingReplies()).toBe(0);
    expect(snapshotActivity().counts.pendingReplies).toBe(0);
  });

  it("still counts a new reservation beside a retained dead slot", () => {
    const dead = createTestReplyOperation({
      sessionKey: "agent:main:update-idle-dead-slot",
      sessionId: "session-update-idle-dead-slot",
    });
    dead.setPhase("running");
    dead.attachBackend(retainedBackend());
    expect(expireStaleReplyOperation(dead, "no_activity")).toBe(false);

    activeDispatcher = createReplyDispatcher({ deliver: async () => {} });
    expect(getTotalPendingReplies()).toBe(1);
    expect(snapshotActivity().counts.pendingReplies).toBe(1);
  });

  it("does not count leftover pending after enqueue when the owner is dead", async () => {
    const sessionKey = "agent:main:update-idle-after-enqueue";
    activeDispatcher = createReplyDispatcher({
      deliver: async () => {},
      silentReplyContext: { sessionKey },
    });
    const operation = createTestReplyOperation({
      sessionKey,
      sessionId: "session-update-idle-after-enqueue",
    });
    operation.setPhase("running");
    operation.attachBackend(retainedBackend());
    expect(activeDispatcher.sendFinalReply({ text: "done" })).toBe(true);
    await activeDispatcher.waitForIdle();
    expect(getTotalPendingReplies()).toBe(1);

    expect(expireStaleReplyOperation(operation, "no_activity")).toBe(false);
    expect(getTotalPendingReplies()).toBe(0);
    expect(snapshotActivity().counts.pendingReplies).toBe(0);
  });
});
