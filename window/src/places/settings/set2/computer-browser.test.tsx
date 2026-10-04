// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../kit";
import { BROWSER_MORE } from "./computer-browser";
import type { Ctx } from "./computer-more";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const report = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
const profiles = [{ name: "branch", driver: "branch", isDefault: true, running: true }, { name: "work", driver: "branch", isDefault: false, running: true, tabCount: 2 }, { name: "unknown", driver: "branch" }];
async function show(fail = false) {
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === "browser.request") return { profiles };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") {
      if (fail) throw new Error("Cannot save default");
      return { ok: true, hash: "h2", config: JSON.parse(String(params.raw)) };
    }
    return {};
  });
  const engine = { request, onEvent: () => () => undefined } as unknown as WindowEngine;
  const ctx = { engine } as Ctx;
  const render = BROWSER_MORE[0].rows!.find((row) => row.t === "Browser profiles")!.render!;
  await act(async () => root.render(<KitProvider level={1} report={report} scope={null}>{render(ctx)}</KitProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  return request;
}
const profile = (name: string) => host.querySelector<HTMLElement>(`[data-row="${name}"]`)!;
describe("browser profile management", () => {
  it("shows a saved default immediately while preserving the last confirmed state on failure", async () => {
    const request = await show();
    expect(profile("branch").textContent).toContain("Default");
    await act(async () => profile("work").querySelector<HTMLButtonElement>("button")!.click());
    expect(profile("work").textContent).toContain("Default");
    expect(profile("branch").querySelector(".pill")).toBeNull();
    expect(request).toHaveBeenCalledWith("config.patch", { raw: JSON.stringify({ browser: { defaultProfile: "work" } }), baseHash: "h1" });
  });
  it("keeps the service default if saving the chosen profile fails", async () => {
    await show(true);
    await act(async () => profile("work").querySelector<HTMLButtonElement>("button")!.click());
    expect(profile("branch").textContent).toContain("Default");
    expect(profile("work").querySelector(".pill")).toBeNull();
    expect(report.failed).toHaveBeenCalledWith("Cannot save default");
  });
  it("does not turn missing tab counts or running state into zero or not running", async () => {
    await show();
    expect(profile("branch").textContent).toContain("Running");
    expect(profile("branch").textContent).not.toContain("0 tabs");
    expect(profile("work").textContent).toContain("2 tabs open");
    expect(profile("unknown").textContent).not.toContain("Not running");
  });
});
