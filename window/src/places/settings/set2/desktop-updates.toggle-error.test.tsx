// @vitest-environment jsdom
// Private #1093: a failed "Apply updates automatically" change leaves the switch as it was and says why, in one plain line.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { DesktopUpdatesPage } from "./desktop-updates";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
const request = vi.fn(async () => ({}));
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
const clean = { phase: "current" as const, currentVersion: "0.4.4", latestVersion: "0.4.4", pendingVersion: null, checkedAt: 123, error: null };
const controlsState = { keepWorking: true, keepAwake: true, keepAwakeOnBattery: false, trayUsage: false, autoApplyUpdates: true, agentControl: false, startWithWindows: false, branchOnPath: false };
const REASON = "Branch couldn't save this setting because the settings file is read-only.";
const desktopWindow = window as unknown as { branchDesktop?: unknown };

function desktop(set: (name: string, on: boolean) => Promise<unknown>) {
  desktopWindow.branchDesktop = {
    gatewayUrl: engine.gatewayUrl,
    componentUpdates: { status: async () => clean, check: async () => clean, stage: async () => clean, install: () => {} },
    controls: { get: async () => ({ ...controlsState }), set, openDownload: async () => {}, setTrayUsage: () => {}, onOpenUsage: () => () => {} },
  };
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const autoSwitch = () => host.querySelector<HTMLInputElement>('input[aria-label="Apply updates automatically"]');

beforeEach(() => { localStorage.clear(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete desktopWindow.branchDesktop; localStorage.clear(); });

it("a failed save keeps Apply updates automatically on and shows the reason", async () => {
  const set = vi.fn(async () => { throw new Error(REASON); });
  desktop(set);
  await act(async () => root.render(<DesktopUpdatesPage page="updates" title="Updates" level="regular" engine={engine} />));
  await flush();
  expect(autoSwitch()?.checked).toBe(true);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => autoSwitch()?.click());
  await flush();
  expect(set).toHaveBeenCalledWith("autoApplyUpdates", false);
  expect(autoSwitch()?.checked).toBe(true);
  const alert = [...host.querySelectorAll('[role="alert"]')].find((el) => el.textContent === REASON);
  expect(alert, "the reason shows as one line").toBeTruthy();
});

it("the reason goes away on the next change that saves", async () => {
  let fail = true;
  const set = vi.fn(async (_name: string, on: boolean) => { if (fail) throw new Error(REASON); return { ...controlsState, autoApplyUpdates: on }; });
  desktop(set);
  await act(async () => root.render(<DesktopUpdatesPage page="updates" title="Updates" level="regular" engine={engine} />));
  await flush();
  await act(async () => autoSwitch()?.click());
  await flush();
  expect(host.textContent).toContain(REASON);
  fail = false;
  await act(async () => autoSwitch()?.click());
  await flush();
  expect(autoSwitch()?.checked).toBe(false);
  expect(host.textContent).not.toContain(REASON);
});
