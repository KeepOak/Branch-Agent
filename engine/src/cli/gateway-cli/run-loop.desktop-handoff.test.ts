import { describe, expect, it, vi } from "vitest";
import { GatewayHandoffFatalError } from "../../gateway/server-handoff-error.js";

const { replacementHandler } = vi.hoisted(() => ({
  replacementHandler: {
    accept: undefined as
      | Parameters<typeof import("./run-loop-request.js").registerGatewayRunInstallationReplacement>[0]["accept"]
      | undefined,
  },
}));
vi.mock("./run-loop-request.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./run-loop-request.js")>();
  return {
    ...actual,
    registerGatewayRunInstallationReplacement: (
      params: Parameters<typeof actual.registerGatewayRunInstallationReplacement>[0],
    ) => {
      replacementHandler.accept = params.accept;
      return () => {
        replacementHandler.accept = undefined;
      };
    },
  };
});
import { runLoopFixture } from "./run-loop-mocks.test-support.js";
import {
  createCloseMock,
  createRuntimeWithExitSignal,
  createSignaledStart,
  waitForLoopCondition,
  waitForStart,
  withIsolatedSignals,
} from "./run-loop.test-support.js";

const { acquireGatewayLock, gatewayLog, peekGatewayRestartReason, runLoopWithStart } = runLoopFixture;

async function within<T>(work: Promise<T>, label: string, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("desktop engine handoff", () => {
  it("keeps a healthy owner serving when the desktop disconnects during a failed deactivate", async () => {
    await withIsolatedSignals(async ({ captureSignal }) => {
      const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
      const previousMessageListeners = new Set(process.listeners("message"));
      const previousDisconnectListeners = new Set(process.listeners("disconnect"));
      if (!process.send) {
        Object.defineProperty(process, "send", { configurable: true, value: vi.fn() });
      }
      const close = createCloseMock();
      const { start, started } = createSignaledStart(close);
      const originalStart = start.getMockImplementation();
      let failDeactivate!: (error: Error) => void;
      const deactivate = vi.fn(() => new Promise<void>((_resolve, reject) => {
        failDeactivate = reject;
      }));
      start.mockImplementation(async (...args) => ({
        ...(await originalStart!(...args)),
        deactivate,
      }));
      const { runtime, exited } = createRuntimeWithExitSignal();
      await within(runLoopWithStart({ start, runtime }), "run-loop import", 120_000);
      try {
        await within(waitForStart(started), "run-loop start", 120_000);
        const onMessage = process.listeners("message").find(
          (listener) => !previousMessageListeners.has(listener),
        );
        const onDisconnect = process.listeners("disconnect").find(
          (listener) => !previousDisconnectListeners.has(listener),
        );
        expect(onDisconnect).toBeDefined();
        onMessage?.({ type: "branch-desktop:deactivate", id: 1 } as never);
        await waitForLoopCondition(() => deactivate.mock.calls.length > 0, "deactivation did not start");
        onDisconnect?.();
        failDeactivate(new Error("deactivate failed but serving was restored"));
        await vi.waitFor(() => expect(gatewayLog.error).toHaveBeenCalledWith(
          expect.stringContaining("desktop handoff deactivation failed"),
        ));
        expect(close).not.toHaveBeenCalled();
        expect(start).toHaveBeenCalledTimes(1);
      } finally {
        captureSignal("SIGTERM")();
        await within(exited, "desktop handoff loop stop");
        if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
        else Reflect.deleteProperty(process, "send");
      }
    });
  }, 240_000);

  it("exits for supervisor recovery when deactivation cannot restore serving", async () => {
    await withIsolatedSignals(async () => {
      const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
      const previousMessageListeners = new Set(process.listeners("message"));
      if (!process.send) {
        Object.defineProperty(process, "send", { configurable: true, value: vi.fn() });
      }
      const close = createCloseMock();
      const { start, started } = createSignaledStart(close);
      const originalStart = start.getMockImplementation();
      start.mockImplementation(async (...args) => ({
        ...(await originalStart!(...args)),
        deactivate: async () => {
          throw new GatewayHandoffFatalError("cannot restore serving");
        },
      }));
      const { runtime, exited } = createRuntimeWithExitSignal();
      await within(runLoopWithStart({ start, runtime }), "run-loop import", 120_000);
      try {
        await within(waitForStart(started), "run-loop start", 120_000);
        const onMessage = process.listeners("message").find(
          (listener) => !previousMessageListeners.has(listener),
        );
        onMessage?.({ type: "branch-desktop:deactivate", id: 1 } as never);
        await expect(within(exited, "fatal handoff exit")).resolves.toBe(1);
        expect(close).toHaveBeenCalled();
      } finally {
        if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
        else Reflect.deleteProperty(process, "send");
      }
    });
  });

  it("refuses signal, replacement, and triage restarts while deactivated", async () => {
    await withIsolatedSignals(async ({ captureSignal }) => {
      const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
      const previousMessageListeners = new Set(process.listeners("message"));
      if (!process.send) {
        Object.defineProperty(process, "send", { configurable: true, value: vi.fn() });
      }
      const close = createCloseMock();
      const { start, started } = createSignaledStart(close);
      const originalStart = start.getMockImplementation();
      const deactivate = vi.fn(async () => {});
      start.mockImplementation(async (...args) => ({
        ...(await originalStart!(...args)),
        deactivate,
        waitForDeactivatedRuns: () => new Promise(() => {}),
      }));
      const { runtime, exited } = createRuntimeWithExitSignal();
      let requestRestart: (() => void) | undefined;
      await within(runLoopWithStart({
        start,
        runtime,
        onRequestReady: (request) => {
          requestRestart = () => request("restart", "SIGUSR2", "direct guard probe");
        },
      }), "run-loop import", 180_000);
      try {
        await within(waitForStart(started), "run-loop start", 120_000);
        const onMessage = process.listeners("message").find(
          (listener) => !previousMessageListeners.has(listener),
        );
        onMessage?.({ type: "branch-desktop:deactivate", id: 1 } as never);
        await waitForLoopCondition(() => deactivate.mock.calls.length > 0, "deactivation did not start");
        await Promise.resolve();
        expect(requestRestart).toBeDefined();
        requestRestart?.();
        captureSignal("SIGUSR2")();
        replacementHandler.accept?.({
          running: { version: "1", buildId: null },
          detectedAt: Date.now(),
          message: "installation replaced",
          reason: "installation replacement",
        });
        peekGatewayRestartReason.mockReturnValueOnce("gateway.triage_completed");
        captureSignal("SIGUSR2")();
        expect(close).not.toHaveBeenCalled();
        expect(start).toHaveBeenCalledTimes(1);
        expect(gatewayLog.warn).toHaveBeenCalledWith(
          "restart ignored while desktop handoff is deactivated (direct guard probe)",
        );
        expect(gatewayLog.warn).toHaveBeenCalledWith(
          "SIGUSR2 restart ignored while desktop handoff is deactivated",
        );
        expect(gatewayLog.warn).toHaveBeenCalledWith(
          "installation replacement deferred while desktop handoff is deactivated",
        );
      } finally {
        captureSignal("SIGTERM")();
        await within(exited, "desktop handoff loop stop");
        vi.restoreAllMocks();
        if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
        else Reflect.deleteProperty(process, "send");
      }
    });
  }, 240_000);

  it("recovers the last desktop engine when the successor is gone at the lease deadline", async () => {
    await withIsolatedSignals(async ({ captureSignal }) => {
      const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
      const previousMessageListeners = new Set(process.listeners("message"));
      if (!process.send) {
        Object.defineProperty(process, "send", { configurable: true, value: vi.fn() });
      }
      const close = createCloseMock();
      const { start, started } = createSignaledStart(close);
      const originalStart = start.getMockImplementation();
      let resumeRestart!: () => void;
      const restartBlocked = new Promise<void>((resolve) => {
        resumeRestart = resolve;
      });
      const processExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
      const deactivate = vi.fn(async () => {});
      const rollbackDeactivation = vi.fn(async () => {});
      start.mockImplementation(async (...args) => {
        if (start.mock.calls.length > 1) await restartBlocked;
        return {
          ...(await originalStart!(...args)),
          deactivate,
          rollbackDeactivation,
          waitForDeactivatedRuns: async () => ({
            deadlineElapsed: true,
            expiresAt: Date.now() + 1_100,
          }),
        };
      });
      const { runtime, exited } = createRuntimeWithExitSignal();
      await within(runLoopWithStart({ start, runtime }), "run-loop import", 120_000);
      try {
        await within(waitForStart(started), "run-loop start", 120_000);
        const onMessage = process.listeners("message").find(
          (listener) => !previousMessageListeners.has(listener),
        );
        expect(onMessage).toBeDefined();
        onMessage?.({ type: "branch-desktop:deactivate", id: 1 } as never);
        await waitForLoopCondition(
          () => rollbackDeactivation.mock.calls.length > 0,
          "last engine did not reclaim state",
        );
        expect(deactivate).toHaveBeenCalledTimes(1);
        expect(acquireGatewayLock).toHaveBeenCalledWith(
          expect.objectContaining({ timeoutMs: 0 }),
        );
        expect(gatewayLog.warn).toHaveBeenCalledWith(
          "desktop successor is gone; restoring the last engine in place",
        );
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(processExit).not.toHaveBeenCalled();
      } finally {
        resumeRestart();
        captureSignal("SIGTERM")();
        try {
          await Promise.race([
            exited,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("desktop handoff loop did not stop")), 5_000),
            ),
          ]);
        } finally {
          if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
          else Reflect.deleteProperty(process, "send");
          processExit.mockRestore();
        }
      }
    });
  });

  it("exits for supervisor recovery when rollback cannot restore the owner", async () => {
    await withIsolatedSignals(async () => {
      const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
      const previousMessageListeners = new Set(process.listeners("message"));
      if (!process.send) {
        Object.defineProperty(process, "send", { configurable: true, value: vi.fn() });
      }
      const close = createCloseMock();
      const { start, started } = createSignaledStart(close);
      const originalStart = start.getMockImplementation();
      start.mockImplementation(async (...args) => ({
        ...(await originalStart!(...args)),
        deactivate: async () => {},
        rollbackDeactivation: async () => { throw new Error("rollback failed"); },
        waitForDeactivatedRuns: () => new Promise(() => {}),
      }));
      const { runtime, exited } = createRuntimeWithExitSignal();
      await within(runLoopWithStart({ start, runtime }), "run-loop import", 120_000);
      try {
        await within(waitForStart(started), "run-loop start", 120_000);
        const onMessage = process.listeners("message").find(
          (listener) => !previousMessageListeners.has(listener),
        );
        onMessage?.({ type: "branch-desktop:deactivate", id: 1 } as never);
        onMessage?.({ type: "branch-desktop:rollback", id: 2 } as never);
        await expect(within(exited, "failed rollback exit")).resolves.toBe(1);
        expect(close).toHaveBeenCalled();
      } finally {
        if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
        else Reflect.deleteProperty(process, "send");
      }
    });
  });
});
