// @vitest-environment jsdom
// Settings › Trunks follows the approved preview (#1049, section D Trunks majors; preview.html PG trunksP17): one
// "Start from a template" row instead of the job tiles, each row with only Edit and •••, the preview's ••• menu with Who
// it knows in it, and at Advanced the "Defaults for every Trunk" and "Trunks’ own databases" cards; no "Groups and Grafted
// agents" card.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SETTINGS_MENU_COMING } from "../../../places/customize/trunks";
import { visibleDevNotes } from "../../../shell/shown-why.testing";
import { ROWS } from "../rows";
import { searchSettings } from "../search";
import { mergeRows } from "../slots";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";
import { TRUNK_DEFAULTS, TRUNK_ROWS } from "./trunks-live";

vi.mock("../../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
vi.mock("../../../face/CharacterFace", () => ({ CharacterFace: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const ROSTER = { defaultId: "oak", mainKey: "main", agents: [{ id: "oak", identity: { name: "Oak", theme: "Helps" } }, { id: "birch", identity: { name: "Birch", theme: "Reads" } }] };
const CONFIG = { hash: "h1", valid: true, config: { agents: { defaults: { userTimezone: "UTC" }, entries: { oak: { default: true } } } } };
function engineOf() {
  const request = vi.fn(async (method: string, _params: Record<string, unknown> = {}) => method === "agents.list" ? ROSTER : method === "config.get" ? CONFIG : method === "trunks.template.export" ? { ok: true } : {});
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "oak", scopes: ["operator.admin"], features: { methods: ["agents.list", "config.get", "config.patch", "trunks.template.export"], events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const cards = () => [...host.querySelectorAll<HTMLElement>(".r1s-custom .r1s-sec")].map((s) => s.querySelector(":scope > h2")?.textContent ?? "");
async function mount(level: "regular" | "advanced" | "technical", onPage?: (page: string) => void) {
  localStorage.setItem("branch.level", level);
  const env = engineOf();
  await act(async () => root.render(<SettingsFrame engine={env.engine} page="trunks" pages={R1_PAGES} onPage={onPage} />));
  await settle();
  return env;
}

it("draws the preview's Trunks card: rows with Edit and •••, A new Trunk, New group chat and one template row", async () => {
  const onPage = vi.fn();
  await mount("regular", onPage);
  const page = host.querySelector<HTMLElement>('.r1s-custom[data-slot="trunks"]')!;
  expect([...host.querySelectorAll("h1")].map((h) => h.textContent)).toEqual(["Trunks"]);
  expect([...page.querySelectorAll(".tk-row .tk-row-who")].map((b) => b.getAttribute("aria-label"))).toEqual(["Oak: profile", "Birch: profile"]);
  expect([...page.querySelectorAll(".tk-row")].map((r) => [...r.querySelectorAll("button:not(.tk-row-who)")].map((b) => b.textContent || b.getAttribute("aria-label")))).toEqual([["Edit", "More for Oak"], ["Edit", "More for Birch"]]);
  expect(button("A new Trunk").disabled).toBe(false);
  expect(button("New group chat")).toBeTruthy();
  expect(page.textContent).not.toContain("Use this job");
  expect(page.querySelector('[data-row="trunks.templates"] b')?.textContent).toBe("Start from a template");
  expect(cards()).toEqual([""]);
  await act(async () => button("Templates in Seedbank").click());
  expect(onPage).toHaveBeenCalledWith("seedbank");
});

it("puts the preview's ••• menu on each Trunk, with Who it knows, and greys what nothing stands behind yet", async () => {
  const { request } = await mount("regular");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="More for Birch"]')!.click());
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
  expect(items.map((b) => b.textContent)).toEqual(["Change picture…", "Pause", "Make default", "Share this Trunk…", "Who it knows", "Show it how, once", "Package…",
    "Copy seed", "Download seed", "Copy its look", "Share to Seedbank…", "Remove Trunk…"]);
  expect(items.filter((b) => b.disabled).map((b) => b.textContent)).toEqual(["Pause", "Show it how, once", "Package…", "Copy seed", "Download seed", "Copy its look", "Share to Seedbank…"]);
  for (const why of Object.values(SETTINGS_MENU_COMING)) expect(why).toMatch(/ comes in a later update\.$/);
  expect(visibleDevNotes(document.body)).toEqual([]);
  // The default Trunk's Remove is greyed with the preview's own line.
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="More for Oak"]')!.click());
  const remove = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((b) => b.textContent === "Remove Trunk…")!;
  expect(remove.disabled).toBe(true);
  expect(remove.title).toBe("Oak is your default Trunk.");
  expect(document.body.textContent).not.toMatch(/cannot be removed|at least one Trunk/);
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="More for Birch"]')!.click());
  await act(async () => button("Share this Trunk…").click());
  await settle();
  expect(request).toHaveBeenCalledWith("trunks.template.export", { agentId: "birch" });
});

it("draws Defaults for every Trunk and Trunks’ own databases at Advanced, and the folder defaults inside the Trunks card at Technical", async () => {
  await mount("advanced");
  expect(cards()).toEqual(["", "Defaults for every Trunk", "Trunks’ own databases"]);
  const defaults = host.querySelector<HTMLElement>('.r1s-sec[aria-label="Defaults for every Trunk"]')!;
  expect([...defaults.querySelectorAll(".r1s-row > b")].map((b) => b.textContent)).toEqual(TRUNK_DEFAULTS.map((d) => d.label));
  expect(TRUNK_DEFAULTS.map((d) => d.label)).toEqual(["Projects pick up matching work", "Follow-up tasks", "Standing orders", "“From now on” for a specialist", "Share a Trunk", "Custom modes", "Agent marketplace", "Trunk packages"]);
  for (const label of ["Projects pick up matching work", "Follow-up tasks", "Custom modes", "Trunk packages"]) {
    const row = [...defaults.querySelectorAll<HTMLElement>(".r1s-row")].find((r) => r.querySelector(":scope > b")?.textContent === label)!;
    const sw = row.querySelector<HTMLButtonElement>('[role="switch"]')!;
    expect(sw.disabled).toBe(true);
    expect(sw.getAttribute("aria-disabled")).toBe("true");
    expect(row.querySelector(".r1s-note")?.textContent).toBe(`${label} comes in a later update.`);
  }
  expect(host.textContent).not.toContain("Groups and Grafted agents");
  expect(host.textContent).not.toContain("Working folder");
  await act(async () => root.unmount()); root = createRoot(host);
  await mount("technical");
  const first = host.querySelector<HTMLElement>(".r1s-trunks")!;
  expect(first.textContent).toContain("Working folder");
  expect(first.querySelector(".tk-h")).toBeNull();
});

it("adds the page's rows to the R1 table, so R1 search finds them on Settings › Trunks", () => {
  const merged = mergeRows(ROWS, R1_PAGES);
  expect(merged.filter((r) => r.page === "trunks").map((r) => r.id)).toEqual(TRUNK_ROWS.map((r) => r.id));
  const hits = searchSettings("Working folder", { level: 2, hints: {}, rows: merged }).settings;
  expect(hits.filter((h) => h.kind === "row" && h.page === "trunks").map((h) => h.id)).toEqual(["trunks.defaults.cwd"]);
  expect(searchSettings("template", { level: 0, hints: {}, rows: merged }).settings.map((h) => h.id)).toContain("trunks.templates.start");
});
