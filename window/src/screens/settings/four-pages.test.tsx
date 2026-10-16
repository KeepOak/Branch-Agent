// @vitest-environment jsdom
// Regular Settings is four pages (General, Computer, Usage, Updates). Every other page stays reachable
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
  it("renders General, Computer, Usage and Updates as pages", async () => {
    await mount();
    expect(hubs().map((b) => b.textContent)).toEqual(["General", "Computer", "Usage", "Updates"]);
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
    expect([...reached].sort()).toEqual(REGISTRY.filter((id) => id !== "developer"));
    expect($$(".r1s-advanced [data-page]").map((b) => b.dataset.page)).not.toContain("developer");
    await click(level("Technical"));
    expect($$(".r1s-nav[data-page]").map((b) => b.dataset.page)).toContain("developer");
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

  it("draws Advanced links as plain rows, not pills", () => {
    const css = readFileSync("src/screens/settings/settings.css", "utf8");
    const jump = css.slice(css.indexOf(".r1s-jump {"), css.indexOf(".r1s-jump > span"));
    expect(jump).toContain("width: 100%");
    expect(jump).toContain("border-radius: 0");
    expect(jump).not.toContain("999px");
    const glass = readFileSync("src/glass/glass.css", "utf8");
    expect(glass).toMatch(/\.r1s-advanced \.r1s-jump \{[^}]*background: transparent[^}]*box-shadow: none[^}]*border-radius: 0/);
  });
});
