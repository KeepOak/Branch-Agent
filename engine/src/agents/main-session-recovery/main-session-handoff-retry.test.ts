// Isolated handoff regressions: keep the complete recovery suite out of the PR's timed lane.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDeferred, withinTest } from "../../../test/helpers/promise.js";
import {
  listSessionEntriesCore,
  loadSessionEntry,
  replaceSessionEntry,
} from "../../config/sessions/session-accessor.js";
import type { GatewayRecoveryRuntime } from "../../gateway/server-instance-runtime.types.js";
import {
  getAgentEventLifecycleGeneration,
  resetAgentEventsForTest,
} from "../../infra/agent-events.js";
import * as gatewayWorkAdmission from "../../process/gateway-work-admission.js";
import {
  getActiveGatewayRootWorkCount,
  resetGatewayWorkAdmission,
} from "../../process/gateway-work-admission.js";
import { beginSessionWorkAdmission } from "../../sessions/session-lifecycle-admission.js";
import { cleanupSessionStateForTest } from "../../test-utils/session-state-cleanup.js";
import {
  createSessionEntry,
  type SessionEntryFixture,
} from "../subagent-test-fixtures.test-helpers.js";
import { createRecoveryRuntimeFixture } from "./main-session-recovery-runtime.test-support.js";
import { createRestartRecoveryTranscriptFixture } from "./main-session-restart-recovery-fixture.test-support.js";
import {
  makeToolResultMessage,
  makeUserMessage,
} from "./main-session-restart-recovery-transcript.test-support.js";
import {
  markRestartAbortedMainSessions,
  recoverRestartAbortedMainSessions as recoverBase,
  scheduleRestartAbortedMainSessionRecovery as scheduleBase,
} from "./main-session-restart-recovery.js";

const callGateway = vi.fn(async (_request: unknown) => ({ runId: "run-resumed" }));
const sendRecoveryNotice = vi.fn<GatewayRecoveryRuntime["sendRecoveryNotice"]>(async () => ({
  suppressed: false,
}));
let dispatchSettlement = createDeferred();
const runtime = createRecoveryRuntimeFixture({
  callGateway,
  getDispatchSettlement: () => dispatchSettlement.promise,
  sendRecoveryNotice,
});
const recoverRestartAbortedMainSessions = (
  params: Omit<Parameters<typeof recoverBase>[0], "gatewayRuntime">,
) => recoverBase({ ...params, gatewayRuntime: runtime });
const scheduleRestartAbortedMainSessionRecovery = (
  params: Omit<Parameters<typeof scheduleBase>[0], "gatewayRuntime">,
) => scheduleBase({ ...params, gatewayRuntime: runtime });
let tmpDir: string;
const resolveGatewayContext = () => undefined;
const readStore = (storePath: string) =>
  Object.fromEntries(
    listSessionEntriesCore({ storePath }).map(({ sessionKey, entry }) => [sessionKey, entry]),
  );
const { writeTranscript } = createRestartRecoveryTranscriptFixture(readStore);
beforeEach(async () => {
  vi.clearAllMocks();
  callGateway.mockReset();
  callGateway.mockImplementation(async () => ({ runId: "run-resumed" }));
  dispatchSettlement = createDeferred();
  resetAgentEventsForTest();
  resetGatewayWorkAdmission();
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "branch-handoff-retry-"));
});
afterEach(async () => {
  resetGatewayWorkAdmission();
  await cleanupSessionStateForTest({ stateDir: tmpDir });
  await fs.rm(tmpDir, { recursive: true, force: true });
});
async function makeSessionsDir() {
  const dir = path.join(tmpDir, "agents", "main", "sessions");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}
async function writeStore(sessionsDir: string, store: Record<string, SessionEntryFixture>) {
  await Promise.all(
    Object.entries(store).map(([sessionKey, entry]) =>
      replaceSessionEntry(
        { sessionKey, storePath: path.join(sessionsDir, "sessions.json") },
        createSessionEntry(entry),
      ),
    ),
  );
}
function runningSessionEntry(sessionId: string) {
  return createSessionEntry({ sessionId, updatedAt: Date.now() - 10_000, status: "running" });
}
function activeRestartRun() {
  return {
    sessionKey: "agent:main:main",
    sessionId: "main-session",
    runId: "restart-run",
    lifecycleGeneration: getAgentEventLifecycleGeneration(),
  };
}
async function makeMainSessionFixture(overrides: SessionEntryFixture = {}) {
  const sessionsDir = await makeSessionsDir();
  await writeStore(sessionsDir, {
    "agent:main:main": {
      sessionId: "main-session",
      permissionMode: "guarded",
      updatedAt: Date.now() - 10_000,
      status: "running",
      abortedLastRun: true,
      ...overrides,
    },
  });
  return { sessionsDir, storePath: path.join(sessionsDir, "sessions.json") };
}
async function writeCompletedToolTranscript(sessionsDir: string) {
  await writeTranscript(sessionsDir, "main-session", [
    makeUserMessage("run the tool"),
    { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "exec" }] },
    makeToolResultMessage(),
  ]);
}

function observeRecoveryRootCompletions(
  expectedOrigin: "main-session:startup-recovery" | "main-session:restart-recovery",
  expectedCount: number,
) {
  const completed = createDeferred();
  const admit = gatewayWorkAdmission.runWithGatewayIndependentRootWorkAdmission;
  let count = 0;
  const spy = vi
    .spyOn(gatewayWorkAdmission, "runWithGatewayIndependentRootWorkAdmission")
    .mockImplementation(
      async <T>(run: () => Promise<T>, origin?: string, signal?: AbortSignal): Promise<T> => {
        try {
          return await admit(run, origin, signal);
        } finally {
          if (origin === expectedOrigin && ++count === expectedCount) {
            completed.resolve();
          }
        }
      },
    );
  return { completed: completed.promise, restore: () => spy.mockRestore() };
}

describe("main-session handoff retry", () => {
  it("marks a handed-off retry without marking an unrelated active admission", async () => {
    const sessionsDir = await makeSessionsDir();
    const storePath = path.join(sessionsDir, "sessions.json");
    await writeStore(sessionsDir, {
      "agent:main:main": runningSessionEntry("main-session"),
      "agent:main:streaming": runningSessionEntry("streaming-session"),
    });
    const admission = await beginSessionWorkAdmission({
      resolveGatewayContext,
      scope: storePath,
      identities: ["agent:main:streaming", "streaming-session"],
      assertAllowed: () => undefined,
    });
    const retryAtMs = Date.now() + 180_000;
    try {
      await expect(
        markRestartAbortedMainSessions({
          resolveGatewayContext,
          stateDir: tmpDir,
          activeRuns: [activeRestartRun()],
          onlyActiveRuns: true,
          retryAtMs,
        }),
      ).resolves.toEqual({ marked: 1, skipped: 0 });
      const store = readStore(storePath);
      expect(store["agent:main:main"]).toMatchObject({
        abortedLastRun: true,
        restartRecoveryRetryAtMs: retryAtMs,
      });
      expect(store["agent:main:streaming"]?.abortedLastRun).not.toBe(true);
      expect(store["agent:main:streaming"]?.restartRecoveryRetryAtMs).toBeUndefined();
      // A rolled-back wait may continue here, then hand off at a normal step.
      // That boundary must not inherit the former retry's distant deadline.
      await markRestartAbortedMainSessions({
        resolveGatewayContext,
        stateDir: tmpDir,
        activeRuns: [activeRestartRun()],
        onlyActiveRuns: true,
      });
      expect(readStore(storePath)["agent:main:main"]?.restartRecoveryRetryAtMs).toBeUndefined();
    } finally {
      admission.release();
    }
  });

  it("preserves a handed-off retry deadline without dispatching or charging an attempt early", async () => {
    const deadlineAtMs = Date.now() + 30 * 60 * 60 * 1000;
    const { sessionsDir, storePath } = await makeMainSessionFixture({
      restartRecoveryRetryAtMs: deadlineAtMs,
    });
    await writeCompletedToolTranscript(sessionsDir);
    const result = await recoverRestartAbortedMainSessions({ cfg: {}, stateDir: tmpDir });
    expect(result).toMatchObject({
      started: 0,
      settled: 0,
      failed: 0,
      skipped: 1,
      retryAtMs: deadlineAtMs,
    });
    expect(callGateway).not.toHaveBeenCalled();
    expect(loadSessionEntry({ sessionKey: "agent:main:main", storePath })).toMatchObject({
      restartRecoveryRetryAtMs: deadlineAtMs,
    });
    const entry = loadSessionEntry({ sessionKey: "agent:main:main", storePath });
    expect(entry?.mainRestartRecovery?.chargedAttempts ?? 0).toBe(0);
    await replaceSessionEntry(
      { sessionKey: "agent:main:main", storePath },
      { ...entry!, restartRecoveryRetryAtMs: Date.now() - 1 },
    );
    await recoverRestartAbortedMainSessions({ cfg: {}, stateDir: tmpDir });
    expect(callGateway).toHaveBeenCalledOnce();
  });

  it("resumes a handed-off retry at its deadline with no active root during the wait", async () => {
    const deadlineAtMs = Date.now() + 180_000;
    const { sessionsDir } = await makeMainSessionFixture({
      restartRecoveryRetryAtMs: deadlineAtMs,
    });
    await writeCompletedToolTranscript(sessionsDir);
    vi.useFakeTimers();
    const attempts = observeRecoveryRootCompletions("main-session:startup-recovery", 1);
    const recovery = scheduleRestartAbortedMainSessionRecovery({
      getConfig: () => ({}),
      stateDir: tmpDir,
      delayMs: 0,
    });
    try {
      await attempts.completed;
      expect(getActiveGatewayRootWorkCount()).toBe(0);
      expect(callGateway).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(Math.max(0, deadlineAtMs - Date.now() - 1));
      expect(callGateway).not.toHaveBeenCalled();
      const dispatched = createDeferred();
      vi.mocked(callGateway).mockImplementationOnce(async () => {
        dispatched.resolve();
        return { runId: "run-resumed" };
      });
      await vi.advanceTimersByTimeAsync(1);
      await dispatched.promise;
      expect(callGateway).toHaveBeenCalledOnce();
    } finally {
      dispatchSettlement.resolve();
      await recovery.stop();
      attempts.restore();
      vi.useRealTimers();
    }
  });

  it("cancels a handed-off retry timer when the successor starts another handoff", async () => {
    const { sessionsDir } = await makeMainSessionFixture({
      restartRecoveryRetryAtMs: Date.now() + 30 * 60 * 60 * 1000,
    });
    await writeCompletedToolTranscript(sessionsDir);
    vi.useFakeTimers();
    const attempts = observeRecoveryRootCompletions("main-session:startup-recovery", 1);
    const recovery = scheduleRestartAbortedMainSessionRecovery({
      getConfig: () => ({}),
      stateDir: tmpDir,
      delayMs: 0,
    });
    try {
      await attempts.completed;
      await recovery.stop();
      expect(getActiveGatewayRootWorkCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30 * 60 * 60 * 1000);
      expect(callGateway).not.toHaveBeenCalled();
    } finally {
      await recovery.stop();
      attempts.restore();
      vi.useRealTimers();
    }
  });

  it("wakes for a handed-off retry reported after the startup scan", async ({ signal }) => {
    const { sessionsDir, storePath } = await makeMainSessionFixture({
      restartRecoveryRetryAtMs: Date.now() + 30 * 60 * 60 * 1000,
    });
    await writeCompletedToolTranscript(sessionsDir);
    vi.useFakeTimers();
    const attempts = observeRecoveryRootCompletions("main-session:startup-recovery", 1);
    const recovery = scheduleRestartAbortedMainSessionRecovery({
      getConfig: () => ({}),
      stateDir: tmpDir,
      delayMs: 0,
    });
    let rescheduled: ReturnType<typeof observeRecoveryRootCompletions> | undefined;
    try {
      await attempts.completed;
      await vi.advanceTimersByTimeAsync(1);
      attempts.restore();
      rescheduled = observeRecoveryRootCompletions("main-session:startup-recovery", 1);
      const deadlineAtMs = Date.now() + 180_000;
      const target = { sessionKey: "agent:main:main", storePath };
      await replaceSessionEntry(target, {
        ...loadSessionEntry(target)!,
        restartRecoveryRetryAtMs: deadlineAtMs,
      });
      await recoverRestartAbortedMainSessions({ cfg: {}, stateDir: tmpDir });
      // Notification starts another real SQLite scan. Join that scan before
      // advancing the fake clock; wall-clock polling races its disk work.
      await withinTest(rescheduled.completed, signal);
      await vi.advanceTimersByTimeAsync(1);
      expect(callGateway).not.toHaveBeenCalled();
      const dispatched = createDeferred();
      vi.mocked(callGateway).mockImplementationOnce(async () => {
        dispatched.resolve();
        return { runId: "run-resumed" };
      });
      await vi.advanceTimersByTimeAsync(Math.max(0, deadlineAtMs - Date.now()));
      await withinTest(dispatched.promise, signal);
      expect(callGateway).toHaveBeenCalledOnce();
    } finally {
      dispatchSettlement.resolve();
      await recovery.stop();
      rescheduled?.restore();
      attempts.restore();
      vi.useRealTimers();
    }
  });
});
