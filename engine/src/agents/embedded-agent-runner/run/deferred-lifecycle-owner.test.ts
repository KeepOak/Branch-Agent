import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveReplyOperationAbortReason } from "../../../auto-reply/reply/reply-operation-abort.js";
import { rotateAgentEventLifecycleGeneration } from "../../../infra/agent-events.js";
import {
  createDiagnosticEmbeddedRunOwner,
  getDiagnosticSessionActivitySnapshot,
  markDiagnosticEmbeddedRunStarted,
  closeDiagnosticEmbeddedRunOwner,
} from "../../../logging/diagnostic-run-activity.js";
import {
  isAgentRunRestartAbortReason,
  isAgentRunSupersededAbortReason,
  resolveAgentRunErrorLifecycleFields,
} from "../../run-termination.js";
import { beginRetryWaitHandoff } from "../retry-handoff.js";
import {
  abortEmbeddedAgentRun,
  clearActiveEmbeddedRun,
  isEmbeddedAgentRunActive,
  resolveActiveEmbeddedRunOwner,
  setActiveEmbeddedRun,
  type EmbeddedAgentQueueHandle,
} from "../runs.js";
import {
  createDeferredEmbeddedRunLifecycleManager,
  createEmbeddedAttemptDeferredLifecycleOwner,
} from "./deferred-lifecycle-owner.js";

function runHandle(runId: string): EmbeddedAgentQueueHandle {
  return {
    runId,
    queueMessage: async () => undefined,
    isStreaming: () => true,
    isCompacting: () => false,
    abort: vi.fn(),
  };
}

describe("deferred logical-turn lifecycle", () => {
  const sessionId = "deferred-lifecycle-session";
  const sessionKey = "agent:main:deferred-lifecycle";
  const handles: EmbeddedAgentQueueHandle[] = [];

  afterEach(() => {
    for (const handle of handles) {
      clearActiveEmbeddedRun(sessionId, handle, sessionKey);
    }
    handles.length = 0;
  });

  it.each([
    { label: "omitted", reason: undefined },
    { label: "explicit user", reason: "user_abort" as const },
  ])("classifies $label cancellation when the caller signal stays live", ({ reason }) => {
    const caller = new AbortController();
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "cancelled-logical-run",
      sessionId,
      sessionKey,
      abortSignal: caller.signal,
    });

    manager.abort(reason);

    expect(caller.signal.aborted).toBe(false);
    expect(resolveReplyOperationAbortReason(undefined, manager.signal.reason)).toBe("user");
    expect(resolveAgentRunErrorLifecycleFields(manager.signal.reason, caller.signal)).toEqual({
      aborted: true,
      stopReason: "aborted",
    });
  });

  it.each([
    { reason: "restart" as const, matchesReason: isAgentRunRestartAbortReason },
    { reason: "superseded" as const, matchesReason: isAgentRunSupersededAbortReason },
  ])("keeps the first $reason reason after another abort", ({ reason, matchesReason }) => {
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "interrupted-logical-run",
      sessionId,
      sessionKey,
    });

    manager.abort(reason);
    manager.abort("user_abort");

    expect(matchesReason(manager.signal.reason)).toBe(true);
  });

  it("preserves an earlier caller timeout when a user abort arrives later", () => {
    const caller = new AbortController();
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "timed-out-logical-run",
      sessionId,
      sessionKey,
      abortSignal: caller.signal,
    });
    const timeout = new DOMException("Run deadline reached", "TimeoutError");

    caller.abort(timeout);
    manager.abort("user_abort");

    expect(manager.signal.reason).toBe(timeout);
    expect(resolveAgentRunErrorLifecycleFields(manager.signal.reason, caller.signal)).toEqual({
      aborted: true,
      stopReason: "timeout",
    });
  });

  it("publishes CLI cancellation authority before releasing the embedded attempt", async () => {
    const embeddedHandle = runHandle("logical-run");
    handles.push(embeddedHandle);
    setActiveEmbeddedRun(sessionId, embeddedHandle, sessionKey);
    const clearEmbedded = vi.fn(() =>
      clearActiveEmbeddedRun(sessionId, embeddedHandle, sessionKey),
    );
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "logical-run",
      sessionId,
      sessionKey,
    });
    manager.adopt({
      beginRetryWait: () => undefined,
      complete: async () => clearEmbedded(),
      discard: clearEmbedded,
    });

    manager.handoffToCli();

    expect(clearEmbedded).toHaveBeenCalledOnce();
    expect(isEmbeddedAgentRunActive(sessionId)).toBe(true);
    expect(abortEmbeddedAgentRun(sessionId)).toBe(true);
    expect(manager.signal.aborted).toBe(true);
    await manager.complete();
    expect(isEmbeddedAgentRunActive(sessionId)).toBe(false);
    expect(resolveReplyOperationAbortReason(undefined, manager.signal.reason)).toBe("user");
  });

  it("keeps the logical turn start time on the CLI owner", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000_000);
      const manager = createDeferredEmbeddedRunLifecycleManager({
        runId: "long-cli-run",
        sessionId,
        sessionKey,
      });
      // Embedded preparation and fallback can run long before the CLI takes over.
      vi.setSystemTime(1_000_000 + 5 * 60_000);

      manager.handoffToCli();

      expect(resolveActiveEmbeddedRunOwner(sessionId)?.startedAtMs).toBe(1_000_000);
      await manager.complete();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records only the accepted candidate terminal trajectory", async () => {
    const recordEvent = vi.fn();
    const flush = vi.fn(async () => undefined);
    const clearActiveRun = vi.fn();
    const discarded = createEmbeddedAttemptDeferredLifecycleOwner({
      runId: "logical-run",
      sessionId,
      diagnosticOwner: createDiagnosticEmbeddedRunOwner({ runId: "logical-run", sessionId }),
      isCurrent: () => true,
      onRetryWaitCompleted: () => {},
      trajectoryRecorder: { recordEvent, flush, describeFlushState: () => undefined },
      clearActiveRun,
    });
    discarded.recordSessionEnd({ status: "error" });
    discarded.discard();
    expect(recordEvent).not.toHaveBeenCalled();

    const accepted = createEmbeddedAttemptDeferredLifecycleOwner({
      runId: "logical-run",
      sessionId,
      diagnosticOwner: createDiagnosticEmbeddedRunOwner({ runId: "logical-run", sessionId }),
      isCurrent: () => true,
      onRetryWaitCompleted: () => {},
      trajectoryRecorder: { recordEvent, flush, describeFlushState: () => undefined },
      clearActiveRun,
    });
    accepted.recordSessionEnd({ status: "success" });
    await accepted.complete();

    expect(recordEvent).toHaveBeenCalledOnce();
    expect(recordEvent).toHaveBeenCalledWith("session.ended", { status: "success" });
    expect(flush).toHaveBeenCalledOnce();
    expect(clearActiveRun).toHaveBeenCalledTimes(2);
  });

  it.each(["abort", "timeout", "complete", "replace", "close", "authority"] as const)(
    "releases a retry wait when its owner loses authority through %s",
    async (reason) => {
      const ref = { runId: "waiting-run", sessionId, sessionKey };
      const diagnosticOwner = createDiagnosticEmbeddedRunOwner(ref);
      markDiagnosticEmbeddedRunStarted({ ...ref, owner: diagnosticOwner });
      let current = true;
      const onRetryWaitCompleted = vi.fn();
      const manager = createDeferredEmbeddedRunLifecycleManager(ref);
      manager.adopt(
        createEmbeddedAttemptDeferredLifecycleOwner({
          ...ref,
          diagnosticOwner,
          isCurrent: () => current,
          onRetryWaitCompleted,
          trajectoryRecorder: null,
          clearActiveRun: () => closeDiagnosticEmbeddedRunOwner(diagnosticOwner),
        }),
      );
      const timeout = new AbortController();
      const deadlineAtMs = Date.now() + 660_000;
      const release = manager.beginRetryWait(deadlineAtMs, timeout.signal);
      try {
        expect(getDiagnosticSessionActivitySnapshot(ref).activeRetryWaitDeadlineAtMs).toBe(
          deadlineAtMs,
        );
        if (reason === "abort") {
          manager.abort();
        } else if (reason === "timeout") {
          timeout.abort(new DOMException("Execution deadline reached", "TimeoutError"));
        } else if (reason === "complete") {
          await manager.complete();
        } else if (reason === "replace") {
          manager.adopt({
            beginRetryWait: () => undefined,
            complete: async () => {},
            discard: () => {},
          });
        } else if (reason === "close") {
          closeDiagnosticEmbeddedRunOwner(diagnosticOwner);
        } else {
          current = false;
        }
        expect(
          getDiagnosticSessionActivitySnapshot(ref).activeRetryWaitDeadlineAtMs,
        ).toBeUndefined();
      } finally {
        expect(onRetryWaitCompleted).not.toHaveBeenCalled();
        await release?.();
        await manager.complete();
      }
    },
  );

  it("does not let a completed wait release its owner's next wait", async () => {
    const ref = { runId: "reused-wait-owner", sessionId, sessionKey };
    const diagnosticOwner = createDiagnosticEmbeddedRunOwner(ref);
    markDiagnosticEmbeddedRunStarted({ ...ref, owner: diagnosticOwner });
    const manager = createDeferredEmbeddedRunLifecycleManager(ref);
    manager.adopt(
      createEmbeddedAttemptDeferredLifecycleOwner({
        ...ref,
        diagnosticOwner,
        isCurrent: () => true,
        onRetryWaitCompleted: () => {},
        trajectoryRecorder: null,
        clearActiveRun: () => closeDiagnosticEmbeddedRunOwner(diagnosticOwner),
      }),
    );
    try {
      const releaseFirst = manager.beginRetryWait(Date.now() + 660_000);
      const nextDeadline = Date.now() + 900_000;
      const releaseNext = manager.beginRetryWait(nextDeadline);
      await releaseFirst?.();
      expect(getDiagnosticSessionActivitySnapshot(ref).activeRetryWaitDeadlineAtMs).toBe(
        nextDeadline,
      );
      await releaseNext?.();
      expect(getDiagnosticSessionActivitySnapshot(ref).activeRetryWaitDeadlineAtMs).toBeUndefined();
    } finally {
      await manager.complete();
    }
  });

  it("parks a distant retry only after its deadline is durable, without aborting a streaming owner", async () => {
    const waiting = createDeferredEmbeddedRunLifecycleManager({
      runId: "waiting",
      sessionId,
      sessionKey,
    });
    const streaming = createDeferredEmbeddedRunLifecycleManager({
      runId: "streaming",
      sessionId: "stream-session",
      sessionKey: "agent:main:stream",
    });
    const close = vi.fn();
    waiting.adopt({ beginRetryWait: () => close, complete: async () => {}, discard: () => {} });
    streaming.adopt({
      beginRetryWait: () => undefined,
      complete: async () => {},
      discard: () => {},
    });
    const deadlineAtMs = Date.now() + 30 * 60 * 60 * 1000;
    const release = waiting.beginRetryWait(deadlineAtMs);
    let commit!: () => void;
    const persisted = new Promise<void>((resolve) => {
      commit = resolve;
    });
    const persist = vi.fn(() => persisted);
    const handoff = beginRetryWaitHandoff(persist);
    try {
      await Promise.resolve();
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "waiting", deadlineAtMs }),
      );
      expect(waiting.signal.aborted).toBe(false);
      const completing = release?.(true);
      expect(close).not.toHaveBeenCalled();
      commit();
      await handoff.ready;
      handoff.commit();
      await expect(completing).rejects.toThrow();
      expect(isAgentRunRestartAbortReason(waiting.signal.reason)).toBe(true);
      expect(streaming.signal.aborted).toBe(false);
      expect(close).toHaveBeenCalledOnce();
    } finally {
      handoff.stop();
      await waiting.complete();
      await streaming.complete();
    }
  });

  it("keeps a retry running if handoff persistence fails", async () => {
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "persist-failed",
      sessionId,
      sessionKey,
    });
    const close = vi.fn();
    manager.adopt({ beginRetryWait: () => close, complete: async () => {}, discard: () => {} });
    const release = manager.beginRetryWait(Date.now() + 1000);
    const handoff = beginRetryWaitHandoff(async () => {
      throw new Error("store unavailable");
    });
    try {
      await expect(handoff.ready).rejects.toThrow("store unavailable");
      expect(manager.signal.aborted).toBe(false);
      await release?.(true);
      expect(close).toHaveBeenCalledWith(true);
    } finally {
      handoff.stop();
      await manager.complete();
    }
  });

  it("parks a retry reached after handoff without cutting off the preceding step", async () => {
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "late-retry",
      sessionId,
      sessionKey,
    });
    manager.adopt({ beginRetryWait: () => () => {}, complete: async () => {}, discard: () => {} });
    const persist = vi.fn(async () => {});
    const handoff = beginRetryWaitHandoff(persist);
    try {
      await handoff.ready;
      expect(manager.signal.aborted).toBe(false);
      expect(persist).not.toHaveBeenCalled();
      handoff.commit();
      const release = manager.beginRetryWait(Date.now() + 1000);
      await release?.();
      expect(persist).toHaveBeenCalledOnce();
      expect(isAgentRunRestartAbortReason(manager.signal.reason)).toBe(true);
    } finally {
      handoff.stop();
      await manager.complete();
    }
  });

  it.each([true, false])(
    "retires a prepared retry only when handoff commits (%s)",
    async (committed) => {
      const manager = createDeferredEmbeddedRunLifecycleManager({
        runId: "prepared-wait",
        sessionId,
        sessionKey,
      });
      const close = vi.fn();
      manager.adopt({ beginRetryWait: () => close, complete: async () => {}, discard: () => {} });
      const release = manager.beginRetryWait(Date.now() + 1000);
      const persist = vi.fn(async () => {});
      const handoff = beginRetryWaitHandoff(persist);
      try {
        await handoff.ready;
        expect(persist).toHaveBeenCalledOnce();
        expect(manager.signal.aborted).toBe(false);
        const completing = release?.(true);
        expect(close).not.toHaveBeenCalled();
        if (committed) {
          handoff.commit();
          await expect(completing).rejects.toThrow();
          expect(isAgentRunRestartAbortReason(manager.signal.reason)).toBe(true);
        } else {
          handoff.stop();
          await completing;
          expect(manager.signal.aborted).toBe(false);
        }
        expect(close).toHaveBeenCalledWith(true);
      } finally {
        handoff.stop();
        await manager.complete();
      }
    },
  );

  it("does not persist a retry owned by a retired lifecycle", async () => {
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "retired-wait",
      sessionId,
      sessionKey,
    });
    manager.adopt({ beginRetryWait: () => () => {}, complete: async () => {}, discard: () => {} });
    const release = manager.beginRetryWait(Date.now() + 1000);
    rotateAgentEventLifecycleGeneration();
    const persist = vi.fn(async () => {});
    const handoff = beginRetryWaitHandoff(persist);
    try {
      await handoff.ready;
      expect(persist).not.toHaveBeenCalled();
      expect(manager.signal.aborted).toBe(false);
      handoff.commit();
      await release?.();
      await manager.checkpoint();
      expect(persist).not.toHaveBeenCalled();
    } finally {
      handoff.stop();
      await manager.complete();
    }
  });

  it("hands off a running turn at its next model-step checkpoint", async () => {
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "model-step",
      sessionId,
      sessionKey,
    });
    manager.adopt({ beginRetryWait: () => undefined, complete: async () => {}, discard: () => {} });
    const persist = vi.fn(async () => {});
    const handoff = beginRetryWaitHandoff(persist);
    try {
      await handoff.ready;
      expect(manager.signal.aborted).toBe(false);
      handoff.commit();
      await expect(manager.checkpoint()).rejects.toThrow();
      expect(persist).toHaveBeenCalledWith(expect.objectContaining({ runId: "model-step" }));
      expect(persist).toHaveBeenCalledWith(
        expect.not.objectContaining({ deadlineAtMs: expect.anything() }),
      );
      expect(isAgentRunRestartAbortReason(manager.signal.reason)).toBe(true);
    } finally {
      handoff.stop();
      await manager.complete();
    }
  });

  it("parks a native CLI retry without waiting for its distant deadline", async () => {
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "cli-retry",
      sessionId,
      sessionKey,
    });
    const diagnosticOwner = manager.handoffToCli();
    markDiagnosticEmbeddedRunStarted({
      runId: "cli-retry",
      sessionId,
      sessionKey,
      owner: diagnosticOwner,
    });
    const deadlineAtMs = Date.now() + 30 * 60 * 60 * 1000;
    const release = manager.beginRetryWait(deadlineAtMs);
    expect(release).toEqual(expect.any(Function));
    const persist = vi.fn(async () => {});
    const handoff = beginRetryWaitHandoff(persist);
    try {
      await handoff.ready;
      expect(persist).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "cli-retry", deadlineAtMs }),
      );
      expect(manager.signal.aborted).toBe(false);
      handoff.commit();
      await release?.();
      expect(isAgentRunRestartAbortReason(manager.signal.reason)).toBe(true);
    } finally {
      handoff.stop();
      await manager.complete();
    }
  });

  it("does not park a retired CLI owner through retained checkpoint callbacks", async () => {
    const manager = createDeferredEmbeddedRunLifecycleManager({
      runId: "cli-completed",
      sessionId,
      sessionKey,
    });
    manager.handoffToCli();
    await manager.complete();
    const persist = vi.fn(async () => {});
    const handoff = beginRetryWaitHandoff(persist);
    try {
      await handoff.ready;
      handoff.commit();
      await manager.checkpoint();
      expect(manager.beginRetryWait(Date.now() + 1000)).toBeUndefined();
      expect(persist).not.toHaveBeenCalled();
      expect(manager.signal.aborted).toBe(false);
    } finally {
      handoff.stop();
    }
  });
});
