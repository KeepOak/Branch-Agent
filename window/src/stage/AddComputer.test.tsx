// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { AddComputer } from "./AddComputer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("offers a persistent node service after pairing a computer", async () => {
  vi.useFakeTimers();
  const request = vi.fn(async (method: string) => method === "device.pair.setupCode"
    ? { setupId: "setup-1", setupCode: "PAIR-CODE" }
    : { completion: { deviceId: "nas" } });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AddComputer engine={{ request } as unknown as WindowEngine} onClose={() => undefined} onAdded={() => undefined} />));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Another computer with Branch"))!.click());
    expect(host.textContent).toContain("branch node run --pair -");
    expect(host.textContent).toContain("PAIR-CODE");
    expect(host.textContent).toContain("Copy setup code");
    expect(host.textContent).not.toContain("branch node run --pair PAIR-CODE");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(host.textContent).toContain("branch node install");
    expect(host.textContent).toContain("branch node status");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  }
});
