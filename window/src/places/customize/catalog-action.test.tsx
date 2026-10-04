// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { usePluginAction, type PluginAction } from "./catalog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps the first plugin mutation and its capability review when another action arrives", async () => {
  let reject!: (reason: unknown) => void;
  const request = vi.fn(() => new Promise((_, fail) => { reject = fail; }));
  const engine = { request } as unknown as WindowEngine;
  const done = vi.fn();
  let action!: PluginAction;
  function Harness() { action = usePluginAction(engine); return null; }
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => { root.render(<Harness />); });
    let first!: Promise<void>;
    await act(async () => {
      first = action.run("first", "plugins.install", { packageName: "first" }, done);
      await action.run("second", "plugins.install", { packageName: "second" }, done);
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(action.busy).toBe("first");
    await act(async () => {
      reject({ message: "Review first", details: { capabilityConsentCode: "review", reviewToken: "first-token" } });
      await first;
    });
    expect(action.consent?.params).toEqual({ packageName: "first" });
    expect(action.consent?.token).toBe("first-token");
    expect(action.busy).toBeNull();
    expect(done).not.toHaveBeenCalled();
    request.mockResolvedValueOnce({ ok: true } as never);
    await act(async () => { await action.run("retry", "plugins.install", { packageName: "first", acknowledgeCapabilities: { reviewToken: "first-token" } }, done); });
    expect(done).toHaveBeenCalledTimes(1);
    expect(action.consent).toBeNull();
  } finally { await act(async () => { root.unmount(); }); }
});

it("ignores the former engine's plugin result while the replacement engine is working", async () => {
  let finishOld!: (value: unknown) => void;
  let finishNew!: (value: unknown) => void;
  const oldEngine = { request: vi.fn(() => new Promise(done => { finishOld = done; })) } as unknown as WindowEngine;
  const newEngine = { request: vi.fn(() => new Promise(done => { finishNew = done; })) } as unknown as WindowEngine;
  const done = vi.fn();
  let action!: PluginAction;
  function Harness({ engine }: { engine: WindowEngine }) { action = usePluginAction(engine); return null; }
  const root = createRoot(document.createElement("div"));
  try {
    await act(async () => { root.render(<Harness engine={oldEngine} />); });
    let oldRequest!: Promise<void>;
    await act(async () => { oldRequest = action.run("old", "plugins.install", {}, done); });
    await act(async () => { root.render(<Harness engine={newEngine} />); });
    let newRequest!: Promise<void>;
    await act(async () => { newRequest = action.run("new", "plugins.install", {}, done); });
    await act(async () => { finishOld({ ok: true }); await oldRequest; });
    expect(done).not.toHaveBeenCalled();
    expect(action.busy).toBe("new");
    await act(async () => { finishNew({ ok: true }); await newRequest; });
    expect(done).toHaveBeenCalledOnce();
    expect(action.busy).toBeNull();
  } finally { await act(async () => { root.unmount(); }); }
});
