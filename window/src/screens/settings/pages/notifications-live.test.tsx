// @vitest-environment jsdom
// Settings › Notifications in R1 (#1049 section D): a native R1 page in the R1 Settings frame with the approved preview's
// nine cards in its order (preview.html PG notifications), its rows and Learn more sheet, not Classic Notifications in a
// wrapper. Every working Classic control is on its row on the same calls; the rest are Coming in their own words.
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

const PREVIEW_CARDS = ["Tell me when…", "Quiet", "When work stalls", "Live activity", "Kinds of notice", "Sorting", "This PC", "Send events to a web address", "Web Push"];
const REGULAR: Record<string, string[]> = {
  "Tell me when…": ["A Trunk needs a yes", "A Trunk asks you something", "A long task finishes", "A Trunk replies", "Something stops working",
    "A Trunk sends a notification", "An automation fails", "Someone mentions you", "Play a sound", "Send a test notification"],
  Quiet: ["Quiet hours", "Time zone", "Days off"],
  "When work stalls": ["A conversation stopped moving"],
  "Live activity": ["Live activity at the top of the screen (Mac)"],
  "Send events to a web address": ["Address", "Events"],
  "Web Push": ["Push to your phone", "Push to this browser"],
};
const METHODS = ["config.get", "config.schema", "users.prefs.get", "users.prefs.set", "agents.list", "push.web.test", "push.web.preferences.get", "push.web.preferences.set",
  "push.web.vapidPublicKey", "push.web.subscribe", "push.web.unsubscribe"];
function engineOf() {
  let saved: unknown = { categories: { approvalRequested: true, agentQuestion: false }, quietHours: { enabled: true, startMinute: 1320, endMinute: 420, timeZone: "UTC" } };
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: { "notifications.web.v1": saved } };
    if (method === "users.prefs.set") { saved = (params as { entries: Record<string, unknown> }).entries["notifications.web.v1"]; return { status: "ok" }; }
    if (method === "agents.list") return { agents: [{ id: "main", name: "Sapling" }, { id: "scout", name: "Scout" }] };
    if (method === "push.web.test") return { results: [{ ok: true }] };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); });
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await settle(); };
const setLevel = (label: string) => click([...host.querySelectorAll(".r1s-level button")].find((b) => b.textContent === label));
const row = (id: string) => host.querySelector<HTMLElement>(`[data-row="${id}"]`);
async function mount() {
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="notifications" pages={R1_PAGES} />));
  await settle();
  return env;
}
const sections = () => [...host.querySelectorAll<HTMLElement>("section.r1s-sec")];
const labels = (sec: HTMLElement) => [...sec.querySelectorAll<HTMLElement>(".r1s-row > b")].map((b) => b.textContent ?? "");
const card = (t: string) => sections().find((s) => s.getAttribute("aria-label") === t)!;

describe("R1 Settings › Notifications is a native R1 page with the preview's cards", () => {
  it("draws the preview's Regular cards and rows in order under the frame's title, lede and Learn more", async () => {
    expect(PAGES.notifications.cards).toEqual(PREVIEW_CARDS);
    expect(R1_PAGES.notifications?.component).toBeUndefined();
    await mount();
    expect(host.querySelector(".r1s-custom, .r1s-classic, [data-classic]")).toBeNull();
    expect(host.querySelector(".r1s-head h1")?.textContent).toBe("Notifications");
    expect(host.querySelector(".r1s-lede")?.textContent).toContain(PAGES.notifications.lede);
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(Object.keys(REGULAR));
    expect(row("notifications.tell.here")).not.toBeNull();
    expect(row("notifications.tell.here")!.querySelector(":scope > b")).toBeNull();
    expect(row("notifications.tell.here")!.querySelector("[role=switch]")).not.toBeNull();
    for (const [t, rows] of Object.entries(REGULAR)) expect(labels(card(t)), t).toEqual(rows);
    await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Learn more"));
    expect([...host.querySelectorAll(".r1s-help li")].map((li) => li.textContent)).toEqual(Object.keys(REGULAR));
  });

  it("draws all nine preview cards at Technical in order", async () => {
    await mount();
    await setLevel("Technical");
    expect(sections().map((s) => s.getAttribute("aria-label"))).toEqual(PREVIEW_CARDS);
    expect(labels(card("Kinds of notice"))).toEqual(["Health", "Urgent", "Reminders", "Email", "Calendar", "Builds", "Stocks", "Everything else"]);
  });

  it("says why each Coming row waits in one plain sentence, never naming how Branch works inside", async () => {
    await mount();
    await setLevel("Technical");
    const reasons = [...host.querySelectorAll<HTMLElement>("[data-coming]")].map((r) => (r.querySelector(".r1s-note")?.textContent ?? "").replace(r.querySelector(":scope > b")?.textContent ?? "\u0000", ""));
    expect(reasons.length).toBeGreaterThan(15);
    for (const r of reasons) expect(r, r).not.toMatch(/engine|gateway call|method|config|\b[a-z]+\.[a-z]+\b/i);
  });

  it("keeps Classic's working controls live on the same calls, and declares every control", async () => {
    const { request } = await mount();
    await setLevel("Advanced");
    expect(undeclaredControls(host)).toEqual([]);
    const sw = row("notifications.tell.agentQuestion")!.querySelector<HTMLElement>("[role=switch]");
    expect(sw?.getAttribute("aria-checked")).toBe("false");
    await click(sw);
    const sets = request.mock.calls.filter(([m]) => m === "users.prefs.set");
    expect(JSON.stringify(sets.at(-1)?.[1])).toContain('"agentQuestion":true');
    await click([...row("notifications.tell.trunks")!.querySelectorAll("button")].find((b) => b.textContent === "Scout"));
    expect(JSON.stringify(request.mock.calls.filter(([m]) => m === "users.prefs.set").at(-1)?.[1])).toContain('"agentIds":["scout"]');
    await click([...row("notifications.tell.test")!.querySelectorAll("button")].find((b) => b.textContent === "Send test"));
    expect(request.mock.calls.some(([m]) => m === "push.web.test")).toBe(true);
    expect(row("notifications.quiet.hours")!.querySelector<HTMLElement>("[role=switch]")?.getAttribute("aria-checked")).toBe("true");
  });
});
