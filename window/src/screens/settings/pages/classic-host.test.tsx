// @vitest-environment jsdom
// Re-hosted Settings pages: in the R1 Settings frame each draws the same Classic sections and rows the Classic frame
// draws, so nothing working is left behind, and its Classic rows join the R1 search.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage, SETTINGS_ROWS } from "../../../places/settings";
import { KitProvider } from "../../../places/settings/kit";
import { ROWS } from "../rows";
import { searchSettings } from "../search";
import { mergeRows } from "../slots";
import { SettingsFrame } from "../SettingsFrame";
import { ADMIN_ONLY, classicList } from "./classic-host";
import { R1_PAGES, REHOSTED } from "./plugged";

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
  expect(REHOSTED).toEqual({ who: "people", notifications: "notifications", instructions: "instructions", signins: "secrets", updates: "updates", privacy: "usage", history: "backups", learning: ["self", "seasons"], remote: "gateway", voice: "voice" });
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

it("keeps Sign-ins & keys empty without operator.admin, as Classic hides it, and says why", async () => {
  await act(async () => root.render(<SettingsFrame engine={engine(["operator.read"])} page="signins" pages={R1_PAGES} />));
  await settle();
  const hosted = host.querySelector<HTMLElement>('.r1s-custom[data-slot="signins"] .r1s-classic[data-classic="secrets"]')!;
  expect(hosted.textContent).toContain(ADMIN_ONLY);
  expect(drawn(hosted)).toEqual({ sections: [], rows: [] });
});

it("adds each re-hosted page's Classic rows to the R1 table, so R1 search finds them on their R1 page", () => {
  const merged = mergeRows(ROWS, R1_PAGES);
  expect(new Set(merged.map((r) => r.id)).size).toBe(merged.length);
  for (const [page, classic] of Object.entries(REHOSTED)) {
    const titles = new Set(SETTINGS_ROWS.filter((r) => classicList(classic).includes(r.page)).map((r) => r.title));
    expect(titles.size, classicList(classic).join(" ")).toBeGreaterThan(0);
    expect(new Set(merged.filter((r) => r.page === page).map((r) => r.label))).toEqual(titles);
    const first = [...titles][0]!;
    const hits = searchSettings(first, { level: 2, hints: {}, rows: merged }).settings;
    expect(hits.some((hit) => hit.kind === "row" && hit.page === page), `${page}: ${first}`).toBe(true);
  }
});
