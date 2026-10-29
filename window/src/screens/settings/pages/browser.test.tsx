// @vitest-environment jsdom
// Settings › Browser & screen in R1 (#1049 section D): a native R1 page with the approved preview's ten cards
// (preview.html PG browser), at the preview's levels, from Classic Computer & browser's section data. Sites and Saved
// flows, which no Classic control does, are Coming.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { PAGES } from "../nav";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); sessionStorage.clear();
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const REGULAR = ["On a computer", "Using the screen", "The browser"];
const ALL_CARDS = ["On a computer", "Using the screen", "The browser", "How it browses", "Sites", "Page cleaners", "What it hands to you", "Saved flows", "Your own browser", "Logbook"];
const ADVANCED = ALL_CARDS.filter((title) => title !== "Sites" && title !== "Saved flows");
const METHODS = ["config.get", "config.patch", "config.schema", "users.prefs.get", "plugins.list", "node.list", "computer.status"];
function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const setLevel = async (label: string) => {
  const b = [...host.querySelectorAll<HTMLButtonElement>(".r1s-level button")].find((x) => x.textContent === label);
  expect(b).toBeTruthy(); await act(async () => b!.click()); await settle();
};
const cards = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].map((s) => s.getAttribute("aria-label"));
const card = (t: string) => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].find((s) => s.getAttribute("aria-label") === t)!;

describe("R1 Settings › Browser & screen is a native R1 page with the preview's cards", () => {
  it.each(["Regular", "Advanced", "Technical"])("shows Sites and Saved flows only at Technical, at %s", async (level) => {
    await act(async () => root.render(<SettingsFrame engine={engineOf()} page="browser" pages={R1_PAGES} />));
    await settle();
    await setLevel(level);
    for (const id of ["browser.sites.coming", "browser.flows.coming"]) {
      const row = host.querySelector(`[data-row="${id}"]`);
      if (level === "Technical") {
        expect(row).not.toBeNull();
        expect(row?.getAttribute("data-coming")).toBeTruthy();
        expect(row?.getAttribute("aria-disabled")).toBe("true");
        expect(row?.getAttribute("data-lv")).toBe("Technical");
      } else expect(row).toBeNull();
    }
  });

  it("draws the preview's cards in order at each level, with no Classic page", async () => {
    expect(PAGES.browser.cards).toEqual(ALL_CARDS);
    expect(R1_PAGES.browser?.component).toBeUndefined();
    await act(async () => root.render(<SettingsFrame engine={engineOf()} page="browser" pages={R1_PAGES} />));
    await settle();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Browser & screen");
    await setLevel("Regular");
    expect(cards()).toEqual(REGULAR);
    expect(card("On a computer").textContent).toContain("See the screen and use the mouse");
    await setLevel("Advanced");
    expect(cards()).toEqual(ADVANCED);
    await setLevel("Technical");
    expect(cards()).toEqual(ALL_CARDS);
    expect(host.querySelector('[data-classic], .r1s-custom')).toBeNull();
    expect([...host.querySelectorAll(".r1s-col h1, .r1s-col h2")].map((h) => h.textContent)).toEqual(ALL_CARDS);
    expect(card("Sites").querySelector('[data-row="browser.sites.coming"]')?.getAttribute("data-coming")).toBeTruthy();
    expect(card("Saved flows").querySelector('[data-row="browser.flows.coming"]')?.getAttribute("data-coming")).toBeTruthy();
  });
});
