// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Devices } from "./devices";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("refreshes partially cleared devices and shows a failed rejection", async () => {
  let resolve!: (result: unknown) => void;
  const pending = [{ requestId: "one", displayName: "Phone" }, { requestId: "two", displayName: "Laptop" }];
  const request = vi.fn((method: string, params?: { requestId?: string }) => {
    if (method === "device.pair.list") return Promise.resolve({ pending: [...pending], paired: [] });
    if (params?.requestId === "one") return new Promise(done => { resolve = done; });
    return Promise.resolve({ ok: false, error: "Approval service unavailable" });
  });
  const engine = { request, onEvent: () => () => {} } as unknown as WindowEngine;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const button = (label: string) => [...document.querySelectorAll("button")].find(b => b.textContent === label)!;
  try {
    await act(async () => { root.render(<Devices engine={engine} level="regular" />); });
    await act(async () => { button("Clear all waiting…").click(); });
    await act(async () => { const confirm = button("Clear all"); confirm.click(); confirm.click(); });
    expect(request.mock.calls.filter(([method]) => method === "device.pair.reject")).toHaveLength(1);
    expect(button("Clear all waiting…").disabled).toBe(true);
    expect(button("Approve").disabled).toBe(true);
    await act(async () => { pending.shift(); resolve({ ok: true }); });
    expect(request.mock.calls.filter(([method]) => method === "device.pair.list")).toHaveLength(2);
    expect(host.textContent).not.toContain("Phone");
    expect(host.textContent).toContain("Laptop");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Approval service unavailable");
    expect(button("Clear all waiting…").disabled).toBe(false);
  } finally { await act(async () => { root.unmount(); }); host.remove(); }
});
