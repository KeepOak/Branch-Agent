// @vitest-environment jsdom
// Settings › Privacy & data in R1 (#1049 section D): a native R1 page with the approved preview's seven cards
// (preview.html PG privacy), at the preview's levels. The spend card and the allowance list are not here (they live on
// Accounts & usage, #1518); Archived & Recently deleted and Conversations are the preview's own cards.
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

const REGULAR = ["Your data", "Keeping things", "Archived & Recently deleted", "Moving in and out", "Flagged replies"];
const ALL_CARDS = ["Your data", "Keeping things", "Archived & Recently deleted", "Conversations", "Moving in and out", "Flagged replies", "Money and keeping"];
const METHODS = ["config.get", "config.patch", "config.schema", "users.prefs.get", "sessions.usage", "sessions.storage.status", "agents.list", "plugins.list"];
function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { agents: [{ id: "main", name: "Sapling" }] };
    if (method === "sessions.usage") return { totals: { totalCost: 1.5 }, aggregates: { byAgent: [{ agentId: "main", totals: { totalCost: 1.5 } }] }, sessions: [] };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const setLevel = async (label: string) => {
  const b = [...host.querySelectorAll<HTMLButtonElement>(".r1s-level button")].find((x) => x.textContent === label);
  expect(b).toBeTruthy(); await act(async () => b!.click()); await settle();
};
const cards = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].map((s) => s.getAttribute("aria-label"));
const card = (t: string) => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")].find((s) => s.getAttribute("aria-label") === t)!;

describe("R1 Settings › Privacy & data is a native R1 page with the preview's cards", () => {
  it("draws the preview's cards in order at each level, with no usage cards and no Classic page", async () => {
    expect(PAGES.privacy.cards).toEqual(ALL_CARDS);
    expect(R1_PAGES.privacy?.component).toBeUndefined();
    const { engine } = engineOf();
    await act(async () => root.render(<SettingsFrame engine={engine} page="privacy" pages={R1_PAGES} />));
    await settle();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Privacy & data");
    await setLevel("Regular");
    expect(cards()).toEqual(REGULAR);
    for (const id of ["privacy.archived.keep", "privacy.archived.empty-after", "privacy.archived.recently"]) {
      expect(card("Archived & Recently deleted").querySelector(`[data-row="${id}"]`)?.getAttribute("data-coming")).toBeTruthy();
    }
    await setLevel("Advanced");
    expect(cards()).toEqual(ALL_CARDS);
    await setLevel("Technical");
    expect(cards()).toEqual(ALL_CARDS);
    expect(host.querySelector('[data-classic="usage"], .r1s-custom')).toBeNull();
    expect([...host.querySelectorAll(".r1s-col h1, .r1s-col h2")].map((h) => h.textContent)).toEqual(ALL_CARDS);
    // The usage cards are on Accounts & usage now; nothing from them draws here.
    expect(host.textContent).not.toMatch(/Open the report|What each connection has left/);
    expect(card("Moving in and out").textContent).toContain("Moving");
  });

  it("keeps Classic's spend by Trunk, in Money and keeping, on sessions.usage", async () => {
    const { engine, request } = engineOf();
    await act(async () => root.render(<SettingsFrame engine={engine} page="privacy" pages={R1_PAGES} />));
    await settle();
    await setLevel("Advanced");
    expect(request.mock.calls.some(([m]) => m === "sessions.usage")).toBe(true);
    expect(card("Money and keeping").textContent).toContain("Sapling");
  });
});
