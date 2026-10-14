// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UpdatesPage } from "./updates";
import { undoVersionLine } from "./desktop-updates";
import { dismiss, getToasts } from "../../../shell/notify";
import { Toasts } from "../../../shell/Toasts";
import { showAppliedUpdateToast, undoOpen, UPDATED_IN_PLACE, type UndoAvailability } from "../../../connect/desktop-component-updates";

// Private #983: the previous engine is kept 3 days after an update. Owner ruling on #1461: Settings › Updating shows the
// preview's row as it is ("Undo the last update", Undo, "0.19.4 installed Sep 20."), with no deadline copy, and the row is
// there only while Undo can run, so it is never a dead button.
let host: HTMLDivElement; let root: Root;
const request = vi.fn(async () => ({}));
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
const state = { phase: "current", currentVersion: "0.4.4-build-c27f2be23320", latestVersion: "0.4.4-build-c27f2be23320", pendingVersion: null, checkedAt: 123, error: null };
const desktopWindow = window as unknown as { branchDesktop?: unknown };
const INSTALLED = new Date(2026, 9, 14, 8, 0).getTime();
const NOW = new Date(2026, 9, 14, 9, 0).getTime();
const UNTIL = new Date(2026, 9, 17, 8, 0).getTime();
const open: UndoAvailability = { available: true, until: UNTIL, removed: false, version: "0.4.4-build-c27f2be23320", installedAt: INSTALLED };

function desktop(availability: UndoAvailability, undo = vi.fn()) {
  desktopWindow.branchDesktop = {
    gatewayUrl: engine.gatewayUrl,
    componentUpdates: { status: async () => state, check: async () => state, stage: async () => state, install: () => {},
      undoAvailability: async () => availability, undo },
  };
  return undo;
}
async function show() { await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={engine} />)); }
const undoButtons = () => [...host.querySelectorAll("button")].filter((b) => /undo/i.test(b.textContent ?? ""));
const row = () => [...host.querySelectorAll(".ctl, [class*=ctl]")].find((el) => el.textContent?.startsWith("Undo the last update"));

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete desktopWindow.branchDesktop; vi.useRealTimers();
  getToasts().forEach((toast) => dismiss(toast.id));
});

it("the version line is the preview's form: the release, then installed and its month and day", () => {
  expect(undoVersionLine({ ...open, version: "0.19.4" }, "en-US")).toBe(`0.19.4 installed Oct 14.`);
  expect(undoVersionLine(open, "en-US")).toBe("0.4.4 installed Oct 14.");
  expect(undoVersionLine({ ...open, installedAt: new Date(2026, 8, 20, 12, 0).getTime(), version: "0.19.4" }, "en-US")).toBe("0.19.4 installed Sep 20.");
  expect(undoVersionLine({ ...open, version: null }, "en-US")).toBeNull();
});

it("during the probation, Settings shows the preview's row: Undo over the version line, with no deadline copy", async () => {
  const undo = desktop(open);
  await show();
  expect(host.textContent).toContain("Undo the last update");
  expect(host.textContent).toContain(undoVersionLine(open));
  expect(host.textContent).not.toMatch(/You can undo this update|until|for a few days|removed to save space/);
  const buttons = undoButtons();
  expect(buttons.map((b) => b.textContent)).toEqual(["Undo"]);
  expect(buttons[0]!.disabled).toBe(false);
  expect(row()?.textContent).toBe(`Undo the last updateUndo${undoVersionLine(open)}`);
  await act(async () => buttons[0]!.click());
  expect(undo).toHaveBeenCalledTimes(1);
});

it("after the previous engine is pruned, the row is gone: no Undo and no removed line", async () => {
  const undo = desktop({ ...open, available: false, removed: true });
  vi.setSystemTime(UNTIL + 60_000);
  await show();
  expect(host.textContent).not.toContain("Undo the last update");
  expect(host.textContent).not.toMatch(/removed to save space|You can undo this update/);
  expect(undoButtons()).toEqual([]);
  expect(undo).not.toHaveBeenCalled();
});

it("past the probation the window shows no enabled Undo, even before the desktop has pruned", async () => {
  desktop(open);
  vi.setSystemTime(UNTIL);
  await show();
  expect(host.textContent).not.toContain("Undo the last update");
  expect(undoButtons().filter((b) => !b.disabled)).toEqual([]);
  expect(undoOpen(open, UNTIL - 1)).toBe(true);
  expect(undoOpen(open, UNTIL)).toBe(false);
  expect(undoOpen({ ...open, available: false, removed: true }, NOW)).toBe(false);
  expect(undoOpen(null, NOW)).toBe(false);
});

it("with nothing to undo, the row is absent", async () => {
  desktop({ available: false, until: null, removed: false, version: null, installedAt: null });
  await show();
  expect(host.textContent).not.toContain("Undo the last update");
  expect(undoButtons()).toEqual([]);
});

it("the update-applied toast is the preview's, with no deadline copy and no Undo action", async () => {
  const undo = vi.fn(); const report = vi.fn();
  desktopWindow.branchDesktop = { reportUpdateNotice: report, componentUpdates: { undo } };
  await act(async () => root.render(<Toasts />));
  const notice = { version: "0.4.4", canUndo: true, expiresAt: NOW + 10 * 60_000 };
  await act(async () => showAppliedUpdateToast(notice));
  const toast = host.querySelector("[data-testid=toast]");
  expect(toast?.textContent).toContain(UPDATED_IN_PLACE);
  expect(toast?.textContent).not.toMatch(/You can undo this update|until/);
  expect(undoButtons()).toEqual([]);
  expect(report).toHaveBeenCalledWith("shown", notice);
});
