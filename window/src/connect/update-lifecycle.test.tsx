// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";
const gateway = vi.hoisted(() => ({ onStatus: null as ((status: GatewayStatus) => void) | null, request: vi.fn(async (_method: string, _params?: unknown) => ({} as unknown)) }));
vi.mock("./gateway", () => ({ BranchGateway: class {
  constructor(options: { onStatus: (status: GatewayStatus) => void }) { gateway.onStatus = options.onStatus; }
  start() {} stop() {} request(method: string, params?: unknown) { return gateway.request(method, params); }
} }));
import { SaplingSession } from "./session";
import { UpdateLifecycle, bindUpdateLifecycle, type RestartReceipt, type UpdateBridge, type UpdateLifecycleEvent } from "./update-lifecycle";
import { registerInputCheckpoint, setUpdateBarrier, updateBlocked } from "./update-barrier";

const receipt: RestartReceipt = { id: "receipt", sessionKey: "agent:contact:main", expectedSessionId: "original", lifecycleGeneration: "operation", targetBuild: "candidate" };
function fixture() {
  let phase = "connected";
  let key = receipt.sessionKey;
  const listeners = new Set<() => void>();
  const request = vi.fn(async (method: string) => {
    if (method === "sessions.describe") return { session: { sessionId: "original" } };
    if (method === "desktop.restart.prepare") return receipt;
    if (method === "desktop.restart.resume") return { status: "accepted" };
    if (method === "desktop.restart.cancel") return { status: "cancelled" };
    return { config: { update: { auto: { enabled: true } } } };
  });
  const session = { getSnapshot: () => ({ sessionKey: key, status: { phase } }), subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, request } as unknown as SaplingSession;
  let lifecycle!: (event: UpdateLifecycleEvent) => void;
  let prepare!: Parameters<NonNullable<UpdateBridge["onPrepareUpdate"]>>[0];
  let resume!: Parameters<NonNullable<UpdateBridge["onResumeUpdate"]>>[0];
  let cancel!: Parameters<NonNullable<UpdateBridge["onCancelUpdate"]>>[0];
  let policy!: () => Promise<boolean>;
  const unbind = bindUpdateLifecycle(session, {
    onUpdateLifecycle: (fn) => { lifecycle = fn; return () => {}; },
    onPrepareUpdate: (fn) => { prepare = fn; return () => {}; },
    onResumeUpdate: (fn) => { resume = fn; return () => {}; },
    onCancelUpdate: (fn) => { cancel = fn; return () => {}; },
    onUpdatePolicy: (fn) => { policy = fn; return () => {}; },
  }, vi.fn());
  return { request, lifecycle, prepare, resume, cancel, policy, unbind, open: (next: string) => { key = next; }, connect: (next: string) => { phase = next; for (const fn of listeners) fn(); } };
}
afterEach(() => { setUpdateBarrier(false); vi.restoreAllMocks(); });
describe("desktop update lifecycle uses the actual authenticated session", () => {
  it("flushes inputs before prepare, pins the described session, and reads actual update policy", async () => {
    const f = fixture(); const saved = vi.fn(); const unregister = registerInputCheckpoint(saved);
    await f.prepare({ operationId: "operation", targetBuild: "candidate" });
    expect(saved).toHaveBeenCalledOnce(); expect(updateBlocked()).toBe(true);
    expect(f.request).toHaveBeenCalledWith("desktop.restart.prepare", expect.objectContaining({ sessionKey: receipt.sessionKey, expectedSessionId: "original", lifecycleGeneration: "operation" }));
    expect(await f.policy()).toBe(true); unregister(); f.unbind();
  });
  it("aborts preparation on failed input persistence before the engine is asked to restart", async () => {
    const f = fixture(); const unregister = registerInputCheckpoint(() => { throw new Error("full"); });
    await expect(f.prepare({ operationId: "operation", targetBuild: "candidate" })).rejects.toThrow("full");
    expect(f.request).not.toHaveBeenCalled(); expect(updateBlocked()).toBe(true); unregister(); f.unbind();
  });
  it("waits for fresh connection before resume and holds delivery until final lifecycle ACK", async () => {
    const f = fixture(); f.connect("connecting");
    const resumed = f.resume({ receipt }); await Promise.resolve(); expect(f.request).not.toHaveBeenCalled();
    f.connect("connected"); expect(await resumed).toBe("accepted");
    expect(f.request).toHaveBeenCalledWith("desktop.restart.resume", receipt);
    expect(updateBlocked()).toBe(true);
    f.lifecycle({ operationId: "operation", phase: "complete" }); expect(updateBlocked()).toBe(false); f.unbind();
  });
  it("replays the reconnect barrier on a reloaded renderer and ignores an older operation's terminal event", async () => {
    const f = fixture(); f.lifecycle({ operationId: "new", phase: "reconnecting" });
    f.lifecycle({ operationId: "old", phase: "failed" }); expect(updateBlocked()).toBe(true);
    expect(await f.cancel({ receipt })).toBe("cancelled");
    expect(f.request).toHaveBeenCalledWith("desktop.restart.cancel", receipt);
    expect(updateBlocked()).toBe(true);
    f.lifecycle({ operationId: "new", phase: "failed" }); expect(updateBlocked()).toBe(false); f.unbind();
  });
});


it("shows the actual friendly updating, recovery and retained-version states without build jargon", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let notify!: (event: UpdateLifecycleEvent) => void;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const bridge: UpdateBridge = { onUpdateLifecycle: (fn) => { notify = fn; return () => {}; } };
  await act(async () => root.render(<UpdateLifecycle session={{} as SaplingSession} bridge={bridge} />));
  await act(async () => notify({ operationId: "op", phase: "preparing" }));
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Updating Branch. Your messages are kept here.");
  await act(async () => notify({ operationId: "op", phase: "reconnecting" }));
  expect(host.textContent).toContain("Coming back online");
  await act(async () => notify({ operationId: "op", phase: "failed", outcome: "rolled-back" }));
  expect(host.textContent).toContain("kept the previous version");
  await act(async () => notify({ operationId: "next", phase: "preparing" }));
  await act(async () => notify({ operationId: "next", phase: "complete" }));
  expect(host.textContent).toBe("Back online. Right where you left off.");
  expect(host.querySelector('[aria-live="polite"]')).not.toBeNull();
  await act(async () => root.unmount()); host.remove();
});


it("the real session sender preserves the persisted UUID and propagates a lost admission ACK", async () => {
  gateway.request.mockImplementation(async (method) => {
    if (method === "chat.send") throw new Error("lost acknowledgement");
    return {};
  });
  const session = new SaplingSession("ws://fixture", undefined, receipt.sessionKey);
  gateway.onStatus!({ phase: "connected", hello: { snapshot: { sessionDefaults: { mainSessionKey: receipt.sessionKey } }, auth: { scopes: [] }, policy: {} } } as unknown as GatewayStatus);
  await Promise.resolve(); await Promise.resolve();
  await expect(session.send("kept", { idempotencyKey: "stable", sessionKey: receipt.sessionKey, sessionId: "original" })).rejects.toThrow("lost acknowledgement");
  expect(gateway.request).toHaveBeenCalledWith("chat.send", { message: "kept", idempotencyKey: "stable", sessionKey: receipt.sessionKey, sessionId: "original" });
  session.stop(); gateway.request.mockReset();
});

it("the real session sender cannot admit queued input while the restart barrier is held", async () => {
  gateway.request.mockClear(); setUpdateBarrier(true);
  const session = new SaplingSession("ws://fixture", undefined, receipt.sessionKey);
  await expect(session.send("kept", { idempotencyKey: "stable", sessionKey: receipt.sessionKey })).rejects.toThrow("updating");
  expect(gateway.request).not.toHaveBeenCalled(); session.stop();
});
