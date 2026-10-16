// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AtlasRow } from "./atlas";
import { FeaturesPage } from "./FeaturesPage";

/* README item 48 (owner, final): only the window's left sidebar is frosted. Settings › All features is clear glass (.g-clear),
   and every heading, line of text and control on it sits on a frosted pill with a 1px outline (.g-label, .g-frost, or a control
   inside .g-clear; glass/glass.css). features.css paints no frosted fill or blur of its own, and a status chip's coloured word
   keeps 4.5:1 on its pill over pure white and pure black, in light and dark. */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get(this: HTMLElement) { return this.classList.contains("feat-list") ? 640 : 0; } });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const row = (id: string, a: string, s: AtlasRow["s"], f: string): AtlasRow => ({ id, a, f, w: `${f} in detail`, s, p: "pack1" });
const rows: AtlasRow[] = [
  row("TOOLS-1", "tools", "in Branch", "Run shell commands"),
  row("TOOLS-2", "tools", "planned", "Spreadsheet tool"),
  row("VOICE-1", "voice", "partly built", "Talk mode"),
  row("OPS-1", "ops", "in Branch", "Gateway restart"),
];
async function render(props: Partial<Parameters<typeof FeaturesPage>[0]> = {}) {
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root!.render(<FeaturesPage technical={false} rows={rows} onOpen={() => {}} {...props} />));
  return host;
}
/** Text that sits straight on a surface instead of on a pill. */
function bareText(scope: Element) {
  const bare: string[] = [];
  for (const el of scope.querySelectorAll("*")) {
    if (el.closest("svg, script, style")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ""))) continue;
    const pill = el.closest(".g-label, .g-frost, button, a[href], select");
    if (!pill || (!pill.matches(".g-label, .g-frost") && !pill.closest(".g-clear"))) bare.push(`<${el.tagName.toLowerCase()} class="${el.className}"> ${el.textContent!.trim().slice(0, 48)}`);
  }
  return bare;
}
const type = async (host: Element, value: string) => {
  const input = host.querySelector<HTMLInputElement>("input[aria-label='Search all features']")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
};

describe("All features follows the item 48 glass model", () => {
  it("draws the page clear, the search box and the status filter as pills, and every heading, row and chip on a pill", async () => {
    const host = await render({ focus: "TOOLS-1" });
    expect(host.querySelector(".feat-page")!.classList).toContain("g-clear");
    expect(host.querySelector(".feat-search")!.classList).toContain("g-frost");
    expect(host.querySelector(".feat-seg")!.classList).toContain("g-frost");
    expect(host.querySelector(".feat-count")!.classList).toContain("g-label");
    expect(host.querySelectorAll(".feat-r").length).toBeGreaterThan(0);
    for (const chip of host.querySelectorAll(".feat-chip")) expect(chip.classList).toContain("g-label");
    expect(host.querySelectorAll(".feat-go").length).toBeGreaterThan(0);
    expect(host.querySelector(".feat-r.focus")).not.toBeNull();
    expect(bareText(host)).toEqual([]);
  });

  it("keeps the Technical areas, a search and the empty line on pills too, and draws no empty pill before the list loads", async () => {
    const host = await render({ technical: true });
    expect(host.textContent).toContain("Running Branch");
    expect(bareText(host)).toEqual([]);
    await type(host, "zzz");
    expect(host.querySelector(".feat-empty")!.classList).toContain("g-label");
    expect(bareText(host)).toEqual([]);
    await act(async () => root!.unmount());
    const loading = document.body.appendChild(document.createElement("div")); root = createRoot(loading);
    await act(async () => root!.render(<FeaturesPage technical={false} rows={undefined} />));
    expect(loading.querySelector(".feat-count")!.textContent).toBe("");
    expect(loading.querySelector(".feat-count")!.classList).not.toContain("g-label");
  });

  it("paints no frosted fill, blur or drawn line of its own, and the filter's chosen part takes the pill's light lift", () => {
    const css = readFileSync("src/screens/features/features.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
    expect(css).not.toMatch(/var\(--g[cfk]-/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/var\(--(line|fill)\)/);
    expect(css).toContain(".feat-seg .seg::before { background: var(--gp-on); box-shadow: inset 0 0 0 1px var(--gp-edge); }");
    expect(css).toContain(".feat-r.focus { background: var(--gp-on); box-shadow: inset 0 0 0 1px var(--gp-edge); }");
  });

  it("gives the In Branch and Partly built words at least 4.5:1 on their pill over white and black, in light and dark", () => {
    const tokens = readFileSync("src/theme/tokens.css", "utf8");
    const css = readFileSync("src/screens/features/features.css", "utf8");
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const rgba = (s: string) => s.replace(/rgba?\(|\)/g, "").split(",").map(Number);
    const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!);
    const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const over = (c: number[], base: number[]) => [0, 1, 2].map((k) => c[k]! * c[3]! + base[k]! * (1 - c[3]!));
    const mix = (a: number[], b: number[], p: number) => [0, 1, 2].map((k) => a[k]! * p + b[k]! * (1 - p));
    const tone = (re: RegExp) => Number(re.exec(css)![1]) / 100;
    const themes = [
      { name: "light", ink: hex(/--ink: (#[0-9a-f]{6})/.exec(tokens)![1]!), ok: hex(/--ok: (#[0-9a-f]{6})/.exec(tokens)![1]!), warn: hex(/--warn: (#[0-9a-f]{6})/.exec(tokens)![1]!),
        fill: rgba(/--gp-fill: (rgba\([^)]+\))/.exec(tokens)![1]!), tone: tone(/:root \{ --feat-tone: (\d+)%/) },
      { name: "dark", ink: hex(/data-theme="dark"\] \{[^}]*?--ink: (#[0-9a-f]{6})/.exec(tokens)![1]!), ok: hex(/data-theme="dark"\] \{[^}]*?--ok: (#[0-9a-f]{6})/.exec(tokens)![1]!),
        warn: hex(/data-theme="dark"\] \{[^}]*?--warn: (#[0-9a-f]{6})/.exec(tokens)![1]!), fill: rgba(/:root\[data-theme="dark"\] \{ --gp-fill: (rgba\([^)]+\))/.exec(tokens)![1]!),
        tone: tone(/:root\[data-theme="dark"\] \{ --feat-tone: (\d+)%/) },
    ];
    expect(css).toContain(".feat-chip.in:not(#g48#g48) { color: color-mix(in srgb, var(--ok) var(--feat-tone), var(--ink)); }");
    expect(css).toContain(".feat-chip.part:not(#g48#g48) { color: color-mix(in srgb, var(--warn) var(--feat-tone), var(--ink)); }");
    for (const t of themes) for (const status of [t.ok, t.warn]) for (const base of [[255, 255, 255], [0, 0, 0]]) {
      expect(ratio(mix(status, t.ink, t.tone), over(t.fill, base)), `${t.name} ${status} over ${base}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
