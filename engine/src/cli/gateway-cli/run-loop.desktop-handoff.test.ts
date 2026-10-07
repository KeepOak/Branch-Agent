import { describe, expect, it, vi } from "vitest";
import { runLoopFixture } from "./run-loop-mocks.test-support.js";
import {
  createCloseMock,
  createRuntimeWithExitSignal,
  createSignaledStart,
  waitForLoopCondition,
  waitForStart,
  withIsolatedSignals,
} from "./run-loop.test-support.js";

const { gatewayLog, runLoopWithStart } = runLoopFixture;

describe("desktop engine handoff", () => {
  it("recovers the last desktop engine when the successor is gone at the lease deadline", async () => {
    await withIsolatedSignals(async ({ captureSignal }) => {
      const sendDescriptor = Object.getOwnPropertyDescriptor(process, "send");
      const previousMessageListeners = new Set(process.listeners("message"));
      const send = vi.fn();
      Object.defineProperty(process, "send", { configurable: true, value: send });
      const close = createCloseMock();
      const { start, started } = createSignaledStart(close);
      const originalStart = start.getMockImplementation();
      const deactivate = vi.fn(async () => {});
      const rollbackDeactivation = vi.fn(async () => {});
      start.mockImplementation(async (...args) => ({
        ...(await originalStart!(...args)),
        deactivate,
        rollbackDeactivation,
        waitForDeactivatedRuns: async () => ({
          deadlineElapsed: true,
          expiresAt: Date.now() + 30_000,
        }),
      }));
      const { runtime, exited } = createRuntimeWithExitSignal();
      const { loopPromise } = await runLoopWithStart({ start, runtime });
      try {
        await waitForStart(started);
        const onMessage = process.listeners("message").find(
          (listener) => !previousMessageListeners.has(listener),
        );
        expect(onMessage).toBeDefined();
        onMessage?.({ type: "branch-desktop:deactivate", id: 1 } as never);
        await waitForLoopCondition(
          () => rollbackDeactivation.mock.calls.length > 0,
          "last engine did not reclaim state",
        );
        expect(send).toHaveBeenCalledWith({
          type: "branch-desktop:deactivate-result",
          id: 1,
          ok: true,
        });
        expect(gatewayLog.warn).toHaveBeenCalledWith(
          "desktop successor is gone; restoring the last engine in place",
        );
      } finally {
        captureSignal("SIGTERM")();
        try {
          await Promise.race([
            exited,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("desktop handoff loop did not stop")), 5_000),
            ),
          ]);
          await loopPromise;
        } finally {
          if (sendDescriptor) Object.defineProperty(process, "send", sendDescriptor);
          else Reflect.deleteProperty(process, "send");
        }
      }
    });
  });
});
