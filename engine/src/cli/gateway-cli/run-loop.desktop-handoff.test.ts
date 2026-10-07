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

const { acquireGatewayLock, gatewayLog, runLoopWithStart } = runLoopFixture;

async function within<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("desktop engine handoff", () => {
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
      await within(runLoopWithStart({ start, runtime }), "run-loop import");
      try {
        await within(waitForStart(started), "run-loop start");
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
      } finally {
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
        }
      }
    });
  });
});
