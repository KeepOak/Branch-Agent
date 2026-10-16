// @vitest-environment jsdom
// Re-hosted Settings pages: in the R1 Settings frame each draws the same Classic sections and rows the Classic frame
// draws, so nothing working is left behind, and its Classic rows join the R1 search.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { comingControls } from "../../../glass/coming-registry";
import { SettingsPage, SETTINGS_ROWS } from "../../../places/settings";
import { KitProvider } from "../../../places/settings/kit";
import { ROWS as COMPUTER_ROWS, partRows } from "../../../places/settings/set2/computer-more";
import { PAGES, sectionNeed } from "../nav";
import { ROWS } from "../rows";
import { searchSettings } from "../search";
import { mergeRows } from "../slots";
import { SECTION_COMING, SettingsFrame } from "../SettingsFrame";
import { classicList } from "./classic-host";
import { COMING, R1_PAGES, REHOSTED } from "./plugged";
import { TOWN_ROWS } from "./privacy-town";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("branch.level", "technical");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const engine = (scopes = ["operator.admin"]) => ({ request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes, features: { methods: [], events: [] } }) as unknown as WindowEngine;
/** What a page draws: its section titles and its rows, in order. */
const drawn = (el: ParentNode) => ({
  sections: [...el.querySelectorAll<HTMLElement>("[data-sec]")].map((s) => s.dataset.sec),
  rows: [...el.querySelectorAll<HTMLElement>("[data-row]")].map((r) => r.dataset.row),
});
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });

it("re-hosts exactly these Classic pages", () => {
  expect(REHOSTED).toEqual({
    card: "people",
    notifications: "notifications",
    browser: "computer-browser",
    coding: "computer-coding",
    models: "models",
    permissions: "permissions",
    privacy: "usage",
  });
});

for (const [page, classic] of Object.entries(REHOSTED)) {
  const list = classicList(classic);
  it(`draws Settings › ${page} in the R1 frame with every section and row of Classic ${list.join(" and ")}`, async () => {
    await act(async () => root.render(<KitProvider level={2} report={{ saving() {}, saved() {}, failed() {} }} scope={null}>{list.map((id) => <SettingsPage key={id} page={id} title="Classic" level="technical" engine={engine()} />)}</KitProvider>));
    await settle();
    const before = drawn(host);
    await act(async () => root.render(<SettingsFrame engine={engine()} page={page} pages={R1_PAGES} />));
    await settle();
    const hosted = host.querySelector<HTMLElement>(`.r1s-custom[data-slot="${page}"] .r1s-classic[data-classic="${list.join(" ")}"]`);
    expect(hosted, page).not.toBeNull();
    expect(before.sections.length + before.rows.length, list.join(" ")).toBeGreaterThan(0);
    expect(drawn(hosted!)).toEqual(before);
  });
}

it("splits Classic Computer & browser between Browser & screen, Coding and Devices, each of its sections on exactly one", () => {
  const key = (r: { title: string; sec?: string }) => `${r.sec} › ${r.title}`;
  const parts = (["browser", "coding", "devices"] as const).map((part) => partRows(part, part).map(key));
  expect(parts.flat().sort()).toEqual(COMPUTER_ROWS.map(key).sort());
  expect(parts[0]).toEqual(expect.arrayContaining(["The browser › The browser", "Using the screen › Using the screen", "Logbook › Logbook", "On a computer › See the screen and use the mouse"]));
  expect(parts[1]).toEqual(expect.arrayContaining(["Git › Git", "Code and commits › Code and commits", "Code › Remember the shell"]));
  expect(parts[2]).toEqual(expect.arrayContaining(["Cloud computers › Cloud computers", "Who is connected now › Who is connected now"]));
});

it("draws on Browser & screen and Coding only sections Classic Computer & browser draws, in its order, and Coding apps from Accounts", async () => {
  await act(async () => root.render(<KitProvider level={2} report={{ saving() {}, saved() {}, failed() {} }} scope={null}><SettingsPage page="computer" title="Classic" level="technical" engine={engine()} /></KitProvider>));
  await settle();
  const classic = drawn(host).sections;
  for (const page of ["browser", "coding"] as const) {
    await act(async () => root.render(<SettingsFrame engine={engine()} page={page} pages={R1_PAGES} />));
    await settle();
    const hosted = drawn(host.querySelector(`.r1s-custom[data-slot="${page}"] .r1s-classic`)!).sections;
    const own = hosted.filter((sec) => sec !== "Coding apps on this computer");
    expect(own.length, page).toBeGreaterThan(0);
    expect(classic.filter((sec) => own.includes(sec)), page).toEqual(own);
    expect(hosted.includes("Coding apps on this computer"), page).toBe(page === "coding");
  }
  expect(host.querySelector('[data-sec="Coding apps on this computer"]')!.textContent).toContain("Codex");
});

it("draws each Browser & screen and Coding card no Classic control has yet as Coming, naming the call it waits for", async () => {
  expect(COMING).toEqual({ browser: ["Sites", "Saved flows"], coding: ["Commands", "Files"] });
  for (const [page, cards] of Object.entries(COMING) as [keyof typeof COMING, readonly string[]][]) {
    const classic = classicList(REHOSTED[page]);
    for (const card of cards) {
      expect(PAGES[page].cards, page).toContain(card);
      expect(SETTINGS_ROWS.some((r) => classic.includes(r.page) && (r.sec === card || r.group === card)), `${page}: ${card}`).toBe(false);
    }
    await act(async () => root.render(<SettingsFrame engine={engine()} page={page} pages={R1_PAGES} />));
    await settle();
    const shown = [...host.querySelectorAll<HTMLElement>(`.r1s-custom[data-slot="${page}"] .r1s-classic-coming`)];
    expect(shown.map((s) => s.getAttribute("aria-label"))).toEqual(cards);
    for (const s of shown) expect(s.querySelector("[data-coming]")!.getAttribute("data-coming")).toBe(SECTION_COMING(s.getAttribute("aria-label")!));
    for (const card of cards) {
      expect(comingControls()).toContainEqual(expect.objectContaining({ where: `${PAGES[page].title} › ${card}`, need: [sectionNeed(page, card)] }));
    }
  }
});

it("leaves out the Browser & screen and Coding cards that are all Coming at Regular, and keeps every working Classic section", async () => {
  localStorage.setItem("branch.level", "regular");
  for (const page of ["browser", "coding"] as const) {
    await act(async () => root.render(<SettingsFrame key={page} engine={engine()} page={page} pages={R1_PAGES} />));
    await settle();
    expect(host.querySelector(`.r1s-custom[data-slot="${page}"] .r1s-classic`), page).not.toBeNull();
    expect(host.querySelectorAll(".r1s-classic-coming").length, page).toBe(0);
    expect(host.textContent, page).not.toContain("comes to this page in a later update");
  }
});

it("keeps Models' Local tab on the R1 Models page and sends its Accounts tab to the R1 Accounts page", async () => {
  const onPage = vi.fn();
  await act(async () => root.render(<SettingsFrame engine={engine()} page="models" pages={R1_PAGES} onPage={onPage} />));
  await settle();
  const hosted = host.querySelector<HTMLElement>('.r1s-custom[data-slot="models"] .r1s-classic[data-classic="models"]')!;
  const tab = (name: string) => [...hosted.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent === name)!;
  expect([...hosted.querySelectorAll('[role="tab"]')].map((b) => b.textContent)).toEqual(["Accounts", "Default", "Local", "Double-check", "Media"]);
  await act(async () => tab("Local").click());
  await settle();
  expect(onPage).not.toHaveBeenCalled();
  expect(tab("Local").getAttribute("aria-selected")).toBe("true");
  await act(async () => tab("Accounts").click());
  expect(onPage.mock.calls).toEqual([["accounts"]]);
});

it("opens Browser & screen from Permissions' Open that switch, where R1 keeps the screen switch", async () => {
  const onPage = vi.fn();
  await act(async () => root.render(<SettingsFrame engine={engine()} page="permissions" pages={R1_PAGES} onPage={onPage} />));
  await settle();
  const hosted = host.querySelector<HTMLElement>('.r1s-custom[data-slot="permissions"] .r1s-classic[data-classic="permissions"]')!;
  await act(async () => [...hosted.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Open that switch")!.click());
  expect(onPage.mock.calls).toEqual([["browser"]]);
});

it("adds each re-hosted page's Classic rows to the R1 table, so R1 search finds them on their R1 page", () => {
  const merged = mergeRows(ROWS, R1_PAGES);
  expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
  for (const [page, classic] of Object.entries(REHOSTED)) {
    const titles = new Set(SETTINGS_ROWS.filter((r) => classicList(classic).includes(r.page)).map((r) => r.title));
    expect(titles.size, classicList(classic).join(" ")).toBeGreaterThan(0);
    const extra = page === "privacy" ? TOWN_ROWS.map((row) => row.label) : [];
    expect(new Set(merged.filter((r) => r.page === page).map((r) => r.label))).toEqual(new Set([...titles, ...extra]));
    const first = [...titles][0]!;
    const hits = searchSettings(first, { level: 2, hints: {}, rows: merged }).settings;
    expect(hits.some((hit) => hit.kind === "row" && hit.page === page), `${page}: ${first}`).toBe(true);
  }
});
