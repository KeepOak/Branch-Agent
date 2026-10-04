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
