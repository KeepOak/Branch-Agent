// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { PairDialog } from "./pairing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("retires the former pairing status while making a replacement code", async () => {
  vi.useFakeTimers();
  let finishStatus!: (value: unknown) => void;
  let finishCode!: (value: unknown) => void;
  let codes = 0;
  const request = vi.fn((method: string) => {
    if (method === "device.pair.setupStatus") return new Promise(done => { finishStatus = done; });
    if (++codes === 1) return Promise.resolve({ setupId: "old", setupCode: "OLD" });
    return new Promise(done => { finishCode = done; });
  });
  const engine = { request } as unknown as WindowEngine;
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const button = (label: string) => [...document.querySelectorAll("button")].find(b => b.textContent === label)!;
  try {
    await act(async () => { root.render(<PairDialog engine={engine} close={() => {}} />); });
    await act(async () => { button("Make the code").click(); });
    await act(async () => { vi.advanceTimersByTime(3000); });
    await act(async () => { button("Make a new code").click(); });
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].every(r => r.disabled)).toBe(true);
    await act(async () => { finishStatus({ completion: { deviceId: "old-device", deviceName: "Former phone" } }); });
    await act(async () => { finishCode({ setupId: "new", setupCode: "NEW" }); });
    expect(document.body.textContent).toContain("NEW");
    expect(document.body.textContent).not.toContain("Former phone");
    expect(document.body.textContent).not.toContain("OLD");
  } finally { await act(async () => { root.unmount(); }); host.remove(); vi.useRealTimers(); }
});
