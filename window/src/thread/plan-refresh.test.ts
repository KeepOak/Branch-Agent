import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { createPlanRefresh } from "./plan-refresh";

function harness() {
  const listeners = new Set<(event: { event: string; payload?: unknown }) => void>();
  let resolve: (value: { runId: string }) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const request = vi.fn(() => new Promise<{ runId: string }>((yes, no) => { resolve = yes; reject = no; }));
  const engine: WindowEngine = {
    sessionKey: "agent:research:one", agentId: "research", scopes: [],
    request: request as WindowEngine["request"],
    onEvent: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const publish = vi.fn();
  const controller = createPlanRefresh(engine, publish);
  return {
    controller, publish, request, listeners,
    pending: () => ({ resolve, reject }),
    resolve: (runId: string) => resolve({ runId }),
    reject: () => reject(new Error("Disconnected")),
    terminal: (runId: string, state: string) => listeners.forEach((listener) => listener({ event: "chat", payload: { runId, state } })),
  };
}

describe("plan refresh run lifecycle", () => {
  it("finishes a run whose terminal event precedes its RPC response", async () => {
    const h = harness();
    h.controller.refresh(3);
    h.terminal("unrelated", "error");
    h.terminal("refresh-run", "final");
    h.resolve("refresh-run");
    await Promise.resolve();
    expect(h.publish.mock.calls.map(([status]) => status)).toEqual(["asking", "none"]);
    expect(h.request).toHaveBeenCalledWith("progressCard.refresh", expect.objectContaining({ sessionKey: "agent:research:one", agentId: "research", idempotencyKey: expect.any(String) }));
    h.controller.dispose();
  });

  it("reports a failed refresh run and allows retry without duplicate pending requests", async () => {
    const h = harness();
    h.controller.refresh(3);
    h.controller.refresh(3);
    expect(h.request).toHaveBeenCalledTimes(1);
    h.resolve("refresh-run");
    await Promise.resolve();
    h.terminal("refresh-run", "error");
    expect(h.publish).toHaveBeenLastCalledWith("fail");
    h.controller.refresh(3);
    expect(h.request).toHaveBeenCalledTimes(2);
    h.controller.dispose();
  });

  it("keeps a newer progress revision even when the refresh RPC later rejects", async () => {
    const h = harness();
    h.controller.refresh(3);
    h.controller.revision(4);
    h.reject();
    await Promise.resolve();
    expect(h.publish.mock.calls.map(([status]) => status)).toEqual(["asking", "updated"]);
    h.controller.dispose();
  });

  it("does not publish an old conversation's rejection after disposal", async () => {
    const h = harness();
    h.controller.refresh(3);
    h.controller.dispose();
    h.reject();
    await Promise.resolve();
    expect(h.publish.mock.calls.map(([status]) => status)).toEqual(["asking"]);
    expect(h.listeners.size).toBe(0);
  });

  it("does not let a completed refresh's late rejection fail a newer refresh", async () => {
    const h = harness();
    h.controller.refresh(3);
    const first = h.pending();
    h.controller.revision(4);
    h.controller.refresh(4);
    first.reject(new Error("Late failure"));
    await Promise.resolve();
    expect(h.publish).toHaveBeenLastCalledWith("asking");
    h.resolve("new-run");
    await Promise.resolve();
    h.terminal("new-run", "final");
    expect(h.publish.mock.calls.map(([status]) => status)).toEqual(["asking", "updated", "asking", "none"]);
    h.controller.dispose();
  });
});
