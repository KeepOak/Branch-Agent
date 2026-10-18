// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { GOTO_SUB, NAV, PAGES, TOP_PAGES, type PageId } from "./nav";
import { SettingsFrame } from "./SettingsFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  localStorage.clear();
  forgetLookStore();
  // Desktop width: Regular groups stay collapsed until opened. The narrow strip shows every page.
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
const hubButton = (name: string) => $$(".r1s-list .r1s-nav").find((b) => b.textContent === name);
const advancedPages = () => $$(".r1s-advanced [data-page]").map((b) => b.dataset.page);

/** Every page id the settings registry had when Regular was regrouped. None of these may disappear. */
const REGISTRY = ["accounts", "appearance", "autos", "browser", "card", "chatapps", "coding", "customize", "developer", "devices", "features", "general", "goto", "history", "instructions", "learning", "memory", "models", "notifications", "permissions", "privacy", "remote", "seedbank", "signins", "trunks", "updates", "voice", "who"] as const;

const REGULAR: Record<string, PageId[]> = {
  General: ["general", "card", "goto", "appearance", "notifications", "who", "trunks", "instructions", "customize", "seedbank", "memory", "autos", "voice", "chatapps"],
  Computer: ["devices", "browser", "coding", "remote", "permissions"],
  Usage: ["accounts", "models", "privacy", "signins"],
  // All features (the feature atlas, mostly Coming) shows only at Technical (Private #1093 item 4), so Updates doesn't link it.
  Updates: ["updates", "history", "learning"],
};

describe("Regular settings pages", () => {
  it("shows exactly General, Computer, Usage and Updates, and each page keeps its pages under Advanced", async () => {
    await mount();
    expect($$(".r1s-list .r1s-nav").map((b) => b.textContent)).toEqual(["General", "Computer", "Usage", "Updates"]);
    expect($$(".r1s-grp[aria-expanded]")).toEqual([]);
    expect(host.querySelector("[data-page=appearance]")).not.toBeNull();
    expect(host.querySelector(".r1s-advanced [data-page=devices]")).toBeNull();
    expect(host.querySelector(".r1s-advanced [data-page=accounts]")).toBeNull();
    expect(host.querySelector(".r1s-advanced [data-page=updates]")).toBeNull();
    expect(host.querySelector("[data-page=goto] small")?.textContent).toBe(GOTO_SUB);

    for (const [name, ids] of Object.entries(REGULAR)) {
      const button = hubButton(name);
      expect(button, name).toBeTruthy();
      await click(button!);
      expect(host.querySelector(".r1s-nav[aria-current=page]")?.textContent).toBe(name);
      expect(advancedPages()).toEqual(ids.slice(1));
      expect(host.querySelector(".r1s-head h1")?.textContent).toBe(PAGES[ids[0]].title);
      expect(host.querySelector(".r1s-advanced h2")?.textContent).toBe(`Also in ${name}`);
    }
  });

  it("reaches every settings registry page at Regular or Advanced, and Developer and All features at Technical", async () => {
    expect(Object.keys(PAGES).sort()).toEqual([...REGISTRY]);
    await mount();
    const regular = new Set<string>();
    for (const [name, ids] of Object.entries(REGULAR)) {
      await click(hubButton(name)!);
      regular.add(ids[0]);
      for (const id of advancedPages()) if (id) regular.add(id);
    }
    await click(level("Advanced"));
    const advanced = new Set($$(".r1s-nav[data-page]").map((b) => b.dataset.page).filter((id): id is string => Boolean(id)));
    const missing = REGISTRY.filter((id) => !regular.has(id) && !advanced.has(id));
    // Developer and All features are the Technical pages inside the nav's Branch group.
    expect(missing).toEqual(["developer", "features"]);
    expect(advanced.has("developer")).toBe(false);
    expect(advanced.has("features")).toBe(false);
    await click(level("Technical"));
    expect($$(".r1s-nav[data-page]").map((b) => b.dataset.page)).toEqual(expect.arrayContaining(["developer", "features"]));
    const covered = new Set<string>([...regular, ...advanced, "developer", "features"]);
    expect([...covered].sort()).toEqual([...REGISTRY]);
  });

  it("leaves Advanced groups and pages unchanged", async () => {
    await mount();
    await click(level("Advanced"));
    expect($$(".r1s-list .r1s-grp").map((g) => g.textContent)).toEqual(["You", "Your Trunks", "Talking", "Accounts & models", "Permissions & safety", "Computers", "Branch"]);
    expect(host.querySelector(".r1s-grp[aria-expanded]")).toBeNull();
    const shown = [...TOP_PAGES, ...NAV.flatMap((g) => g.pages)].filter((p) => (p.minLevel ?? 0) <= 1).map((p) => p.id);
    expect($$(".r1s-nav[data-page]").map((b) => b.dataset.page)).toEqual(shown);
    expect(host.querySelector("[data-page=developer]")).toBeNull();
    expect(host.querySelector("[data-page=card]")).not.toBeNull();
    expect(host.querySelector("[data-page=goto]")).not.toBeNull();
    for (const fold of $$("[role=group][data-open]")) expect(fold.getAttribute("data-open")).toBe("true");
    await click(level("Technical"));
    expect($$(".r1s-list .r1s-grp").map((g) => g.textContent)).toEqual(["You", "Your Trunks", "Talking", "Accounts & models", "Permissions & safety", "Computers", "Branch"]);
    expect(host.querySelector("[data-page=developer]")).not.toBeNull();
  });
});
