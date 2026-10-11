import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { ROWS, UpdatesPage } from "./updates";

let host: HTMLDivElement;
let root: Root;
const native = window as unknown as { branchDesktop?: unknown };
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: vi.fn(async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "0.19.4" })));
  native.branchDesktop = { gatewayUrl: engine.gatewayUrl };
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete native.branchDesktop; vi.unstubAllGlobals();
});
async function show() {
  await act(async () => root.render(<UpdatesPage page="updates" title="Updates & about" level="regular" engine={engine} />));
}
it("legacy desktop shows its shipped version and neutral Updates heading without claiming up to date", async () => {
  await show();
  expect([...host.querySelectorAll("h2")].map(node => node.textContent)).toContain("Updates");
  expect(host.textContent).toContain("Branch 0.19.4 · automatic checks");
  expect(host.querySelector(".sdot.idle")).not.toBeNull();
  expect(host.textContent).not.toContain("up to date");
  expect(host.querySelector<HTMLButtonElement>("button[disabled]")?.disabled).toBe(true);
});
it("missing shipped version is explicit rather than silently omitted", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
  await show();
  expect(host.textContent).toContain("Version unavailable");
  expect(host.textContent).not.toContain("up to date");
});
it("component desktop uses Updates even when no update is running", async () => {
  const status = { phase: "current", currentVersion: "0.19.4", latestVersion: "0.19.4", pendingVersion: null, checkedAt: 123, error: null };
  native.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: { status: async () => status, check: async () => status, stage: async () => status } };
  await show();
  expect([...host.querySelectorAll("h2")].map(node => node.textContent)).toContain("Updates");
  expect(host.textContent).toContain("Branch 0.19.4");
  expect(host.textContent).toContain("Branch is up to date.");
});
it("gateway settings and search rows use the same neutral Updates heading", async () => {
  expect(ROWS.find(row => row.title === "Check for updates")?.sec).toBe("Updates");
  delete native.branchDesktop;
  await show();
  expect([...host.querySelectorAll("h2")].map(node => node.textContent)).toContain("Updates");
  expect([...host.querySelectorAll("h2")].map(node => node.textContent)).not.toContain("Updating");
});
