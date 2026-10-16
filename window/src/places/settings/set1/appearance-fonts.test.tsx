// @vitest-environment jsdom
// Settings › Appearance › Reading fonts (Private #1100): OpenDyslexic, Atkinson Hyperlegible and Lexend ship with the
// window (SIL OFL 1.1), work offline, and the conversation font can be picked at Regular.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { AppearancePage } from "./appearance";
import { applyLook, forgetLookStore } from "./appearance-store";
import { APPEARANCE_ROWS as R1_ROWS } from "../../../screens/settings/pages/appearance";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const THEMES = [{ id: "grove", name: "Grove", description: "Grove.", source: "builtin", modes: ["light", "dark"] }];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  forgetLookStore();
  document.head.querySelector("#branch-look")?.remove();
  document.head.querySelectorAll("link[data-font]").forEach((l) => l.remove());
  globalThis.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof matchMedia;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf() {
  const request = vi.fn(async (method: string, _params?: unknown) => {
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.prefs.set") return { status: "ok" };
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
const lookCss = () => document.getElementById("branch-look")?.textContent ?? "";
const FILES = ["OpenDyslexic-Regular", "OpenDyslexic-Bold", "AtkinsonHyperlegible-Regular", "AtkinsonHyperlegible-Bold", "Lexend-Regular", "Lexend-Bold"];

describe("Settings › Appearance › Reading fonts", () => {
  it("offers the easier-reading fonts at Regular and uses the bundled OpenDyslexic", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const pick = host.querySelector<HTMLSelectElement>('select[aria-label="Conversation font"]')!;
    expect(pick.tagName).toBe("SELECT");
    expect([...pick.options].slice(1, 4).map((o) => o.value)).toEqual(["opendyslexic", "atkinson-hyperlegible", "lexend"]);
    await act(async () => { pick.value = "opendyslexic"; pick.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { "ui.fontChat": "opendyslexic" } });
    expect(lookCss()).toContain('@font-face{font-family:"OpenDyslexic";font-style:normal;font-weight:400;font-display:swap;src:url("/fonts/reading/OpenDyslexic-Regular.woff2") format("woff2")}');
    expect(lookCss()).toContain('url("/fonts/reading/OpenDyslexic-Bold.woff2")');
    expect(lookCss()).toContain('--chat-font:"OpenDyslexic", system-ui, sans-serif');
    expect(document.head.querySelector('link[data-font="opendyslexic"]')).toBeNull();
  });

  it("Atkinson Hyperlegible and Lexend come from the window, not a font server", () => {
    applyLook({ look: {}, device: {}, prefs: { fontUi: "atkinson-hyperlegible", fontChat: "lexend" }, palette: null });
    expect(document.head.querySelector("link[data-font]")).toBeNull();
    expect(lookCss()).toContain('url("/fonts/reading/AtkinsonHyperlegible-Regular.woff2")');
    expect(lookCss()).toContain('url("/fonts/reading/Lexend-Regular.woff2")');
    expect(lookCss()).toContain('--sans:"Atkinson Hyperlegible", system-ui, sans-serif');
  });

  it("ships each font file with its licence", () => {
    for (const f of FILES) expect(readFileSync(`public/fonts/reading/${f}.woff2`).subarray(0, 4).toString("latin1"), f).toBe("wOF2");
    const ofl = readFileSync("public/fonts/reading/OFL.txt", "utf8");
    expect(ofl).toContain("SIL Open Font License, Version 1.1");
    for (const name of ["OpenDyslexic", "Atkinson Hyperlegible", "Lexend"]) expect(ofl).toContain(name);
  });

  it("the R1 Appearance page offers them at Regular too", () => {
    const row = R1_ROWS.find((r) => r.id === "appearance.reading.font-chat");
    expect(row?.level).toBe(0);
    expect(row?.options?.slice(1, 4).map((o) => o.v)).toEqual(["opendyslexic", "atkinson-hyperlegible", "lexend"]);
  });
});
