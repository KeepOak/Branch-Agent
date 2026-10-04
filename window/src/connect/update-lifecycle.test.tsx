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
import { setInputPrivacy } from "../composer/drafts";
import { saveLine } from "../composer/queue";
import { SaplingSession } from "./session";
import { UpdateLifecycle, bindUpdateLifecycle, type RestartReceipt, type UpdateBridge, type UpdateLifecycleEvent } from "./update-lifecycle";
import { registerInputCheckpoint, setUpdateBarrier, updateBlocked } from "./update-barrier";

const receipt: RestartReceipt = { id: "receipt", sessionKey: "agent:contact:main", expectedSessionId: "original", lifecycleGeneration: "operation", targetBuild: "candidate" };
function fixture() {
  let phase = "connected";
  let key = receipt.sessionKey;
  const listeners = new Set<() => void>();
  const producers = new Set<(event: string, payload: unknown) => void>();
  const reconciliation = vi.fn(async (_operationId: string) => {});
  const request = vi.fn(async (method: string): Promise<unknown> => {
    if (method === "sessions.describe") return { session: { sessionId: "original" } };
    if (method === "desktop.restart.prepare") return receipt;
    if (method === "desktop.restart.resume") return { status: "accepted" };
    if (method === "desktop.restart.observe") return { status: "waiting" };
    if (method === "desktop.restart.cancel") return { status: "cancelled" };
    return { config: { update: { auto: { enabled: true } } } };
  });
  const session = { getSnapshot: () => ({ sessionKey: key, status: { phase } }), subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); }, onGatewayEvent: (fn: (event: string, payload: unknown) => void) => { producers.add(fn); return () => producers.delete(fn); }, request } as unknown as SaplingSession;
  let lifecycle!: (event: UpdateLifecycleEvent) => void;
  let prepare!: Parameters<NonNullable<UpdateBridge["onPrepareUpdate"]>>[0];
  let resume!: Parameters<NonNullable<UpdateBridge["onResumeUpdate"]>>[0];
  let observe!: Parameters<NonNullable<UpdateBridge["onObserveUpdate"]>>[0];
  let cancel!: Parameters<NonNullable<UpdateBridge["onCancelUpdate"]>>[0];
  let policy!: () => Promise<boolean>;
  let verify!: (input: Record<string, never>) => Promise<unknown>;
  const unbind = bindUpdateLifecycle(session, {
    onUpdateLifecycle: (fn) => { lifecycle = fn; return () => {}; },
    onVerifyUpdate: (fn) => { verify = fn; return () => {}; },
    onPrepareUpdate: (fn) => { prepare = fn; return () => {}; },
    onObserveUpdate: (fn) => { observe = fn; return () => {}; },
    requestUpdateReconciliation: reconciliation,
    onResumeUpdate: (fn) => { resume = fn; return () => {}; },
    onCancelUpdate: (fn) => { cancel = fn; return () => {}; },
    onUpdatePolicy: (fn) => { policy = fn; return () => {}; },
  }, vi.fn());
  return { request, lifecycle, verify, prepare, resume, observe, reconciliation, emit: (event: string, payload: unknown) => { for (const fn of producers) fn(event, payload); }, cancel, policy, unbind, open: (next: string) => { key = next; }, connect: (next: string) => { phase = next; for (const fn of listeners) fn(); } };
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
    expect(f.request).toHaveBeenCalledWith("sessions.describe", { key: receipt.sessionKey });
    expect(f.request).not.toHaveBeenCalledWith("desktop.restart.prepare", expect.anything()); expect(updateBlocked()).toBe(true); unregister(); f.unbind();
  });
  it("waits for fresh connection before resume and holds delivery until final lifecycle ACK", async () => {
    const f = fixture(); f.connect("connecting");
    const resumed = f.resume({ receipt }); await Promise.resolve(); expect(f.request).not.toHaveBeenCalled();
    f.connect("connected"); expect(await resumed).toEqual({ status: "accepted" });
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


it("requests authoritative minimal idle admission for a first-use conversation without a physical ID", async () => {
  const f = fixture();
  f.request.mockImplementation(async (method) => method === "sessions.describe" ? { session: {} } : { status: "idle", lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(await f.prepare({ operationId: "operation", targetBuild: "candidate" })).toEqual({ status: "idle", lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(f.request).toHaveBeenCalledWith("desktop.restart.prepare", { lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(updateBlocked()).toBe(true); f.unbind();
});

it("defers when the engine reports unrelated active work instead of inventing an idle receipt", async () => {
  const f = fixture(); f.open("");
  f.request.mockResolvedValue({ status: "deferred", lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(await f.prepare({ operationId: "operation", targetBuild: "candidate" })).toEqual({ status: "deferred", lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(f.request).toHaveBeenCalledWith("desktop.restart.prepare", { lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(updateBlocked()).toBe(false); f.unbind();
});

it("cancels an aborted idle update with the exact engine generation binding", async () => {
  const f = fixture(); setUpdateBarrier(true);
  expect(await f.cancel({ receipt: { lifecycleGeneration: "operation", targetBuild: "candidate" } })).toBe("cancelled");
  expect(f.request).toHaveBeenCalledWith("desktop.restart.cancel", { lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(updateBlocked()).toBe(true); f.unbind();
});

it("does not checkpoint a different contact when the user switches during the actual session read", async () => {
  const f = fixture(); f.request.mockImplementation(async () => { f.open("agent:other:main"); return { session: { sessionId: "original" } }; });
  await expect(f.prepare({ operationId: "operation", targetBuild: "candidate" })).rejects.toThrow("conversation changed");
  expect(f.request).toHaveBeenCalledTimes(1); expect(updateBlocked()).toBe(true); f.unbind();
});


it("registers the real identity bridge and returns the fresh authenticated engine response untouched", async () => {
  const f = fixture(); f.connect("connecting");
  const actual = { targetBuild: "a".repeat(64), processInstanceId: "actual-boot-instance", pid: 4242 };
  f.request.mockResolvedValue(actual);
  const checking = f.verify({}); await Promise.resolve(); expect(f.request).not.toHaveBeenCalled();
  f.connect("connected"); expect(await checking).toBe(actual);
  expect(f.request).toHaveBeenCalledWith("desktop.restart.identity", {});
  f.unbind();
});

it("retains the update barrier when the actual identity ACK is lost", async () => {
  const f = fixture(); setUpdateBarrier(true);
  f.request.mockRejectedValue(new Error("identity ACK lost"));
  await expect(f.verify({})).rejects.toThrow("identity ACK lost");
  expect(updateBlocked()).toBe(true); f.unbind();
});

it("describes canonical incognito privacy before any disk checkpoint and defers without engine preparation", async () => {
  const f = fixture(); const order: string[] = [];
  const disk = vi.fn(() => { order.push("disk checkpoint"); }); const unregister = registerInputCheckpoint(disk);
  f.request.mockImplementation(async (method) => { order.push(method); return { session: { sessionId: "private-physical", incognito: true } }; });
  const result = await f.prepare({ operationId: "operation", targetBuild: "candidate" });
  expect(order).toEqual(["sessions.describe"]);
  expect(result).toEqual({ status: "deferred", lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(f.request).toHaveBeenCalledTimes(1);
  expect(f.request).toHaveBeenCalledWith("sessions.describe", { key: receipt.sessionKey });
  expect(disk).not.toHaveBeenCalled(); expect(updateBlocked()).toBe(false);
  unregister(); f.unbind();
});

it("defers for actual off-page private queue custody before all disk checkpoints", async () => {
  const f = fixture(); f.open("");
  const disk = vi.fn(); const unregister = registerInputCheckpoint(disk);
  const privateKey = "agent:offpage-private:main";
  setInputPrivacy(privateKey, "private");
  saveLine(localStorage, privateKey, [{ id: "private-queued", text: "private words", files: [], state: "waiting" }]);
  expect(await f.prepare({ operationId: "operation", targetBuild: "candidate" })).toEqual({ status: "deferred", lifecycleGeneration: "operation", targetBuild: "candidate" });
  expect(disk).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  expect(updateBlocked()).toBe(false);
  saveLine(localStorage, privateKey, []); unregister(); f.unbind();
});


it("observes through fresh actual authentication and preserves fast terminal evidence untouched", async () => {
  const f = fixture(); f.connect("connecting"); setUpdateBarrier(true);
  const completed = { status: "completed", runId: "actual-fast-run", outcome: "done" };
  f.request.mockResolvedValue(completed);
  const observed = f.observe({ receipt }); await Promise.resolve(); expect(f.request).not.toHaveBeenCalled();
  f.connect("connected"); expect(await observed).toBe(completed);
  expect(f.request).toHaveBeenCalledWith("desktop.restart.observe", receipt);
  expect(f.request).not.toHaveBeenCalledWith("desktop.restart.resume", expect.anything());
  expect(updateBlocked()).toBe(true);
  f.lifecycle({ operationId: receipt.lifecycleGeneration, phase: "complete", outcome: "done" });
  expect(updateBlocked()).toBe(false); f.unbind();
});

it("a lost observe ACK retains the barrier and the next bridge request remains read only", async () => {
  const f = fixture(); setUpdateBarrier(true);
  f.request.mockRejectedValueOnce(new Error("observe ACK lost")).mockResolvedValue({ status: "waiting", runId: "actual-run" });
  await expect(f.observe({ receipt })).rejects.toThrow("observe ACK lost");
  expect(updateBlocked()).toBe(true);
  expect(await f.observe({ receipt })).toEqual({ status: "waiting", runId: "actual-run" });
  expect(f.request.mock.calls.map(([method]) => method)).toEqual(["desktop.restart.observe", "desktop.restart.observe"]);
  expect(updateBlocked()).toBe(true); f.unbind();
});

it("a real matching completion producer hint arriving before the resume ACK is generation bound", async () => {
  const f = fixture(); let ack!: (value: unknown) => void;
  f.request.mockImplementation(async () => new Promise((resolve) => { ack = resolve; }));
  const resuming = f.resume({ receipt }); await Promise.resolve();
  f.emit("agent", { sessionKey: receipt.sessionKey, stream: "lifecycle", runId: "fast", data: { phase: "end" } });
  expect(f.reconciliation).toHaveBeenCalledWith(receipt.lifecycleGeneration);
  const uncertain = { status: "uncertain", runId: "fast" }; ack(uncertain);
  expect(await resuming).toBe(uncertain);
  expect(f.request.mock.calls.map(([method]) => method)).toEqual(["desktop.restart.resume"]);
  f.unbind();
});

it("uses actual producer and reconnect edges while ignoring unrelated events and retired generations", async () => {
  const f = fixture(); f.request.mockResolvedValue({ status: "waiting", runId: "actual-run" });
  await f.observe({ receipt });
  f.emit("agent", { sessionKey: "agent:other:main", stream: "lifecycle", runId: "other" });
  f.emit("config.changed", { sessionKey: receipt.sessionKey });
  f.emit("agent", { sessionKey: receipt.sessionKey, stream: "assistant" });
  f.emit("chat", { sessionKey: receipt.sessionKey, state: "delta" });
  expect(f.reconciliation).not.toHaveBeenCalled();
  f.emit("session.message", { sessionKey: receipt.sessionKey });
  expect(f.reconciliation).toHaveBeenCalledTimes(1);
  f.connect("connecting"); f.connect("connected"); f.connect("connected");
  expect(f.reconciliation).toHaveBeenCalledTimes(2);
  f.lifecycle({ operationId: "new-generation", phase: "preparing" });
  f.emit("agent", { runId: "actual-run", stream: "lifecycle" });
  expect(f.reconciliation).toHaveBeenCalledTimes(2);
  f.unbind(); f.emit("session.message", { sessionKey: receipt.sessionKey });
  expect(f.reconciliation).toHaveBeenCalledTimes(2);
});

it("waiting holds the barrier and recovered releases it only after main's verified lifecycle event", async () => {
  const f = fixture();
  f.lifecycle({ operationId: receipt.lifecycleGeneration, phase: "waiting" }); expect(updateBlocked()).toBe(true);
  f.request.mockResolvedValue({ status: "recovered", runId: "actual-run" });
  expect(await f.observe({ receipt })).toEqual({ status: "recovered", runId: "actual-run" });
  expect(updateBlocked()).toBe(true);
  f.lifecycle({ operationId: receipt.lifecycleGeneration, phase: "recovered" }); expect(updateBlocked()).toBe(false);
  f.emit("agent", { runId: "actual-run", stream: "lifecycle", data: { phase: "end" } });
  expect(f.reconciliation).toHaveBeenCalledWith(receipt.lifecycleGeneration);
  f.lifecycle({ operationId: receipt.lifecycleGeneration, phase: "complete", outcome: "failed" });
  f.emit("session.message", { sessionKey: receipt.sessionKey });
  expect(f.reconciliation).toHaveBeenCalledTimes(1); f.unbind();
});

it.each(["failed", "killed", "timeout", "interrupted"] as const)("actual completed %s outcome is visible without success wording", async (outcome) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let notify!: (event: UpdateLifecycleEvent) => void;
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host);
  await act(async () => root.render(<UpdateLifecycle session={{} as SaplingSession} bridge={{ onUpdateLifecycle: (fn) => { notify = fn; return () => {}; } }} />));
  await act(async () => notify({ operationId: "op", phase: "waiting" }));
  expect(host.textContent).toContain("Waiting to confirm");
  await act(async () => notify({ operationId: "op", phase: "complete", outcome }));
  expect(host.textContent).not.toContain("Your task finished");
  expect(host.textContent).not.toContain("Your task is continuing");
  expect(host.textContent).toContain("Your messages are kept here");
  await act(async () => root.unmount()); host.remove();
});
