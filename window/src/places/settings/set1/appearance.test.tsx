// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { AppearancePage, APPEARANCE_ROWS } from "./appearance";
import { BUILTIN, contrast, fromPalette, SLATE, toPalette } from "./appearance-look";
import { LEGACY_THEMES } from "./appearance-legacy";
import { forgetLookStore, lookStore } from "./appearance-store";
import { readThemeCode, themeCode } from "./appearance-themes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const THEMES = [["grove", "Grove"], ["paper", "Paper"], ["dracula", "Dracula"]].map(([id, name]) => ({ id, name, description: `${name}.`, source: "builtin", modes: ["light", "dark"] }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  forgetLookStore();
  document.head.querySelector("#branch-look")?.remove();
  document.documentElement.removeAttribute("data-size");
  globalThis.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof matchMedia;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(opts: { profile?: boolean; prefs?: Record<string, unknown>; current?: string; conflicts?: number; themes?: typeof THEMES; themesResponse?: Promise<unknown> } = {}) {
  const prefs: Record<string, unknown> = { ...opts.prefs };
  let conflicts = opts.conflicts ?? 0;
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "users.prefs.get") return opts.profile === false ? { status: "no_durable_identity" } : { status: "ok", entries: { ...prefs } };
    if (method === "users.prefs.set") { if (conflicts-- > 0) return { status: "conflict" }; Object.assign(prefs, params?.entries); return { status: "ok" }; }
    if (method === "themes.list") return opts.themesResponse ?? { current: { id: opts.current ?? "grove", mode: "system", scope: "profile", overrides: {} }, theme: THEMES[0], themes: opts.themes ?? THEMES };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Birch" }] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "models.list") return { models: [] };
    return { status: "ok" };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine;
  return { engine, request, prefs };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><AppearancePage page="appearance" title="Appearance" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await Promise.resolve(); });
}
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;
const sw = (label: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const rows = () => [...host.querySelectorAll(".ctl > b")].map((b) => b.textContent);

describe("Settings › Appearance", () => {
  it("keeps pet-sound rationale in help without hiding the row description", async () => {
    const { engine } = engineOf();
    await render(engine);
    const row = host.querySelector('[data-row="Pet sounds"]')!;
    expect(row.querySelector("small")?.textContent).toContain("A tiny sound when you pat it.");
    expect(row.textContent).not.toContain("Off until you turn it on.");
    await act(async () => window.dispatchEvent(new Event("branch-settings-help")));
    expect(document.querySelector(".kit-help-pop")?.textContent).toContain("Pet sounds");
    expect(document.querySelector(".kit-help-pop")?.textContent).toContain("Off until you turn it on.");
  });

  it("draws a selected painted scene and holds to peek without a blank overlay", async () => {
    const { engine } = engineOf();
    await render(engine);
    await act(async () => { await lookStore(engine).set("bg", "painted"); await lookStore(engine).set("scene", "night17-lake"); });
    expect(document.documentElement.hasAttribute("data-scene")).toBe(true);
    expect(document.head.querySelector("#branch-look")?.textContent).toContain("/assets/art17/bg/lake-night.webp");
    const peek = button("See it clearly");
    expect(peek.disabled).toBe(false);
    expect(host.textContent).toContain("Hold it to see the background on its own.");
    await act(async () => peek.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })));
    expect(document.documentElement.classList.contains("scene-peek")).toBe(true);
    await act(async () => window.dispatchEvent(new Event("pointerup")));
    expect(document.documentElement.classList.contains("scene-peek")).toBe(false);
    await act(async () => peek.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })));
    expect(document.documentElement.classList.contains("scene-peek")).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })));
    expect(document.documentElement.classList.contains("scene-peek")).toBe(false);
    const shellEscape = vi.fn();
    window.addEventListener("keydown", shellEscape);
    await act(async () => peek.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true })));
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.documentElement.classList.contains("scene-peek")).toBe(false);
    expect(shellEscape).not.toHaveBeenCalled();
    window.removeEventListener("keydown", shellEscape);
    await act(async () => lookStore(engine).set("bg", "oak3d"));
    expect(button("See it clearly").disabled).toBe(true);
    expect(host.textContent).toContain("Not drawn yet.");
    await act(async () => lookStore(engine).set("bg", "rings"));
    expect(button("See it clearly").disabled).toBe(true);
  });

  it("uses the full scrim and see-through slider ranges", async () => {
    const { engine } = engineOf();
    await render(engine);
    await act(async () => { await lookStore(engine).set("bg", "painted"); await lookStore(engine).set("scrim", 0); await lookStore(engine).set("see", 0); });
    expect(document.getElementById("branch-look")?.textContent).toContain("--scene-cover:0%;--scene-panel:100%");
    await act(async () => { await lookStore(engine).set("scrim", 90); await lookStore(engine).set("see", 60); });
    expect(document.getElementById("branch-look")?.textContent).toContain("--scene-cover:90%;--scene-panel:40%");
  });
  it("draws the theme, the gallery button and the mirrors from the engine", async () => {
    const { engine } = engineOf();
    await render(engine);
    expect(host.querySelector(".theme-now .grow > b")?.textContent).toBe("Branch Slate");
    expect(button("Browse all 3 themes")).toBeTruthy();
    expect([...host.querySelectorAll(".mirror b")].map((b) => b.textContent)).toEqual(["Light · live mirror of Birch", "Dark · live mirror of Birch", "Match this computer"]);
    expect(host.querySelectorAll(".pet-c12").length).toBe(43);
  });

  it("shows 46 themes once loaded and never 0 while themes exist", async () => {
    const catalog = [["grove", "Grove"], ["paper", "Paper"], ...LEGACY_THEMES.map((t) => [t.id, t.name])].map(([id, name]) => ({ id, name, description: `${name}.`, source: "builtin" as const, modes: ["light", "dark"] as ("light" | "dark")[] }));
    let resolveThemes!: (value: unknown) => void;
    const themesResponse = new Promise<unknown>((resolve) => { resolveThemes = resolve; });
    const { engine } = engineOf({ themesResponse });
    await render(engine);
    expect(button("Browse themes")).toBeTruthy();
    expect(host.textContent).not.toContain("Browse all 0 themes");
    await act(async () => resolveThemes({ current: { id: "grove", mode: "system" }, themes: catalog }));
    expect(button("Browse all 46 themes")).toBeTruthy();
    expect(host.textContent).not.toContain("Browse all 0 themes");
    await act(async () => button("Browse all 46 themes").click());
    expect(document.querySelectorAll(".dlg .theme6-b")).toHaveLength(46);
  });

  it("a switch saves the person's look to users.prefs at once", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    expect([...document.querySelectorAll(".sec h2")].filter((heading) => heading.textContent === "Reading")).toHaveLength(1);
    await act(async () => sw("Keep things still").click());
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { "ui.window.look": { still: true } }, expectedEntries: { "ui.window.look": null } });
    expect(document.documentElement.classList.contains("still-k")).toBe(true);
    expect(report.saved).toHaveBeenCalled();
  });

  it("an accent goes to the engine's own ui.accent and onto the window", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Accent #E0A526"]')!.click());
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { "ui.accent": "#e0a526" } });
    expect(document.getElementById("branch-look")?.textContent).toContain("--accent:#e0a526");
  });

  it("text size stays on this device", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => button("Larger").click());
    expect(document.documentElement.getAttribute("data-size")).toBe("larger");
    expect(request.mock.calls.some(([m, p]) => m === "users.prefs.set" && JSON.stringify(p).includes("size"))).toBe(false);
  });

  it("picking a theme calls themes.set and puts the accent and fonts back to the theme’s own", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => button("Browse all 3 themes").click());
    await act(async () => document.querySelector<HTMLButtonElement>('.dlg .theme6-b[aria-label="Dracula"]')!.click());
    expect(request).toHaveBeenCalledWith("themes.set", { id: "dracula", appearance: { accent: null, fontUi: null, fontChat: null } });
  });

  it("the chosen theme's colours reach the window in both modes", async () => {
    const { engine } = engineOf({ current: "dracula" });
    await render(engine);
    const css = document.getElementById("branch-look")?.textContent ?? "";
    expect(css).toContain(":root:root{--bg:#f1eff6");
    expect(css).toContain(':root:root[data-theme="dark"]{--bg:#282a36');
    expect(host.querySelector(".theme-now .grow > b")?.textContent).toBe("Dracula");
  });

  it("browses the 46 classic themes by group and previews Dracula in both modes", async () => {
    const catalog = [["grove", "Grove"], ["paper", "Paper"], ...LEGACY_THEMES.map((t) => [t.id, t.name])].map(([id, name]) => ({ id, name, description: `${name}.`, source: "builtin", modes: ["light", "dark"] }));
    const { engine } = engineOf({ themes: catalog });
    await render(engine);
    await act(async () => button("Browse all 46 themes").click());
    expect(document.querySelectorAll(".dlg .theme6-b")).toHaveLength(46);
    await act(async () => button("Editors & terminals", document).click());
    expect(document.querySelectorAll(".dlg .theme6-b")).toHaveLength(25);
    expect(document.querySelector<HTMLButtonElement>('.dlg .theme6-b[aria-label="Dracula"]')).toBeTruthy();
    await act(async () => button("Daylight", document).click());
    expect(BUILTIN.dracula.light.bg).toBe("#f1eff6");
    expect(BUILTIN.dracula.dark.bg).toBe("#282a36");
  });

  it("Make your own imports the colours as the person's theme", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => button("Make your own").click());
    await act(async () => button("Save theme", document)!.click());
    const call = request.mock.calls.find(([m]) => m === "themes.import") as unknown as [string, { id: string; apply: boolean; definition: { name: string; light: Record<string, string> } }];
    expect(call[1].apply).toBe(true);
    expect(call[1].definition.name).toBe("My theme");
    expect(call[1].definition.light.background).toBe(SLATE.light.bg);
    expect(call[1].id).toMatch(/^my-theme-[a-z0-9]+$/);
  });

  it("Regular hides the Advanced and Technical rows", async () => {
    const { engine } = engineOf();
    await render(engine, 0);
    expect(rows()).not.toContain("Interface font");
    expect(host.textContent).not.toContain("Characters");
    await act(async () => root.unmount());
    root = createRoot(host);
    await render(engine, 2);
    expect(rows()).toEqual(expect.arrayContaining(["Interface font", "How faces are drawn", "Window frame", "Headlines for working conversations"]));
    expect(host.querySelector('[data-row="Window frame"]')?.getAttribute("aria-disabled")).toBe("true");
  });

  it("with no signed-in profile the look is kept on this computer", async () => {
    const { engine, request } = engineOf({ profile: false });
    await render(engine);
    expect(host.textContent).toContain("Kept on this computer");
    await act(async () => sw("Scenery behind the list").click());
    expect(request.mock.calls.some(([m]) => m === "users.prefs.set")).toBe(false);
    expect(JSON.parse(localStorage.getItem("branch.look") ?? "{}").look.scenery).toBe(true);
  });

  it("after a conflict it reads the look again and puts only the changed row on it", async () => {
    const { engine, request, prefs } = engineOf({ conflicts: 1 });
    await render(engine);
    prefs["ui.window.look"] = { "show.gfx": true }; // another window saved meanwhile
    await act(async () => sw("Scenery behind the list").click());
    expect(prefs["ui.window.look"]).toEqual({ "show.gfx": true, scenery: true });
    expect(request.mock.calls.filter(([m]) => m === "users.prefs.set").pop()?.[1]).toEqual({ entries: { "ui.window.look": { "show.gfx": true, scenery: true } }, expectedEntries: { "ui.window.look": { "show.gfx": true } } });
  });

  it("one look for the window: a new engine handle takes over the pref-change listener", async () => {
    const off = vi.fn();
    const mk = () => ({ request: vi.fn(async () => ({ status: "no_durable_identity" })), onEvent: vi.fn(() => off), sessionKey: null, scopes: [] }) as unknown as WindowEngine;
    const a = mk(), b = mk();
    const first = lookStore(a);
    await first.load();
    expect(lookStore(b)).toBe(first);
    expect(off).toHaveBeenCalledTimes(1);
    expect(b.onEvent).toHaveBeenCalledTimes(1);
  });

  it("reads saved rows from the engine", async () => {
    const { engine } = engineOf({ prefs: { "ui.window.look": { "show.usage": false } } });
    await render(engine);
    expect(sw("The usage ring").checked).toBe(false);
    expect(sw("Let it roam").checked).toBe(false);
  });

  it("theme codes and engine palettes keep every colour", () => {
    const code = themeCode("Mine", SLATE);
    expect(readThemeCode(code)?.pair).toEqual(SLATE);
    expect(readThemeCode("{}")).toBeNull();
    expect(fromPalette(toPalette(SLATE.dark), "dark")).toEqual(SLATE.dark);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21);
    expect(APPEARANCE_ROWS.find((r) => r.title === "Window frame")?.lv).toBe(2);
  });
});
