// @vitest-environment jsdom
// Settings › General › Starting up (Private #1093, walkthrough B-021 / B-022): Start Branch when I sign in calls the
// desktop login-item path (startWithWindows); Keep working when nobody is signed in calls linger. A failed enable
// reverts to OFF with one plain line — never ON beside a failure, never a raw error.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { IN_BROWSER, type DesktopControlsState } from "../../../connect/desktop-controls";
import { KitProvider, type SaveReport } from "../kit";
import { configStore } from "../config-store";
import { GeneralPage } from "./general";
import {
  DESKTOP_READ_FAIL,
  KEEP_FAIL,
  KEEP_SIGNED_OUT,
  KEEP_SIGNED_OUT_UNAVAILABLE,
  START_AT_SIGN_IN,
  START_FAIL,
  START_NEEDS_UPDATE,
  desktopFailReason,
  isStartupFailureNote,
} from "./general-more";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "projects.list") return { projects: [] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
}
async function render() {
  const engine = engineOf();
  await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><GeneralPage page="general" title="General" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await configStore(engine).load(); });
}
const row = (title: string) => host.querySelector<HTMLElement>(`.ctl[data-row="${title}"]`)!;
const sw = (title: string) => row(title).querySelector<HTMLInputElement>("input")!;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };

function controls(over: Partial<DesktopControlsState> = {}): DesktopControlsState {
  return { keepWorking: true, keepAwake: false, trayUsage: false, autoApplyUpdates: true, startWithWindows: false, branchOnPath: false, ...over };
}

describe("desktopFailReason", () => {
  it("is one plain line per switch, with no raw text", () => {
    expect(desktopFailReason("startWithWindows")).toBe(START_FAIL);
    expect(desktopFailReason("keepWorkingSignedOut")).toBe(KEEP_FAIL);
    expect(START_FAIL).not.toMatch(/Error|EACCES|stack|denied\)/i);
    expect(KEEP_FAIL).not.toMatch(/Error|EACCES|stack|denied\)/i);
  });
  it("treats a leftover couldn't-install line as a failure", () => {
    expect(isStartupFailureNote("Branch runs inside the app because its background service couldn't be installed (denied).")).toBe(true);
    expect(isStartupFailureNote("Opens quietly in the tray.")).toBe(false);
  });
});

describe("Settings › General › Starting up", () => {
  it("Start Branch when I sign in calls the login-item path and shows the quiet saved line", async () => {
    let state = controls();
    const set = vi.fn(async (name: keyof DesktopControlsState, on: boolean) => (state = { ...state, [name]: on }));
    const get = vi.fn(async () => state);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get, set } };
    await render();
    expect(sw(START_AT_SIGN_IN).checked).toBe(false);
    await act(async () => sw(START_AT_SIGN_IN).click());
    await flush();
    expect(set).toHaveBeenCalledWith("startWithWindows", true);
    expect(sw(START_AT_SIGN_IN).checked).toBe(true);
    expect(row(START_AT_SIGN_IN).querySelector("[role=alert]")).toBeNull();
    expect(report.saved).toHaveBeenCalled();
    expect(report.failed).not.toHaveBeenCalled();
  });

  it("Keep working when nobody is signed in calls linger and saves quietly", async () => {
    let state = controls({ keepWorkingSignedOut: false });
    const set = vi.fn(async (name: keyof DesktopControlsState, on: boolean) => (state = { ...state, [name]: on }));
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set } };
    await render();
    expect(sw(KEEP_SIGNED_OUT).checked).toBe(false);
    expect(row(KEEP_SIGNED_OUT).getAttribute("aria-disabled")).toBeNull();
    await act(async () => sw(KEEP_SIGNED_OUT).click());
    await flush();
    expect(set).toHaveBeenCalledWith("keepWorkingSignedOut", true);
    expect(sw(KEEP_SIGNED_OUT).checked).toBe(true);
    expect(row(KEEP_SIGNED_OUT).querySelector("[role=alert]")).toBeNull();
    expect(report.saved).toHaveBeenCalled();
  });

  it("a failed enable reverts to OFF with one plain reason, never the raw error, never ON beside it", async () => {
    const state = controls({ keepWorkingSignedOut: false });
    const set = vi.fn(async (name: string) => {
      if (name === "startWithWindows") throw new Error("app.setLoginItemSettings: Access is denied (EACCES)\n    at desktop-os.ts:61");
      throw new Error("gateway linger failed: the background service couldn't be installed (denied)");
    });
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set } };
    await render();

    await act(async () => sw(START_AT_SIGN_IN).click());
    await flush();
    expect(sw(START_AT_SIGN_IN).checked).toBe(false);
    expect(row(START_AT_SIGN_IN).querySelector("[role=alert]")?.textContent).toBe(START_FAIL);
    expect(row(START_AT_SIGN_IN).textContent).not.toMatch(/EACCES|setLoginItemSettings|desktop-os/);
    expect(report.failed).toHaveBeenCalledWith(START_FAIL);

    await act(async () => sw(KEEP_SIGNED_OUT).click());
    await flush();
    expect(sw(KEEP_SIGNED_OUT).checked).toBe(false);
    expect(row(KEEP_SIGNED_OUT).querySelector("[role=alert]")?.textContent).toBe(KEEP_FAIL);
    expect(row(KEEP_SIGNED_OUT).textContent).not.toMatch(/couldn't be installed|denied|gateway linger/i);
    expect(row(KEEP_SIGNED_OUT).textContent).not.toContain("ON");
    expect(report.failed).toHaveBeenCalledWith(KEEP_FAIL);
  });

  it("an enable that does not stick reverts to OFF with the plain reason", async () => {
    const state = controls();
    const set = vi.fn(async () => state);
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set } };
    await render();
    await act(async () => sw(START_AT_SIGN_IN).click());
    await flush();
    expect(set).toHaveBeenCalledWith("startWithWindows", true);
    expect(sw(START_AT_SIGN_IN).checked).toBe(false);
    expect(row(START_AT_SIGN_IN).querySelector("[role=alert]")?.textContent).toBe(START_FAIL);
  });

  it("a leftover couldn't-install note never draws Keep working ON beside the failure", async () => {
    const state = controls({
      keepWorkingSignedOut: true,
      notes: { keepWorkingSignedOut: "Branch runs inside the app because its background service couldn't be installed (denied)." },
    });
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => state, set: vi.fn() } };
    await render();
    expect(sw(KEEP_SIGNED_OUT).checked).toBe(false);
    expect(row(KEEP_SIGNED_OUT).querySelector("[role=alert]")?.textContent).toBe(KEEP_FAIL);
    expect(row(KEEP_SIGNED_OUT).textContent).not.toMatch(/denied|couldn't be installed/i);
  });

  it("without the Branch app both switches are greyed with why", async () => {
    await render();
    for (const title of [START_AT_SIGN_IN, KEEP_SIGNED_OUT]) {
      expect(row(title).getAttribute("aria-disabled")).toBe("true");
      expect(row(title).querySelector(".why-k")?.textContent).toBe(IN_BROWSER);
      expect(sw(title).checked).toBe(false);
    }
  });

  it("an older Branch app greys Start Branch when I sign in with a plain update line", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: "ws://127.0.0.1:1" };
    await render();
    expect(row(START_AT_SIGN_IN).getAttribute("aria-disabled")).toBe("true");
    expect(row(START_AT_SIGN_IN).querySelector(".why-k")?.textContent).toBe(START_NEEDS_UPDATE);
  });

  it("Keep working is greyed with why when this computer has no linger path", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = { controls: { get: async () => controls(), set: vi.fn() } };
    await render();
    expect(row(START_AT_SIGN_IN).getAttribute("aria-disabled")).toBeNull();
    expect(row(KEEP_SIGNED_OUT).getAttribute("aria-disabled")).toBe("true");
    expect(row(KEEP_SIGNED_OUT).querySelector(".why-k")?.textContent).toBe(KEEP_SIGNED_OUT_UNAVAILABLE);
    expect(sw(KEEP_SIGNED_OUT).checked).toBe(false);
  });

  it("a failed read greys the switches with a plain line, never the raw error", async () => {
    (window as { branchDesktop?: unknown }).branchDesktop = {
      controls: { get: async () => { throw new Error("Error: ipc disconnected\n    at preload.ts:12"); }, set: vi.fn() },
    };
    await render();
    await flush();
    expect(row(START_AT_SIGN_IN).getAttribute("aria-disabled")).toBe("true");
    expect(row(START_AT_SIGN_IN).querySelector(".why-k")?.textContent).toBe(DESKTOP_READ_FAIL);
    expect(row(START_AT_SIGN_IN).textContent).not.toMatch(/ipc disconnected|preload\.ts/);
  });
});
