// @vitest-environment jsdom
// Settings › Appearance › Interface scale (Private #1100): 90-175% for the whole window, kept on this device,
// and Ctrl with +, - and 0 as in a browser.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { AppearancePage, APPEARANCE_ROWS } from "./appearance";
import { applySavedLook, forgetLookStore, installScaleKeys, stepScale } from "./appearance-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const THEMES = [{ id: "grove", name: "Grove", description: "Grove.", source: "builtin", modes: ["light", "dark"] }];

let root: Root;
let host: HTMLDivElement;
let undoKeys: (() => void) | null = null;
beforeEach(() => {
  localStorage.clear();
  forgetLookStore();
  document.head.querySelector("#branch-look")?.remove();
  document.documentElement.removeAttribute("data-size");
  document.documentElement.removeAttribute("data-scale");
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  globalThis.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof matchMedia;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  undoKeys?.();
  undoKeys = null;
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});

function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "themes.list") return { current: { id: "grove", mode: "system", scope: "profile", overrides: {} }, theme: THEMES[0], themes: THEMES };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Birch" }] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "models.list") return { models: [] };
    return { status: "ok" };
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine) {
  await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><AppearancePage page="appearance" title="Appearance" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await Promise.resolve(); });
}
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const lookCss = () => document.getElementById("branch-look")?.textContent ?? "";
const saved = () => JSON.parse(localStorage.getItem("branch.look") ?? "{}") as { device?: { scale?: unknown } };
const press = (key: string, code: string, mods: KeyboardEventInit = { ctrlKey: true }) =>
  act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true, ...mods })); });

describe("Settings › Appearance › Interface scale", () => {
  it("offers 90% to 175% and scales the whole window, kept on this device only", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    expect(["90%", "100%", "110%", "125%", "150%", "175%"].map((t) => button(t)?.tagName)).toEqual(["BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON", "BUTTON"]);
    expect(button("100%").getAttribute("aria-pressed")).toBe("true");
    await act(async () => button("125%").click());
    expect(document.documentElement.getAttribute("data-scale")).toBe("125");
    expect(lookCss()).toContain(":root:root{zoom:1.25}");
    expect(saved().device?.scale).toBe("125");
    expect(request.mock.calls.some(([m, p]) => m === "users.prefs.set" && JSON.stringify(p).includes("scale"))).toBe(false);
    await act(async () => button("100%").click());
    expect(document.documentElement.hasAttribute("data-scale")).toBe(false);
    expect(lookCss()).not.toContain("zoom");
  });

  it("the desktop app zooms the page itself instead of CSS zoom", async () => {
    const set = vi.fn();
    (window as { branchDesktop?: unknown }).branchDesktop = { zoom: { set } };
    const { engine } = engineOf();
    await render(engine);
    await act(async () => button("150%").click());
    expect(set).toHaveBeenLastCalledWith(1.5);
    expect(lookCss()).not.toContain("zoom");
  });

  it("comes back after a reload", () => {
    localStorage.setItem("branch.look", JSON.stringify({ device: { scale: "175" } }));
    applySavedLook();
    expect(document.documentElement.getAttribute("data-scale")).toBe("175");
    expect(lookCss()).toContain(":root:root{zoom:1.75}");
  });

  it("Ctrl with +, - and 0 step through the scales and stop at the ends", async () => {
    undoKeys = installScaleKeys();
    await press("=", "Equal");
    expect(document.documentElement.getAttribute("data-scale")).toBe("110");
    await press("+", "Equal", { ctrlKey: true, shiftKey: true });
    expect(document.documentElement.getAttribute("data-scale")).toBe("125");
    await press("0", "Digit0");
    expect(document.documentElement.hasAttribute("data-scale")).toBe(false);
    await press("-", "Minus");
    await press("-", "Minus");
    expect(document.documentElement.getAttribute("data-scale")).toBe("90");
    expect(saved().device?.scale).toBe("90");
    await press("=", "Equal", {});
    expect(document.documentElement.getAttribute("data-scale")).toBe("90");
    expect(stepScale(175, 1)).toBe(175);
    expect(stepScale(90, -1)).toBe(90);
  });

  it("is in the settings search", () => {
    expect(APPEARANCE_ROWS.some((r) => r.title === "Interface scale" && r.sec === "Reading")).toBe(true);
  });
});
