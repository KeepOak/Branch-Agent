import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  abortEmbeddedAgentRun: vi.fn(() => true),
  abortActiveCronTaskRuns: vi.fn(() => 0),
  cancelBackgroundExecSession: vi.fn(() => true),
  listRunningSessions: vi.fn(() => [{ id: "exec-1" }, { id: "exec-2" }]),
  cancelAllTurns: vi.fn(async () => {}),
  peekAcpSessionManager: vi.fn(),
  abortChatRunById: vi.fn(() => ({ aborted: true })),
}));

vi.mock("../agents/embedded-agent-runner/runs.js", () => ({
  abortEmbeddedAgentRun: mocks.abortEmbeddedAgentRun,
}));
vi.mock("../cron/service/active-run-cancellation.js", () => ({
  abortActiveCronTaskRuns: mocks.abortActiveCronTaskRuns,
}));
vi.mock("../agents/bash-process-control.js", () => ({
  cancelBackgroundExecSession: mocks.cancelBackgroundExecSession,
}));
vi.mock("../agents/bash-process-registry.js", () => ({
  listRunningSessions: mocks.listRunningSessions,
}));
vi.mock("../acp/control-plane/manager.js", () => ({
  peekAcpSessionManager: mocks.peekAcpSessionManager,
}));
vi.mock("./chat-abort.js", () => ({ abortChatRunById: mocks.abortChatRunById }));

const { isLockdownEngaging, stopRunningWorkForLockdown } = await import("./lockdown-engage.js");

describe("stopping running work when Lockdown turns on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.peekAcpSessionManager.mockReturnValue({ cancelAllTurns: mocks.cancelAllTurns });
  });

  it("fires only on the off-to-on commit", () => {
    expect(isLockdownEngaging({}, { security: { lockdown: true } })).toBe(true);
    expect(
      isLockdownEngaging({ security: { lockdown: true } }, { security: { lockdown: true } }),
    ).toBe(false);
    expect(isLockdownEngaging({ security: { lockdown: true } }, {})).toBe(false);
  });

  it("stops channel, cron, hook, subagent, ACP and background work even without a gateway context", () => {
    stopRunningWorkForLockdown(undefined);
    expect(mocks.abortEmbeddedAgentRun).toHaveBeenCalledWith(undefined, { mode: "all" });
    expect(mocks.abortActiveCronTaskRuns).toHaveBeenCalledWith("Lockdown is on");
    expect(mocks.cancelBackgroundExecSession.mock.calls).toEqual([["exec-1"], ["exec-2"]]);
    expect(mocks.cancelAllTurns).toHaveBeenCalledWith("Lockdown is on");
    expect(mocks.abortChatRunById).not.toHaveBeenCalled();
  });

  it("also aborts every window run when the gateway context is up", () => {
    const chatAbortControllers = new Map([
      ["run-a", { sessionKey: "agent:main:a" }],
      ["run-b", { sessionKey: "agent:main:b" }],
    ]);
    const ops = { chatAbortControllers } as unknown as Parameters<
      typeof stopRunningWorkForLockdown
    >[0];
    stopRunningWorkForLockdown(ops);
    expect(mocks.abortChatRunById.mock.calls.map(([, params]) => params)).toEqual([
      { runId: "run-a", sessionKey: "agent:main:a", stopReason: "Lockdown is on" },
      { runId: "run-b", sessionKey: "agent:main:b", stopReason: "Lockdown is on" },
    ]);
    expect(mocks.abortEmbeddedAgentRun).toHaveBeenCalledOnce();
  });

  it("keeps stopping the rest when one step throws", () => {
    mocks.abortEmbeddedAgentRun.mockImplementationOnce(() => {
      throw new Error("abort failed");
    });
    mocks.cancelBackgroundExecSession.mockImplementationOnce(() => {
      throw new Error("kill failed");
    });
    expect(() => stopRunningWorkForLockdown(undefined)).not.toThrow();
    expect(mocks.abortActiveCronTaskRuns).toHaveBeenCalledOnce();
    expect(mocks.cancelBackgroundExecSession).toHaveBeenCalledTimes(2);
    expect(mocks.cancelAllTurns).toHaveBeenCalledOnce();
  });
});
