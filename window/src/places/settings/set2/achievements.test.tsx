// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { LOOK_PREF, forgetLookStore } from "../set1/appearance-store";
import { AchievementsPage, BADGES, CATS } from "./achievements";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  forgetLookStore();
  document.head.querySelector("#branch-look")?.remove();
  globalThis.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof matchMedia;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(look?: Record<string, unknown>) {
  const prefs: Record<string, unknown> = look ? { [LOOK_PREF]: look } : {};
  const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
    if (method === "users.prefs.get") return { status: "ok", entries: { ...prefs } };
    if (method === "users.prefs.set") { Object.assign(prefs, params?.entries); return { status: "ok" }; }
    if (method === "themes.list") return { current: { id: "slate", mode: "system", scope: "profile", overrides: {} }, themes: [] };
    return { status: "ok" };
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine;
  return { engine, request, prefs };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0, openSettings?: (page: string) => void) {
  const lv = (["regular", "advanced", "technical"] as const)[level];
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><AchievementsPage page="achievements" title="Achievements" level={lv} engine={engine} openSettings={openSettings} /></KitProvider>));
  await act(async () => { await Promise.resolve(); });
}
const lede = () => host.querySelector(".lede")?.textContent ?? "";
const chips = () => [...host.querySelectorAll(".tierc")].map((c) => c.textContent);
const badgeCards = () => [...host.querySelectorAll<HTMLElement>(".ach[data-badge]")];
const unlocked = () => badgeCards().filter((c) => !c.classList.contains("locked")).map((c) => c.dataset.badge);
const petCard = (id: string) => host.querySelector<HTMLElement>(`.ach[data-pet="${id}"]`)!;
const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>(".tab")].find((t) => t.textContent === name)!;
const sections = () => [...host.querySelectorAll(".sec > h2")].map((h) => h.textContent);

describe("Settings › Achievements", () => {
  it("shows the whole catalogue locked, with real counts and the reason, when nothing is counted", async () => {
    const { engine } = engineOf({ pet: "none" });
    await render(engine);
    expect(BADGES.length).toBe(128);
    expect(new Set(BADGES.map((b) => b.name)).size).toBe(BADGES.length);
    expect(lede()).toContain("0 of 128 unlocked.");
    expect(lede()).not.toContain("505");
    expect(chips()).toEqual(["Bronze · 0/42", "Silver · 0/44", "Gold · 0/9", "Diamond · 0/20", "Godly · 0/8", "SSS+ · 0/5"]);
    expect(badgeCards()).toHaveLength(128);
    expect(unlocked()).toEqual([]);
    expect(host.textContent).toContain("Branch doesn’t count most achievements yet.");
    expect(host.querySelector(".sec[data-sec=\"Pets you’ve had\"] .hint")?.textContent).toBe("0 of 42 met");
    expect(host.querySelectorAll(".pet18u.locked")).toHaveLength(42);
    const quiet = host.querySelector<HTMLInputElement>('input[aria-label="Keep achievements quiet"]')!;
    expect(quiet.checked).toBe(false);
    expect(quiet.closest(".ctl")?.classList.contains("off-k")).toBe(true);
  });

  it("filters the grid by category tab", async () => {
    const { engine } = engineOf();
    await render(engine);
    expect([...host.querySelectorAll(".tab")].map((t) => t.textContent)).toEqual(CATS);
    expect(CATS).toEqual(["All", "Getting started", "Trunks & devices", "Automations", "Looks & fun", "Streaks", "Safety", "Explorer", "Secrets"]);
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
    await act(async () => tab("Secrets").click());
    expect(tab("Secrets").getAttribute("aria-selected")).toBe("true");
    const names = badgeCards().map((c) => c.dataset.badge);
    expect(names).toHaveLength(BADGES.filter((b) => b.cat === "Secrets").length);
    expect(names).toContain("Knock knock");
    expect(names).toContain("Solstice at midnight");
    expect(names).not.toContain("First words");
    expect(badgeCards().filter((c) => c.title === "SSS+")).toHaveLength(5);
    await act(async () => tab("All").click());
    expect(badgeCards()).toHaveLength(128);
  });

  it("unlocks only the level badges the window can see, and draws the same sections at every level", async () => {
    const seen: string[][] = [];
    for (const level of [0, 1, 2] as const) {
      const { engine } = engineOf();
      await render(engine, level);
      seen.push(sections());
      if (level === 0) { expect(unlocked()).toEqual([]); expect(lede()).toContain("0 of 128"); }
      if (level === 1) { expect(unlocked()).toEqual(["Advanced"]); expect(chips()).toContain("Diamond · 1/20"); }
      if (level === 2) {
        expect(unlocked()).toEqual(["Technical", "Advanced"]);
        expect(lede()).toContain("2 of 128 unlocked.");
        expect(chips()).toContain("Diamond · 2/20");
      }
    }
    expect(seen[0]).toEqual(["Pets you’ve had", "Settings"]);
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
  });

  it("lists the pets you've had from the look and opens Appearance with the one you pick", async () => {
    const { engine, prefs } = engineOf({ pet: "otter", petsHad: ["px-squirrel", "otter"], petFirst: "Sep 12" });
    const open = vi.fn();
    await render(engine, 0, open);
    expect(host.querySelector(".sec[data-sec=\"Pets you’ve had\"] .hint")?.textContent).toBe("2 of 42 met · first Sep 12");
    expect(petCard("otter").textContent).toBe("OtterWith you now");
    expect(petCard("px-squirrel").textContent).toBe("SquirrelMet");
    expect(petCard("squirrel").classList.contains("locked")).toBe(true);
    expect([...host.querySelectorAll(".pet18u b")].slice(0, 3).map((b) => b.textContent)).toEqual(["Squirrel", "Owl", "Hedgehog"]);
    await act(async () => petCard("px-squirrel").click());
    await act(async () => { await Promise.resolve(); });
    expect(prefs[LOOK_PREF]).toMatchObject({ petsHad: ["px-squirrel", "otter"] });
    expect((prefs[LOOK_PREF] as Record<string, unknown>).pet).toBeUndefined();
    expect(open).toHaveBeenCalledWith("appearance");
  });
});
