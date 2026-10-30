// @vitest-environment jsdom
// Regular Settings is four pages (General, Computer, Accounts & usage, Updates). Every other page stays reachable
// under "Also in <page>" on its page. Developer stays on Technical. Advanced and Technical keep the full nav.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { GOTO_SUB, NAV, PAGES, REGULAR_GROUPS, TOP_PAGES, type PageId } from "./nav";
import { SettingsFrame } from "./SettingsFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
  forgetLookStore();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
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
async function mount() {
  await act(async () => root.render(<SettingsFrame engine={engineOf()} />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); await new Promise((r) => setTimeout(r, 0)); }); };
const level = (name: string) => $$(".r1s-level button").find((b) => b.textContent === name)!;
const hubs = () => $$(".r1s-list .r1s-nav");
const hub = (name: string) => hubs().find((b) => b.dataset.hub === name);

/** Every page id in the settings registry. None of these may disappear. */
const REGISTRY = Object.keys(PAGES).sort();

describe("Settings four pages", () => {
  it("renders General, Computer, Accounts & usage and Updates as pages", async () => {
    await mount();
    expect(hubs().map((b) => b.textContent)).toEqual(["General", "Computer", "Accounts & usage", "Updates"]);
    expect(hubs().every((b) => b.tagName === "BUTTON")).toBe(true);
    expect($$(".r1s-grp[aria-expanded]")).toEqual([]);
    expect(host.querySelector(".r1s-nav[aria-current=page]")?.textContent).toBe("General");
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("General");
    expect(host.querySelector(".r1s-advanced h2")?.textContent).toBe("Also in General");
  });

  it("renders each of the four pages when that page is opened", async () => {
    await mount();
    for (const group of REGULAR_GROUPS) {
      const button = hub(group.title);
      expect(button, group.title).toBeTruthy();
      await click(button!);
      expect(host.querySelector(".r1s-nav[aria-current=page]")?.getAttribute("data-hub")).toBe(group.title);
      expect(host.querySelector(".r1s-head h1")?.textContent).toBe(PAGES[group.pages[0].id].title);
      expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES[group.pages[0].id].lede);
    }
  });

  it("keeps every other settings page reachable under Advanced on its page", async () => {
    expect(REGISTRY).toContain("developer");
    await mount();
    const reached = new Set<PageId>();
    for (const group of REGULAR_GROUPS) {
      await click(hub(group.title)!);
      reached.add(group.pages[0].id);
      const jumps = $$(".r1s-advanced [data-page]").map((b) => b.dataset.page);
      expect(jumps, group.title).toEqual(group.pages.slice(1).map((p) => p.id));
      for (const page of group.pages.slice(1)) {
        const button = host.querySelector(`.r1s-advanced [data-page="${page.id}"]`);
        expect(button, page.id).toBeTruthy();
        await click(button!);
        expect(host.querySelector(".r1s-head h1")?.textContent, page.id).toBe(PAGES[page.id].title);
        expect(host.querySelector(".r1s-nav[aria-current=page]")?.getAttribute("data-hub")).toBe(group.title);
        reached.add(page.id);
      }
      if (group.title === "General") expect(host.querySelector(".r1s-advanced [data-page=goto] small")?.textContent).toBe(GOTO_SUB);
    }
    // Developer and All features (the feature atlas, mostly Coming) show only at Technical (Private #1093 item 4).
    expect([...reached].sort()).toEqual(REGISTRY.filter((id) => id !== "developer" && id !== "features"));
    expect($$(".r1s-advanced [data-page]").map((b) => b.dataset.page)).not.toContain("developer");
    expect($$(".r1s-advanced [data-page]").map((b) => b.dataset.page)).not.toContain("features");
    await click(level("Technical"));
    expect($$(".r1s-nav[data-page]").map((b) => b.dataset.page)).toEqual(expect.arrayContaining(["developer", "features"]));
    expect(host.querySelector(".r1s-advanced")).toBeNull();
  }, 20_000);

  it("leaves the Advanced and Technical nav unchanged", async () => {
    await mount();
    await click(level("Advanced"));
    expect($$(".r1s-list .r1s-grp").map((g) => g.textContent)).toEqual(["You", "Your Trunks", "Talking", "Accounts & models", "Permissions & safety", "Computers", "Branch"]);
    expect(host.querySelector(".r1s-grp[aria-expanded]")).toBeNull();
    expect(host.querySelector(".r1s-advanced")).toBeNull();
    const shown = [...TOP_PAGES, ...NAV.flatMap((g) => g.pages)].filter((p) => (p.minLevel ?? 0) <= 1).map((p) => p.id);
    expect($$(".r1s-nav[data-page]").map((b) => b.dataset.page)).toEqual(shown);
    expect(host.querySelector("[data-page=developer]")).toBeNull();
    await click(level("Technical"));
    expect(host.querySelector("[data-page=developer]")).not.toBeNull();
    expect($$(".r1s-list .r1s-grp").map((g) => g.textContent)).toEqual(["You", "Your Trunks", "Talking", "Accounts & models", "Permissions & safety", "Computers", "Branch"]);
  });

  it("draws each nav row and each Also in row as the preview's boxed row with its page's icon", async () => {
    await mount();
    for (const b of hubs()) expect(b.querySelector(":scope > svg"), b.textContent ?? "").not.toBeNull();
    const jumps = $$(".r1s-advanced .r1s-jump");
    expect(jumps.length).toBeGreaterThan(0);
    // Your card is your initial in the nav (MeButton), so its row has no icon; every other page has the preview's.
    for (const b of jumps) expect(Boolean(b.querySelector(":scope > svg")), b.dataset.page).toBe(b.dataset.page !== "card");
    await click(level("Advanced"));
    for (const b of $$(".r1s-nav[data-page]").filter((n) => n.dataset.page !== "card")) expect(b.querySelector(":scope > svg"), b.dataset.page).not.toBeNull();
    const css = readFileSync("src/screens/settings/settings.css", "utf8");
    const jump = css.slice(css.indexOf(".r1s-jump {"), css.indexOf(".r1s-jump > span"));
    expect(jump).toContain("border-radius: 11px");
    const nav = css.slice(css.indexOf(".r1s-nav {"), css.indexOf(".r1s-nav > span"));
    expect(nav).toContain("border-radius: 11px");
    // The boxes are the Settings glass's control frost and outline: no rule strips them from the nav or the Also in rows.
    const glass = readFileSync("src/glass/glass.css", "utf8");
    expect(glass).not.toMatch(/\.r1s-advanced \.r1s-jump \{[^}]*background: transparent/);
    expect(glass).toMatch(/\.r1s-side\.g-clear :is\(button, a\[href\]\):not\(\.r1s-nav,/);
  });

  it("keeps a page's Also in list in the Settings nav, under its page's row, not in the page's content", async () => {
    // A page shows only its own settings (#1769 point 2). In the nav (.r1s-side) the button crawl counts the Also in rows
    // as the Settings nav, not as page controls past a long page's cap (never-clicked on #1962).
    await mount();
    const also = () => host.querySelector(".r1s-side .r1s-list .r1s-advanced");
    expect(host.querySelector(".r1s-page .r1s-advanced")).toBeNull();
    expect(also()?.previousElementSibling?.getAttribute("aria-current")).toBe("page");
    expect(also()?.previousElementSibling?.getAttribute("data-hub")).toBe("General");
    await click(host.querySelector('.r1s-advanced [data-page="instructions"]')!);
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Instructions & personality");
    expect(host.querySelector(".r1s-page .r1s-advanced")).toBeNull();
    expect(host.querySelector('.r1s-advanced [data-page="instructions"]')?.getAttribute("aria-current")).toBe("true");
    await click(hub("Computer")!);
    expect(also()?.previousElementSibling?.getAttribute("data-hub")).toBe("Computer");
    expect($$(".r1s-advanced")).toHaveLength(1);
  });
});
