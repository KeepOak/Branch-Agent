// @vitest-environment jsdom
// Private #1102 (Hermes A-157, Branch B-052): Updates says plainly "You’re on the latest version, checked just now",
// read from the real check (the desktop's componentUpdates.check, or the gateway's update.status refreshCheckout), and the
// time then ages on its own. A running version that is also the staged copy is never called "staged".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UpdatesPage } from "./updates";
import { checkedAgo, latestVersionLine } from "./version-line";

let host: HTMLDivElement; let root: Root;
const NOW = new Date(2026, 9, 16, 17, 0).getTime();
const desktopWindow = window as unknown as { branchDesktop?: unknown };
const engine = (request: WindowEngine["request"]): WindowEngine => ({ gatewayUrl: "ws://127.0.0.1:1", request, onEvent: () => () => {}, scopes: [], sessionKey: null });
const headline = () => host.textContent ?? "";
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text)!;

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete desktopWindow.branchDesktop; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("says the check's time once, in plain words", () => {
  expect(latestVersionLine(NOW - 5_000, NOW)).toBe("You’re on the latest version, checked just now");
  expect(latestVersionLine(NOW - 33 * 60_000, NOW)).toBe("You’re on the latest version, checked 33 min ago");
  expect(latestVersionLine(NOW - 60 * 60_000, NOW)).toBe("You’re on the latest version, checked an hour ago");
  expect(latestVersionLine(NOW - 5 * 3600_000, NOW)).toBe("You’re on the latest version, checked 5 hours ago");
  expect(latestVersionLine(NOW - 26 * 3600_000, NOW)).toBe("You’re on the latest version, checked yesterday");
  expect(checkedAgo(NOW - 3 * 86400_000, NOW)).toBe("3 days ago");
  expect(latestVersionLine(null, NOW)).toBe("You’re on the latest version");
});

it("in the Branch app, Check now runs componentUpdates.check and the line answers, then ages", async () => {
  const before = { phase: "current", currentVersion: "0.4.4", latestVersion: "0.4.4", pendingVersion: null, checkedAt: NOW - 33 * 60_000, error: null };
  const check = vi.fn(async () => ({ ...before, checkedAt: Date.now() }));
  desktopWindow.branchDesktop = { gatewayUrl: "ws://127.0.0.1:1", componentUpdates: { status: async () => before, check, stage: async () => before } };
  await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={engine(vi.fn(async () => ({})) as WindowEngine["request"])} />));
  expect(headline()).toContain("You’re on the latest version, checked 33 min ago");
  expect(headline()).not.toContain("Updates apply in place.");
  await act(async () => button("Check now").click());
  expect(check).toHaveBeenCalledTimes(1);
  expect(headline()).toContain("You’re on the latest version, checked just now");
  expect(headline()).not.toMatch(/just now.*just now/);
  await act(async () => { vi.advanceTimersByTime(2 * 60_000); });
  expect(headline()).toContain("You’re on the latest version, checked 2 min ago");
});

it("a staged copy that is the running version reads as the latest version, not staged (B-052)", async () => {
  const same = { phase: "staged", currentVersion: "0.4.4", latestVersion: "0.4.4", pendingVersion: "0.4.4", checkedAt: NOW - 10_000, error: null };
  desktopWindow.branchDesktop = { gatewayUrl: "ws://127.0.0.1:1", componentUpdates: { status: async () => same, check: async () => same, stage: async () => same } };
  await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={engine(vi.fn(async () => ({})) as WindowEngine["request"])} />));
  expect(headline()).toContain("You’re on the latest version, checked just now");
  expect(headline()).not.toContain("is staged");
});

it("on a gateway, Check now asks update.status to refresh and the headline says when", async () => {
  const request = vi.fn(async (method: string) => (method === "update.status" ? { updateAvailable: null, schedule: {} } : {}));
  await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={engine(request as unknown as WindowEngine["request"])} />));
  expect(headline()).toContain("You’re on the latest version");
  expect(headline()).not.toContain("checked");
  await act(async () => button("Check now").click());
  expect(request).toHaveBeenCalledWith("update.status", { refreshCheckout: true });
  expect(headline()).toContain("You’re on the latest version, checked just now");
  expect(headline()).not.toContain("Last checked");
});
