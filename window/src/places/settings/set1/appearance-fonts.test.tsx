// @vitest-environment jsdom
// Settings › Appearance › Reading fonts (Private #1100): OpenDyslexic, Atkinson Hyperlegible and Lexend ship with the
// window (SIL OFL 1.1), work offline, and the conversation font can be picked at Regular.
import { createHash } from "node:crypto";
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
    // Each licence file is the upstream file byte for byte (OFL 1.1 requires the notice and licence unchanged).
    const UPSTREAM_SHA256 = {
      "OFL-OpenDyslexic.txt": "caafcccfb70fc72458fcbda812ec8f0a06cb300cbabb87eabbb30b946124394b",
      "OFL-AtkinsonHyperlegible.txt": "e137caeef2ff7c04fbf87078ad09cf3dcba8a3a58a4aa4e2f399d42c50bc4b18",
      "OFL-Lexend.txt": "cdfed8f91b0660b004befb744757918b7c7d40dc2201b6c6d0a86b2fab9408f8",
    };
    for (const [file, sha] of Object.entries(UPSTREAM_SHA256)) {
      const bytes = readFileSync(`public/fonts/reading/${file}`);
      expect(bytes.toString("utf8"), file).toContain("SIL Open Font License, Version 1.1");
      expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(sha);
    }
  });

  it("the R1 Appearance page offers them at Regular too", () => {
    const row = R1_ROWS.find((r) => r.id === "appearance.reading.font-chat");
    expect(row?.level).toBe(0);
    expect(row?.options?.slice(1, 4).map((o) => o.v)).toEqual(["opendyslexic", "atkinson-hyperlegible", "lexend"]);
  });
});
