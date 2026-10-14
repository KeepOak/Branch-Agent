// @vitest-environment jsdom
// Settings › Models in R1 (#1049 section D): a native R1 page with the approved preview's sixteen cards (preview.html
// PG models), at the preview's levels, under the preview's tabs (Connections, Defaults, On this computer, Second opinion,
// Media). No Classic page: Classic Models' sections sit in the cards, with no Classic heading.
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

const REGULAR = ["Testing models"];
const ADVANCED = ["Defaults and picking models", "Models for smaller jobs", "Compare models", "Testing models", "Mixtures and savings", "Decision models", "Pictures, video and music", "Finishing well", "Budgets", "Try early"];
const TECHNICAL = ["Defaults and picking models", "Models for smaller jobs", "Compare models", "Testing models", "Mixtures and savings", "Decision models", "Pictures, video and music", "Finishing well", "Budgets", "Retries and timeouts", "Per connection", "How turns run", "How turns are planned", "Try early", "Attachments", "Each model"];
const METHODS = ["config.get", "config.patch", "config.schema", "users.prefs.get", "models.list", "plugins.list"];
function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "models.list") return { models: [] };
    if (method === "plugins.list") return { plugins: [] };
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

describe("R1 Settings › Models is a native R1 page with the preview's cards", () => {
  it("draws the preview's tabs, then its cards in order at each level, with no Classic page", async () => {
    expect(PAGES.models.cards).toEqual(TECHNICAL);
    expect(R1_PAGES.models?.component).toBeUndefined();
    const onPage = vi.fn();
    await act(async () => root.render(<SettingsFrame engine={engineOf()} page="models" pages={R1_PAGES} onPage={onPage} />));
    await settle();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Models");
    await setLevel("Regular");
    expect(cards()).toEqual(REGULAR);
    await setLevel("Advanced");
    expect(cards()).toEqual(ADVANCED);
    await setLevel("Technical");
    expect(cards()).toEqual(TECHNICAL);
    expect(host.querySelector('[data-classic="models"]')).toBeNull();
    const tabs = () => [...host.querySelectorAll<HTMLButtonElement>('.r1s-lead [role="tab"]')];
    expect(tabs().map((t) => t.textContent)).toEqual(["Connections", "Defaults", "On this computer", "Second opinion", "Media"]);
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector(".r1s-lead + section.r1s-sec")?.getAttribute("aria-label")).toBe("Defaults and picking models");
    await act(async () => tabs()[3].click()); await settle();
    expect(tabs()[3].getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('.r1s-lead [role="tabpanel"]')?.getAttribute("aria-label")).toBe("Second opinion");
    await act(async () => tabs()[0].click()); await settle();
    expect(host.querySelector('[data-row="models.planned.coming"]')?.getAttribute("data-coming")).toBeTruthy();
    expect(host.textContent).toContain("Recall after tidying up");
    // Connections names where the order lives, and opens it.
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".r1s-lead .r1s-link")].find((b) => b.textContent === "Settings › Accounts")!.click());
    expect(onPage).toHaveBeenCalledWith("accounts");
  });
});
