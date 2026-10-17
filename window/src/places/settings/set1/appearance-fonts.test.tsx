// @vitest-environment jsdom
// Settings › Appearance › Reading fonts (Private #1100): OpenDyslexic, Atkinson Hyperlegible and Lexend ship with the
// window (SIL OFL 1.1), work offline, and the conversation font can be picked at Regular.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
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
// WOFF2 known-table tags, in the order of the spec's flag index.
const WOFF2_TAGS = "cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill".split(" ").map((t) => t.replace("_", " "));
/** The licence text a WOFF2 font carries in its name table (name ID 13, Windows platform). */
function embeddedLicence(bytes: Buffer): string {
  let off = 48;
  const base128 = () => { let v = 0; for (let i = 0; i < 5; i += 1) { const c = bytes[off++]; v = v * 128 + (c & 127); if (c < 128) return v; } throw new Error("bad UIntBase128"); };
  const tables: { tag: string; len: number }[] = [];
  for (let i = 0; i < bytes.readUInt16BE(12); i += 1) {
    const flags = bytes[off++];
    let tag = WOFF2_TAGS[flags & 63];
    if ((flags & 63) === 63) { tag = bytes.toString("latin1", off, off + 4); off += 4; }
    const length = base128();
    const transformed = tag === "glyf" || tag === "loca" ? flags >> 6 === 0 : flags >> 6 !== 0;
    tables.push({ tag, len: transformed ? base128() : length });
  }
  const data = brotliDecompressSync(bytes.subarray(off, off + bytes.readUInt32BE(20)));
  let at = 0;
  for (const t of tables) {
    if (t.tag === "name") {
      const name = data.subarray(at, at + t.len);
      const strings = name.readUInt16BE(4);
      for (let i = 0; i < name.readUInt16BE(2); i += 1) {
        const r = 6 + i * 12;
        if (name.readUInt16BE(r) !== 3 || name.readUInt16BE(r + 6) !== 13) continue;
        const start = strings + name.readUInt16BE(r + 10);
        return Buffer.from(name.subarray(start, start + name.readUInt16BE(r + 8))).swap16().toString("utf16le");
      }
    }
    at += t.len;
  }
  return "";
}
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
    // OpenDyslexic carries its notice and licence in each font file's metadata, byte for byte as upstream's OFL.txt
    // (OFL 1.1 condition 2 allows metadata). No separate licence file ships for it.
    for (const f of ["OpenDyslexic-Regular", "OpenDyslexic-Bold"]) {
      const licence = embeddedLicence(readFileSync(`public/fonts/reading/${f}.woff2`));
      expect(licence, f).toContain("SIL Open Font License, Version 1.1");
      expect(licence, f).toContain("with Reserved Font Name OpenDyslexic.");
      expect(createHash("sha256").update(licence, "utf8").digest("hex"), f).toBe("caafcccfb70fc72458fcbda812ec8f0a06cb300cbabb87eabbb30b946124394b");
    }
    // Each other licence file is the upstream file byte for byte (OFL 1.1 requires the notice and licence unchanged).
    const UPSTREAM_SHA256 = {
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
