// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ADD_COMPUTER_UNREACHABLE, AddComputer } from "./AddComputer";

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


it("shows a device-neutral loopback failure when pairing another computer", async () => {
  localStorage.setItem("branch.level", "regular");
  const loopbackError = "Gateway is only bound to loopback. Set gateway.publicOrigin to your public HTTPS origin, configure plugins.entries.device-pair.config.publicUrl, enable tailscale serve, or set gateway.bind=lan.";
  const request = vi.fn(async (method: string) => {
    if (method === "device.pair.setupCode") throw new Error(loopbackError);
    return {};
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AddComputer engine={{ request } as unknown as WindowEngine} onClose={() => undefined} onAdded={() => undefined} />));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Another computer with Branch"))!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(ADD_COMPUTER_UNREACHABLE);
    expect(host.textContent).not.toMatch(/Your phone|publicOrigin|gateway\.bind|tailscale serve/i);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem("branch.level");
  }
});

// #1814: at Regular every Add a computer failure is one plain sentence with a next step; Advanced keeps the exact words.
const LOOPBACK = "Gateway is only bound to loopback. Set gateway.publicOrigin to your public HTTPS origin, or set gateway.bind=lan.";
const RAW = "Error: connect ECONNREFUSED 127.0.0.1:18789\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1555:16)";

async function failure(level: string, fail: string, pick: string, raw: string): Promise<string> {
  localStorage.setItem("branch.level", level);
  const request = vi.fn(async (method: string) => {
    if (method === fail) throw new Error(raw);
    return { profiles: [{ id: "aws-east", providerId: "aws" }] };
  });
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AddComputer engine={{ request } as unknown as WindowEngine} onClose={() => undefined} onAdded={() => undefined} />));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes(pick))!.click());
    if (fail === "environments.create") {
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("aws"))!.click());
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Continue")!.click());
    }
    return host.querySelector('[role="alert"]')?.textContent ?? "";
  } finally {
    await act(async () => root.unmount());
    host.remove();
    localStorage.removeItem("branch.level");
  }
}

it("says each Add a computer failure in one plain sentence with a next step at Regular (#1814)", async () => {
  const cases: [string, string, string][] = [
    ["device.pair.setupCode", "Another computer with Branch", LOOPBACK],
    ["device.pair.setupCode", "Another computer with Branch", RAW],
    ["environments.list", "A cloud computer", RAW],
    ["environments.create", "A cloud computer", RAW],
  ];
  for (const [fail, pick, raw] of cases) {
    const said = await failure("regular", fail, pick, raw);
    expect(said, fail).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|TCPConnectWrap|node:net|gateway\.|publicOrigin|loopback/i);
    // One plain sentence, then a next step: "… try again …" or "… then make a new code."
    expect(said, fail).toMatch(/^[^.]+\. .*\b(?:try again|then make a new code)\b.*\.$/i);
  }
  expect(await failure("regular", "device.pair.setupCode", "Another computer with Branch", LOOPBACK)).toBe(ADD_COMPUTER_UNREACHABLE);
});

it("keeps the exact words of an Add a computer failure at Advanced (#1814)", async () => {
  expect(await failure("advanced", "device.pair.setupCode", "Another computer with Branch", LOOPBACK)).toBe(LOOPBACK);
  expect(await failure("advanced", "environments.list", "A cloud computer", RAW)).toBe(RAW.replace(/^Error: /, ""));
});
