// @vitest-environment jsdom
import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "./engine";
import { UpdatesPage } from "../places/settings/set2/updates";
import { dismiss, getToasts } from "../shell/notify";
import { Toasts } from "../shell/Toasts";
import {
  componentDesktop, createUpdateNoticeHub, setupBlocksUpdateToast, showAppliedUpdateToast, stageWindowUpdate,
  UPDATED_IN_PLACE, UPDATE_TOAST_SETUP_WAIT_MS, useDesktopAppliedUpdateNotice,
} from "./desktop-component-updates";
import { StatusPopover, type StatusContext } from "../shell/StatusLayer";
import { useUpdate } from "../shell/use-status";
import type { SaplingSession } from "./session";
import { VersionPopover } from "../shell/StatusPopovers";

let host: HTMLDivElement; let root: Root;
const state = { phase: "available", currentVersion: "1.0", latestVersion: "1.1", pendingVersion: null, checkedAt: 123, error: null };
const request = vi.fn(async () => ({}));
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
const desktopWindow = window as unknown as { branchDesktop?: unknown };
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  request.mockClear(); localStorage.setItem("branch-draft", "unfinished input");
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete desktopWindow.branchDesktop; vi.restoreAllMocks(); vi.useRealTimers();
  document.querySelectorAll(".ob-main, .ob9").forEach((node) => node.remove());
  getToasts().forEach((toast) => dismiss(toast.id));
});
async function show() { await act(async () => root.render(<UpdatesPage page="updates" title="Updates & about" level="regular" engine={engine} />)); }
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(row => row.textContent === text);
  if (!button) throw new Error(`missing button ${text}`);
  await act(async () => button.click());
}

it("actual native Check now and Download update use component bridge and never generic gateway updates", async () => {
  const status = vi.fn(async () => state); const check = vi.fn(async () => state);
  const stage = vi.fn(async () => ({ ...state, phase: "staged", pendingVersion: "1.1" }));
  desktopWindow.branchDesktop = { gatewayUrl: "ws://127.0.0.1:1", componentUpdates: { status, check, stage } };
  await show(); await click("Check now"); await click("Download update");
  expect(status).toHaveBeenCalledTimes(1); expect(check).toHaveBeenCalledTimes(1); expect(stage).toHaveBeenCalledTimes(1);
  expect(request).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Update staged; waiting for a safe switch");
  expect(localStorage.getItem("branch-draft")).toBe("unfinished input");
});

it("Updates & about shows the running build and hides a leftover older staged shell", async () => {
  const leftover = {
    phase: "staged", currentVersion: "0.4.4-build-c27f2be23320", latestVersion: "4b72e314c692",
    pendingVersion: "4b72e314c692", checkedAt: 123, error: null,
  };
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: {
    status: async () => leftover, check: async () => leftover, stage: async () => leftover,
  } };
  await show();
  expect(host.textContent).toContain("Branch 0.4.4 · build c27f2be2 on this computer");
  expect(host.textContent).toContain("You have Branch 0.4.4 · build c27f2be2");
  expect(host.textContent).toContain("Branch is up to date.");
  expect(host.textContent).not.toContain("Update staged; waiting for a safe switch");
  expect(host.textContent).not.toContain("A Branch update is ready; restart to finish");
});

it("Updates toggle is on by default and staged updates wait for Trunks in Settings and version popover", async () => {
  const staged = { ...state, phase: "staged", pendingVersion: "1.1" };
  const set = vi.fn(async (_name: string, on: boolean) => ({ keepWorking: true, keepAwake: false, trayUsage: false,
    autoApplyUpdates: on, startWithWindows: false, branchOnPath: false }));
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl,
    componentUpdates: { status: async () => staged, check: async () => staged, stage: async () => staged },
    controls: { get: async () => ({ keepWorking: true, keepAwake: false, trayUsage: false,
      autoApplyUpdates: true, startWithWindows: false, branchOnPath: false }), set } };
  await show();
  const toggle = host.querySelector<HTMLInputElement>('input[aria-label="Apply updates automatically"]');
  expect(toggle?.checked).toBe(true);
  expect(host.textContent).toContain("Update staged; waiting for a safe switch");
  if (!toggle) throw new Error("missing auto-apply toggle");
  await act(async () => toggle.click());
  expect(set).toHaveBeenCalledWith("autoApplyUpdates", false);
  expect(host.textContent).toContain("A Branch update is ready; restart to finish");
  expect(host.textContent).not.toContain("1.1 is ready");
  await act(async () => root.unmount()); root = createRoot(host);
  const session = { engine, gatewayUrl: engine.gatewayUrl, request } as unknown as SaplingSession;
  const ctx = { session, update: null, version: "1.0", onWhatsNew: vi.fn(), onReminded: vi.fn() } as unknown as StatusContext;
  await act(async () => root.render(<StatusPopover item="version" above={{ left: 10, right: 200, top: 700, align: "right" }} onClose={() => {}} ctx={ctx} />));
  expect(host.textContent).toContain("Update ready, applying when your Trunks finish");
});

it("legacy native bootstrap says it checks every ten minutes, greys Check now, and never falls back to update.run or update.status", async () => {
  desktopWindow.branchDesktop = { gatewayUrl: "ws://127.0.0.1:1" };
  const updateCalls = () => request.mock.calls.filter((call: unknown[]) => String(call[0]).startsWith("update."));
  await show(); expect(host.textContent).toContain("Branch checks for updates every 10 minutes and lets you know when one is ready to apply.");
  expect(host.textContent).not.toContain("aren’t available");
  const check = [...host.querySelectorAll("button")].find(row => row.textContent === "Check now");
  expect(check?.disabled).toBe(true); expect(host.textContent).toContain("Update the Branch app to check by hand.");
  expect(updateCalls()).toEqual([]);
  await expect(stageWindowUpdate(engine)).rejects.toThrow("Update the Branch app to check by hand.");
  expect(updateCalls()).toEqual([]);
});

it("browser install keeps existing engine behavior", async () => {
  await stageWindowUpdate(engine); expect(request).toHaveBeenCalledWith("update.run", {});
});

it("native stage error is truthful and preserves drafts without gateway fallback", async () => {
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: { status: async () => state, check: async () => state,
    stage: async () => ({ ...state, phase: "error", error: "Release download failed (404)" }) } };
  await expect(stageWindowUpdate(engine)).rejects.toThrow("Release download failed (404)");
  expect(request).not.toHaveBeenCalled(); expect(localStorage.getItem("branch-draft")).toBe("unfinished input");
});

it("Connect elsewhere uses the remote engine updater and cannot stage local desktop components", async () => {
  const stage = vi.fn(async () => state);
  desktopWindow.branchDesktop = { gatewayUrl: "ws://127.0.0.1:1", componentUpdates: { status: async () => state, check: async () => state, stage } };
  const remote = { ...engine, gatewayUrl: "wss://remote.example.test" } as WindowEngine;
  await stageWindowUpdate(remote);
  expect(stage).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledWith("update.run", {});
});

it("unknown native connection cannot use local IPC or fall back to the generic updater", async () => {
  const stage = vi.fn(async () => state);
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: { status: async () => state, check: async () => state, stage } };
  await expect(stageWindowUpdate({ request: engine.request })).rejects.toThrow("connected to a different computer’s engine");
  expect(stage).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});

it("actual Version popover install uses the same native stage bridge", async () => {
  const stage = vi.fn(async () => ({ ...state, phase: "staged", pendingVersion: "1.1" }));
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: { status: async () => state, check: async () => state, stage } };
  const session = { engine, gatewayUrl: engine.gatewayUrl, request } as unknown as SaplingSession;
  const ctx = { session, update: { current: "1.0", latest: "1.1", notes: [], installing: false, waiting: null }, version: "1.0", onWhatsNew: vi.fn(), onReminded: vi.fn() } as unknown as StatusContext;
  await act(async () => root.render(<StatusPopover item="version" above={{ left: 10, right: 200, top: 700, align: "left" }} onClose={() => {}} ctx={ctx} />));
  const button = document.querySelector<HTMLButtonElement>('[data-testid="ver-install"]');
  if (!button) throw new Error("missing actual Version install control");
  await act(async () => button.click());
  expect(stage).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
});

it("remote and browser release notices show where to install, without an Install button", async () => {
  const update = { current: "1.0", latest: "1.1", notes: [], installing: false, waiting: null };
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: { status: async () => state, check: async () => state, stage: async () => state } };
  for (const gatewayUrl of ["wss://remote.example.test", engine.gatewayUrl]) {
    if (gatewayUrl === engine.gatewayUrl) delete desktopWindow.branchDesktop;
    const session = { engine, gatewayUrl, request } as unknown as SaplingSession;
    const ctx = { session, update, version: "1.0", computerName: "Desk", onWhatsNew: vi.fn(), onReminded: vi.fn() } as unknown as StatusContext;
    await act(async () => root.render(<StatusPopover item="version" above={{ left: 10, right: 200, top: 700, align: "left" }} onClose={() => {}} ctx={ctx} />));
    expect(host.textContent).toContain("Ready to install on Desk: open Branch there to install it.");
    expect(host.querySelector('[data-testid="ver-install"]')).toBeNull();
  }
  expect(request).not.toHaveBeenCalledWith("update.run", {});
});

function UpdateProbe({ gatewayUrl }: { gatewayUrl: string }) {
  const session = useMemo(() => ({ gatewayUrl, request, getSnapshot: () => ({ status: { phase: "connected", hello: { snapshot: {} } } }), onGatewayEvent: () => () => {} }) as unknown as SaplingSession, [gatewayUrl]);
  const update = useUpdate(session, true, "1.0");
  return <VersionPopover update={update} version="1.0" above={{ left: 10, right: 200, top: 700, align: "left" }} onClose={() => {}} onWhatsNew={() => {}} onInstall={() => {}} onRemind={() => {}} />;
}

it("native shell status uses component status and legacy shell reports unsupported truthfully", async () => {
  const status = vi.fn(async () => state);
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: { status, check: async () => state, stage: async () => state } };
  await act(async () => root.render(<UpdateProbe gatewayUrl="ws://127.0.0.1:1/" />));
  expect(status).toHaveBeenCalledTimes(1); expect(request).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Branch 1.1 is ready");
  await act(async () => root.unmount()); root = createRoot(host);
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl };
  await act(async () => root.render(<UpdateProbe gatewayUrl="ws://127.0.0.1:1" />));
  expect(document.body.textContent).toContain("Update the Branch app to check by hand.");
  expect(document.body.textContent).not.toContain("Branch is up to date."); expect(request).not.toHaveBeenCalled();
});

it("actual Settings Check now for Connect elsewhere keeps the remote gateway dispatch", async () => {
  const status = vi.fn(async () => state); const check = vi.fn(async () => state);
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: { status, check, stage: async () => state } };
  const remote = { ...engine, gatewayUrl: "wss://remote.example.test" };
  await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={remote} />));
  await click("Check now");
  expect(status).not.toHaveBeenCalled(); expect(check).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledWith("update.status", { refreshCheckout: true });
});

it("keeps native update controls scoped to the live handoff target", () => {
  const native = { gatewayUrl: "ws://127.0.0.1:1", getGatewayUrl: () => "ws://127.0.0.1:2", componentUpdates: { status: async () => state, check: async () => state, stage: async () => state } };
  desktopWindow.branchDesktop = native;
  expect(componentDesktop("ws://127.0.0.1:2")).toBe(native);
  expect(componentDesktop("ws://127.0.0.1:1")).toBeUndefined();
});

const applied = { version: "0.4.4", canUndo: true, expiresAt: Date.now() + 10 * 60_000 };

it("shows the preview in-place toast from update-applied and logs shown then dismissed", async () => {
  const report = vi.fn();
  let listener: ((notice: typeof applied) => void) | undefined;
  desktopWindow.branchDesktop = {
    onUpdateApplied: (fn: (notice: typeof applied) => void) => { listener = fn; return () => { listener = undefined; }; },
    reportUpdateNotice: report,
  };
  function Probe() { useDesktopAppliedUpdateNotice(); return <Toasts />; }
  await act(async () => root.render(<Probe />));
  expect(listener).toEqual(expect.any(Function));
  await act(async () => listener?.(applied));
  expect(host.querySelector("[data-testid=toast]")?.textContent).toContain(UPDATED_IN_PLACE);
  expect(report).toHaveBeenCalledWith("shown", applied);
  await act(async () => host.querySelector<HTMLButtonElement>(".toast-x")!.click());
  expect(host.querySelector("[data-testid=toast]")).toBeNull();
  expect(report).toHaveBeenCalledWith("dismissed", applied);
});

it("waits while setup is on screen before showing the in-place toast", async () => {
  vi.useFakeTimers();
  const report = vi.fn();
  desktopWindow.branchDesktop = { reportUpdateNotice: report };
  const setup = document.body.appendChild(document.createElement("div"));
  setup.className = "ob9";
  expect(setupBlocksUpdateToast()).toBe(true);
  showAppliedUpdateToast(applied);
  expect(getToasts()).toEqual([]);
  expect(report).not.toHaveBeenCalled();
  setup.remove();
  await act(async () => { vi.advanceTimersByTime(UPDATE_TOAST_SETUP_WAIT_MS); });
  expect(getToasts().map((toast) => toast.text)).toEqual([UPDATED_IN_PLACE]);
  expect(report).toHaveBeenCalledWith("shown", applied);
});

it("logs expired when setup outlasts the update notice", async () => {
  vi.useFakeTimers();
  const report = vi.fn();
  desktopWindow.branchDesktop = { reportUpdateNotice: report };
  const setup = document.body.appendChild(document.createElement("div"));
  setup.className = "ob-main";
  const stale = { ...applied, expiresAt: Date.now() + UPDATE_TOAST_SETUP_WAIT_MS - 1 };
  showAppliedUpdateToast(stale);
  await act(async () => { vi.advanceTimersByTime(UPDATE_TOAST_SETUP_WAIT_MS); });
  expect(getToasts()).toEqual([]);
  expect(report).toHaveBeenCalledWith("expired", stale);
});

it("shows the in-place toast when update-applied arrives before subscribe and the status bar is hidden", async () => {
  const report = vi.fn();
  const hub = createUpdateNoticeHub();
  desktopWindow.branchDesktop = { ...hub, reportUpdateNotice: report };
  hub.pushApplied(applied);
  await act(async () => root.render(<Toasts />));
  expect(host.querySelector("[data-testid=toast]")?.textContent).toContain(UPDATED_IN_PLACE);
  expect(report).toHaveBeenCalledWith("shown", applied);
  expect(report.mock.calls.filter((call) => call[0] === "shown")).toHaveLength(1);
});

it("dedupes the same update version across live delivery and subscribe replay", async () => {
  const report = vi.fn();
  const hub = createUpdateNoticeHub();
  desktopWindow.branchDesktop = { ...hub, reportUpdateNotice: report };
  await act(async () => root.render(<Toasts />));
  await act(async () => hub.pushApplied(applied));
  await act(async () => hub.pushApplied(applied));
  expect(host.querySelectorAll("[data-testid=toast]")).toHaveLength(1);
  expect(report.mock.calls.filter((call) => call[0] === "shown")).toHaveLength(1);
});

it("dismisses the in-place toast when update-undone arrives through the new path", async () => {
  const report = vi.fn();
  const hub = createUpdateNoticeHub();
  desktopWindow.branchDesktop = { ...hub, reportUpdateNotice: report };
  await act(async () => root.render(<Toasts />));
  await act(async () => hub.pushApplied(applied));
  expect(host.querySelector("[data-testid=toast]")?.textContent).toContain(UPDATED_IN_PLACE);
  await act(async () => hub.pushUndone());
  expect(host.querySelector("[data-testid=toast]")).toBeNull();
});
