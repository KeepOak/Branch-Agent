// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { SettingsFrame } from "./SettingsFrame";

/* README item 48 (owner, final): only the window's left sidebar is frosted. The whole R1 Settings frame (its nav column, page,
   header, sections, help and empty state) is clear glass (.g-clear), and every heading, line of text and control on it sits on
   a frosted pill with a 1px outline (.g-label, .g-frost, or a control inside .g-clear; glass/glass.css). settings.css paints no
   frosted fill or blur of its own. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(config: Record<string, unknown> | Error = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") { if (config instanceof Error) throw config; return { hash: "h1", valid: true, config }; }
    if (method === "config.patch") return { ok: true };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.prefs.set") return { status: "ok" };
    if (method === "themes.list") return { current: {} };
    throw new Error(`unknown method: ${method}`);
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function mount(engine: WindowEngine, page?: string) { await act(async () => root.render(<SettingsFrame engine={engine} page={page} />)); await settle(); }
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); await settle(); };
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
const frosted = (scope: Element) => ["g-chip", "g-ctl", "g-float"].flatMap((c) => [...scope.querySelectorAll("." + c)].map(() => c));

describe("R1 Settings follows the item 48 glass model", () => {
  it("draws the frame, nav column and sections as clear glass with every heading, row and control on a pill", async () => {
    await mount(engineOf());
    for (const sel of [".r1set", ".r1s-side"]) expect(host.querySelector(sel)!.classList, sel).toContain("g-clear");
    const sections = [...host.querySelectorAll(".r1s-sec")];
    expect(sections.length).toBeGreaterThan(0);
    for (const s of sections) expect(s.classList).toContain("g-clear");
    expect(host.querySelector(".r1s-search")!.classList).toContain("g-frost");
    expect(host.querySelector(".r1s-level .r1s-seg")!.classList).toContain("g-frost");
    expect(host.querySelector(".r1s-head h1")!.classList).toContain("g-label");
    expect(host.querySelectorAll(".r1s-row").length).toBeGreaterThan(0);
    expect(frosted(host)).toEqual([]);
    expect(bareText(host)).toEqual([]);
  });

  it("keeps help, every level's rows and search results on pills too", async () => {
    await mount(engineOf());
    await click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === "Technical")!);
    expect(host.querySelector(".r1s-fine, .r1s-row[data-lv]")).not.toBeNull();
    for (const fine of host.querySelectorAll(".r1s-fine")) expect(fine.classList).toContain("g-clear");
    await click(host.querySelector(".r1s-learn")!);
    expect(host.querySelector(".r1s-help")!.classList).toContain("g-clear");
    expect(bareText(host)).toEqual([]);
    for (const page of [...host.querySelectorAll<HTMLElement>(".r1s-nav[data-page]")].map((b) => b.dataset.page!).slice(0, 12)) {
      await click(host.querySelector(`.r1s-nav[data-page="${page}"]`)!);
      expect(bareText(host), page).toEqual([]);
    }
    const input = host.querySelector<HTMLInputElement>(".r1s-search input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "zzzz-nothing"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(host.querySelector(".r1s-none")!.classList).toContain("g-label");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "theme"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(bareText(host)).toEqual([]);
  });

  it("puts a failed load's notice on a pill", async () => {
    await mount(engineOf(new Error("offline")));
    expect(host.querySelector(".r1s-notice")!.classList).toContain("g-frost");
    expect(bareText(host)).toEqual([]);
  });

  it("paints no frosted fill or blur of its own, lets the title scroll away with the page (v15) with no fill; switches and the chosen page use the shared pill", () => {
    const css = readFileSync("src/screens/settings/settings.css", "utf8").replace(/\s+/g, " ");
    expect(css).not.toMatch(/var\(--g[cfk]-/);
    expect(css).not.toMatch(/backdrop-filter/);
    // owner-approved v15: the Settings header is not pinned, it scrolls away with the page
    expect(css).toMatch(/\.r1s-head \{[^}]*\}/);
    expect(css).not.toMatch(/\.r1s-head[^{]*\{[^}]*position: (sticky|fixed)/);
    expect(css).not.toMatch(/\.r1s-head \{[^}]*background/);
    expect(css).not.toMatch(/\.r1s-head::after/);
    expect(css).not.toMatch(/\.r1set \{[^}]*background/);
    const glass = readFileSync("src/glass/glass.css", "utf8").replace(/\s+/g, " ");
    expect(glass).toContain('.g-clear [role="switch"]:not([aria-checked="true"], :checked):not(#g48) { background: var(--gp-fill);');
    expect(glass).toMatch(/\[aria-current="page"\][^{]*\{ box-shadow: inset 0 0 0 1px var\(--gp-edge\), inset 0 0 0 100vmax var\(--gp-on\); \}/);
  });
});
