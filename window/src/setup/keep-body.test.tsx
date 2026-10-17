// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeepBody } from "./steps-later";
import { IN_BROWSER, type GatewayRunMode } from "../connect/desktop-controls";
import { GATEWAY_APP_CANT } from "../shell/gateway-mode";
import { isDevNote } from "../shell/shown-why";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
beforeEach(() => { Object.defineProperty(Navigator.prototype, "platform", { configurable: true, get: () => "Win32" }); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
});
const sw = (label: string) => host.querySelector<HTMLButtonElement>(`[role="switch"][aria-label="${label}"]`)!;
const gateway = (name: string) => [...host.querySelectorAll(".ob-seg button")].find((b) => b.textContent === name) as HTMLButtonElement;

describe("setup › Keep Branch running", () => {
  it("greys the Branch app's switches in a plain browser", async () => {
    await act(async () => root.render(<KeepBody autoUpdate onAutoUpdate={() => undefined} boot onBoot={() => undefined} />));
    for (const l of ["Start with Windows", "Type branch in any terminal"]) { expect(sw(l).disabled).toBe(true); expect(sw(l).title).toBe(IN_BROWSER); }
    for (const name of ["Off", "When needed", "On"]) expect(gateway(name).disabled).toBe(true);
    expect(host.textContent).toContain(IN_BROWSER);
    expect(isDevNote(IN_BROWSER)).toBe(false);
  });

  it("greys them for an older Branch app, without a developer note", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = {};
    await act(async () => root.render(<KeepBody autoUpdate onAutoUpdate={() => undefined} boot onBoot={() => undefined} />));
    for (const l of ["Start with Windows", "Type branch in any terminal"]) { expect(sw(l).disabled).toBe(true); expect(sw(l).title).toBe(""); }
    for (const name of ["Off", "When needed", "On"]) expect(gateway(name).disabled).toBe(true);
    expect(host.textContent).toContain(GATEWAY_APP_CANT);
    expect(isDevNote(GATEWAY_APP_CANT)).toBe(false);
    expect(visibleDevNotes(host)).toEqual([]);
  });

  it("Start with Windows is the setup choice (on by default); the branch command changes at once", async () => {
    let state = { keepWorking: true, keepAwake: false, trayUsage: false, startWithWindows: false, branchOnPath: false };
    const set = vi.fn(async (name: keyof typeof state, on: boolean) => (state = { ...state, [name]: on }));
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set } };
    const onBoot = vi.fn();
    await act(async () => root.render(<KeepBody autoUpdate onAutoUpdate={() => undefined} boot onBoot={onBoot} />));
    expect(sw("Start with Windows").getAttribute("aria-checked")).toBe("true");
    await act(async () => sw("Start with Windows").click());
    expect(onBoot).toHaveBeenCalledWith(false);
    expect(set).not.toHaveBeenCalled();
    await act(async () => sw("Type branch in any terminal").click());
    expect(set).toHaveBeenCalledWith("branchOnPath", true);
    expect(sw("Type branch in any terminal").getAttribute("aria-checked")).toBe("true");
    for (const name of ["Off", "When needed", "On"]) expect(gateway(name).disabled).toBe(true);
    expect(host.textContent).toContain(GATEWAY_APP_CANT);
  });

  it("The gateway shows the saved mode and calls setGatewayMode", async () => {
    let state = { keepWorking: true, keepAwake: false, trayUsage: false, autoApplyUpdates: true, startWithWindows: false, branchOnPath: false, gatewayMode: "on" as GatewayRunMode };
    const setGatewayMode = vi.fn(async (mode: GatewayRunMode) => (state = { ...state, gatewayMode: mode, keepWorking: mode !== "off" }));
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set: async () => state, setGatewayMode } };
    await act(async () => root.render(<KeepBody autoUpdate onAutoUpdate={() => undefined} />));
    expect(gateway("On").disabled).toBe(false);
    expect(gateway("On").getAttribute("aria-pressed")).toBe("true");
    expect(gateway("When needed").getAttribute("aria-pressed")).toBe("false");
    await act(async () => gateway("When needed").click());
    expect(setGatewayMode).toHaveBeenCalledWith("when-needed");
    expect(gateway("When needed").getAttribute("aria-pressed")).toBe("true");
    await act(async () => gateway("Off").click());
    expect(setGatewayMode).toHaveBeenLastCalledWith("off");
    expect(gateway("Off").getAttribute("aria-pressed")).toBe("true");
  });

  it("a service that could not be installed stays clickable and says why", async () => {
    const note = "Branch runs inside the app on this computer because its background service couldn't be installed (denied). Quitting Branch stops your Trunks.";
    const state = { keepWorking: true, keepAwake: false, trayUsage: false, autoApplyUpdates: true, startWithWindows: false, branchOnPath: false, gatewayMode: "when-needed" as const, notes: { keepWorking: note } };
    const setGatewayMode = vi.fn(async () => { throw new Error("Access is denied."); });
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set: async () => state, setGatewayMode } };
    await act(async () => root.render(<KeepBody autoUpdate onAutoUpdate={() => undefined} />));
    expect(host.textContent).toContain("couldn't be installed");
    expect(gateway("On").disabled).toBe(false);
    await act(async () => gateway("On").click());
    expect(setGatewayMode).toHaveBeenCalledWith("on");
    expect(host.textContent).toContain("Access is denied.");
    expect(gateway("When needed").getAttribute("aria-pressed")).toBe("true");
    expect(gateway("On").disabled).toBe(false);
  });
});
