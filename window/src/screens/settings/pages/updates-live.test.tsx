// @vitest-environment jsdom
// Settings › Updates & about in R1 (#1049 section D): a native R1 page with the approved preview's ten cards (preview.html
// PG updates). Achievements stays on this page as one card; Shortcuts, guide & apps is new.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
import { PAGES, pageFor } from "../nav";
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

const PREVIEW_CARDS = ["Updating", "Branch on your other devices", "Before you install", "Reports", "In your editors and notes", "Achievements", "Shortcuts, guide & apps", "About", "Privacy", "Remove Branch"];
const METHODS = ["config.get", "config.patch", "config.schema", "users.prefs.get", "update.status", "update.run", "status", "system.info"];
function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "update.status") return { schedule: { autoEnabled: false }, effectiveChannel: "stable" };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount() {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="updates" pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];
const card = (t: string) => sections().find((s) => s.getAttribute("aria-label") === t)!;

describe("R1 Settings › Updates & about is a native R1 page with the preview's cards", () => {
  it("draws the preview's cards in order under the frame's title, lede and Learn more, with no Classic page or extra heading", async () => {
    expect(PAGES.updates.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.updates?.component).toBeUndefined();
    await mount();
    await setLevel("Technical");
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Updates & about");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    expect([...host.querySelectorAll(".r1s-col h1, .r1s-col h2")].map((h) => h.textContent)).toEqual(PREVIEW_CARDS);
    expect(host.textContent).not.toMatch(/Help and updates, more|Pets you’ve had|Keep achievements quiet/);
  });

  it("keeps Achievements on this page as one card, and old achievements links open it", async () => {
    expect(pageFor("achievements")).toBe("updates");
    await mount();
    const a = card("Achievements");
    expect(a.querySelector('[data-row="updates.achievements.popup"]')?.getAttribute("data-coming")).toBeTruthy();
    expect(a.querySelectorAll(".medal").length).toBeGreaterThan(0);
  });

  it("draws the preview's shortcuts, guide and apps buttons, which open the shortcuts and the tour", async () => {
    const seen: string[] = [];
    window.addEventListener("branch:welcome-tour", () => seen.push("tour"));
    await mount();
    const s = card("Shortcuts, guide & apps");
    expect([...s.querySelectorAll("button")].map((b) => b.textContent?.replace(/\s+/g, " ").trim())).toEqual([
      "Keyboard shortcuts ?", "Guide: why each thing is here", "Show the welcome tour", "Get the apps", "Find anything Ctrl K", "Collapse the list to faces Ctrl B", "Quick ask"]);
    await click([...s.querySelectorAll("button")].find((b) => b.textContent === "Show the welcome tour"));
    expect(seen).toEqual(["tour"]);
    expect(undeclaredControls(host.querySelector(".r1s-col")!).filter((e) => !e.closest("[data-classic-block]"))).toEqual([]);
  });
});
