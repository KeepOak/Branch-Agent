// @vitest-environment jsdom
// Settings › Who uses Branch in R1 (#1049 section D): a native R1 page with the approved preview's three cards (preview.html
// PG who), not Classic People in a wrapper; People opens with the list of everyone, as the preview does.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { undeclaredControls } from "../../../glass/coming-registry";
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

const PREVIEW_CARDS = ["People", "Records", "Signing in to Branch"];
const METHODS = ["config.get", "config.schema", "users.prefs.get", "audit.list", "agents.list"];
function engineOf() {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "users.list") return { profiles: [{ id: "me", displayName: "Taofik", role: "owner" }] };
    if (method === "users.self") return { profile: { id: "me", displayName: "Taofik", role: "owner" } };
    if (method === "agents.list") return { agents: [{ id: "main", name: "Sapling" }] };
    if (method === "audit.list") return { events: [{ eventId: "e1", agentId: "main", toolName: "read", status: "succeeded", occurredAt: Date.now() }] };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
async function mount() {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="who" pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];
const labels = (sec: HTMLElement) => [...sec.querySelectorAll<HTMLElement>(".r1s-row > b")].map((b) => b.textContent ?? "");

describe("R1 Settings › Who uses Branch is a native R1 page with the preview's cards", () => {
  it("draws People at Regular with the preview's rows and buttons, under the frame's title, lede and Learn more", async () => {
    expect(PAGES.who.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.who?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Who uses Branch");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(["People"]);
    // Both People rows are Coming, so Regular hides them (rows.ts COMING_FROM); they show at Technical.
    expect(labels(sections()[0])).toEqual([]);
    expect([...sections()[0].querySelectorAll("button")].map((b) => b.textContent)).toEqual(expect.arrayContaining(["Groups", "Signing in from other devices", "What you share"]));
    // The preview opens People with everyone who uses Branch and Invite someone, with no heading of its own.
    expect(sections()[0].textContent).toContain("Invite someone");
    expect(sections()[0].querySelectorAll("h1, h2:not(:first-child)").length).toBe(0);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Learn more"));
    expect([...host.querySelectorAll(".r1s-help li")].map((li) => li.textContent)).toEqual(["People"]);
  });

  it("draws the working cards at Advanced, and all three at Technical in order, with the fourteen sign-in rows", async () => {
    await mount();
    await setLevel("Advanced");
    // Signing in to Branch waits for a later update: it shows with every Coming row, at Technical (Private #1093 item 4).
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS.filter((c) => c !== "Signing in to Branch"));
    expect(labels(sections()[0])).toEqual([]);
    await setLevel("Technical");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    expect(labels(sections()[0])).toEqual(["Ask for a PIN when switching person", "Keep conversations separate"]);
    expect(labels(sections()[2])).toHaveLength(14);
  });

  it("opens the People place at a tab, opens the records, and says why each Coming row waits in plain words", async () => {
    const seen: unknown[] = [];
    window.addEventListener("branch:navigate-place", (e) => seen.push((e as CustomEvent).detail));
    const { request } = await mount();
    await setLevel("Technical");
    expect(undeclaredControls(host.querySelector(".r1s-col")!).filter((e) => !e.closest("[data-classic-block]")).map((e) => e.outerHTML.slice(0, 120))).toEqual([]);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "What you share"));
    expect(seen).toContainEqual({ place: "people", tab: "Shared" });
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "See the last"));
    expect(request.mock.calls.some(([m]) => m === "audit.list")).toBe(true);
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    expect(reasons.length).toBeGreaterThanOrEqual(16);
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });
});
