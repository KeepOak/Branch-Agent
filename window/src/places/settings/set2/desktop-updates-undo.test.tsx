// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UpdatesPage } from "./updates";
import { dismiss, getToasts } from "../../../shell/notify";
import { Toasts } from "../../../shell/Toasts";
import {
  showAppliedUpdateToast, UNDO_REMOVED, undoDeadline, undoShown, undoUntilCopy, UPDATED_IN_PLACE, type UndoAvailability,
} from "../../../connect/desktop-component-updates";

// Private #983: the previous engine is kept 3 days after an update, so Undo says until when, and is never a dead button.
let host: HTMLDivElement; let root: Root;
const request = vi.fn(async () => ({}));
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
const state = { phase: "current", currentVersion: "0.4.4", latestVersion: "0.4.4", pendingVersion: null, checkedAt: 123, error: null };
const desktopWindow = window as unknown as { branchDesktop?: unknown };
const NOW = new Date(2026, 9, 14, 9, 0).getTime();
const UNTIL = new Date(2026, 9, 17, 9, 0).getTime();

function desktop(availability: UndoAvailability, undo = vi.fn()) {
  desktopWindow.branchDesktop = {
    gatewayUrl: engine.gatewayUrl,
    componentUpdates: { status: async () => state, check: async () => state, stage: async () => state, install: () => {},
      undoAvailability: async () => availability, undo },
  };
  return undo;
}
async function show() { await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={engine} />)); }
const buttons = () => [...host.querySelectorAll("button")].filter((b) => /undo/i.test(b.textContent ?? ""));

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

it("formats the deadline as month and day in the owner's locale", () => {
  expect(undoDeadline(UNTIL, "en-US")).toBe("Oct 17");
  expect(undoUntilCopy(UNTIL, "en-US")).toBe("You can undo this update until Oct 17.");
  expect(undoDeadline(UNTIL, "de-DE")).toBe("17. Okt.");
});

it("during the probation, Settings offers Undo with the date it ends", async () => {
  const undo = desktop({ available: true, until: UNTIL, removed: false });
  await show();
  expect(host.textContent).toContain("Undo the last update");
  expect(host.textContent).toContain(`You can undo this update until ${undoDeadline(UNTIL)}.`);
  expect(host.textContent).not.toContain(UNDO_REMOVED);
  const [button] = buttons();
  expect(button?.textContent).toBe("Undo update");
  expect(button?.disabled).toBe(false);
  await act(async () => button!.click());
  expect(undo).toHaveBeenCalledTimes(1);
});

it("after the previous engine is pruned, there is no Undo control, only the removed-to-save-space line", async () => {
  const undo = desktop({ available: false, until: UNTIL, removed: true });
  vi.setSystemTime(UNTIL + 60_000);
  await show();
  expect(host.textContent).toContain(UNDO_REMOVED);
  expect(buttons()).toEqual([]);
  expect(undo).not.toHaveBeenCalled();
});

it("past the deadline the window never shows Undo, even before the desktop has pruned", async () => {
  desktop({ available: true, until: UNTIL, removed: false });
  vi.setSystemTime(UNTIL);
  await show();
  expect(host.textContent).toContain(UNDO_REMOVED);
  expect(host.textContent).not.toContain("You can undo this update");
  expect(buttons()).toEqual([]);
  expect(undoShown({ available: true, until: UNTIL, removed: false }, UNTIL - 1)).toBe("undo");
  expect(undoShown({ available: true, until: UNTIL, removed: false }, UNTIL)).toBe("removed");
});

it("with nothing to undo, the row is absent", async () => {
  desktop({ available: false, until: null, removed: false });
  await show();
  expect(host.textContent).not.toContain("Undo the last update");
  expect(buttons()).toEqual([]);
});

it("the update-applied toast says until when Undo is available, and offers it only then", async () => {
  const undo = vi.fn(); const report = vi.fn();
  desktopWindow.branchDesktop = { reportUpdateNotice: report, componentUpdates: { undo } };
  await act(async () => root.render(<Toasts />));
  const notice = { version: "0.4.4", canUndo: true, undoUntil: UNTIL, expiresAt: NOW + 10 * 60_000 };
  await act(async () => showAppliedUpdateToast(notice));
  const toast = host.querySelector("[data-testid=toast]");
  expect(toast?.textContent).toContain(UPDATED_IN_PLACE);
  expect(toast?.textContent).toContain(`You can undo this update until ${undoDeadline(UNTIL)}.`);
  const action = buttons().find((b) => b.textContent === "Undo update");
  expect(action?.disabled).toBe(false);
  await act(async () => action!.click());
  expect(undo).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith("undo", notice);
});

it("the update-applied toast has no Undo when the desktop says it cannot run", async () => {
  desktopWindow.branchDesktop = { reportUpdateNotice: vi.fn(), componentUpdates: { undo: vi.fn() } };
  await act(async () => root.render(<Toasts />));
  await act(async () => showAppliedUpdateToast({ version: "0.4.5", canUndo: false, undoUntil: null, expiresAt: NOW + 10 * 60_000 }));
  expect(host.querySelector("[data-testid=toast]")?.textContent).toContain(UPDATED_IN_PLACE);
  expect(host.textContent).not.toContain("You can undo this update");
  expect(buttons()).toEqual([]);
});
