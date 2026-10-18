// @vitest-environment jsdom
// Private #1102 (Hermes A-159): Settings › Remove Branch removes the app and keeps your data, behind a confirm sheet that
// says exactly what goes and what stays, through the Branch app's controls bridge (desktop-controls.ts).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UpdatesBlock } from "./updates";

let host: HTMLDivElement; let root: Root;
const desktopWindow = window as unknown as { branchDesktop?: unknown };
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: vi.fn(async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
const PLAN = {
  supported: true, dataDir: "D",
  removes: ["The Branch app, with its Start menu and desktop shortcuts", "Starting Branch when you sign in"],
  keeps: ["Your conversations", "Your Trunks and what they remember", "Your settings and connected accounts"],
};
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text);
const lines = (id: string) => [...document.querySelectorAll(`[data-testid="${id}"] li`)].map((li) => li.textContent);
async function show() { await act(async () => root.render(<UpdatesBlock page="updates" title="Updates" level="regular" engine={engine} part="remove" />)); }

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; delete desktopWindow.branchDesktop; });

it("asks first, lists what goes and what stays, then removes the app through the desktop", async () => {
  const removeApp = vi.fn(async () => undefined);
  desktopWindow.branchDesktop = { controls: { get: async () => ({}), removalPlan: async () => PLAN, removeApp } };
  await show();
  expect(host.textContent).toContain("Remove the app, keep my data");
  const open = button("Remove the app…")!;
  expect(open.disabled).toBe(false);
  await act(async () => open.click());
  expect(removeApp).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Remove the Branch app?");
  expect(lines("removal-removes")).toEqual(PLAN.removes);
  expect(lines("removal-keeps")).toEqual(["Your conversations", "Your Trunks and what they remember", "Your settings and connected accounts"]);
  expect(document.body.textContent).toContain("Nothing in your data is deleted.");
  await act(async () => button("Cancel")!.click());
  expect(document.body.textContent).not.toContain("Remove the Branch app?");
  expect(removeApp).not.toHaveBeenCalled();
  await act(async () => button("Remove the app…")!.click());
  await act(async () => button("Remove the app")!.click());
  expect(removeApp).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain("Branch is closing to finish removing the app.");
});

it("says why it can't, and offers no sheet, when this install has nothing to remove", async () => {
  const removeApp = vi.fn(async () => undefined);
  desktopWindow.branchDesktop = { controls: { get: async () => ({}), removalPlan: async () => ({ ...PLAN, supported: false, reason: "Branch was installed by your package manager here. Remove it there; your data stays.", removes: [] }), removeApp } };
  await show();
  expect(button("Remove the app…")!.disabled).toBe(true);
  await act(async () => button("Remove the app…")!.click());
  expect(document.body.textContent).not.toContain("Remove the Branch app?");
  expect(removeApp).not.toHaveBeenCalled();
});

it("in a browser there is no app to remove, so the button stays greyed", async () => {
  await show();
  expect(host.textContent).toContain("Remove the app, keep my data");
  expect(button("Remove the app…")!.disabled).toBe(true);
});
