// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { TRUNK_MENU_COMING } from "../../../places/customize/trunks";
import { visibleDevNotes } from "../../../shell/shown-why.testing";
import { ROWS } from "../rows";
import { searchSettings } from "../search";
import { mergeRows } from "../slots";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";
import { TRUNK_ROWS, TRUNKS_COMING } from "./trunks-live";

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
  const request = vi.fn(async (method: string) => method === "agents.list" ? ROSTER : method === "config.get" ? CONFIG : method === "trunks.template.export" ? { ok: true } : {});
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "oak", scopes: ["operator.admin"], features: { methods: ["agents.list", "config.get", "config.patch", "trunks.template.export"], events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;

it("draws Settings › Trunks as the full Trunks page: every Trunk, A new Trunk, New group chat and the job templates", async () => {
  const { engine } = engineOf();
  await act(async () => root.render(<SettingsFrame engine={engine} page="trunks" pages={R1_PAGES} />));
  await settle();
  const page = host.querySelector<HTMLElement>('.r1s-custom[data-slot="trunks"]')!;
  // The frame draws the title above the page (#1049); the page draws none of its own.
  expect([...host.querySelectorAll("h1")].map((h) => h.textContent)).toEqual(["Trunks"]);
  expect(page.querySelector("h1")).toBeNull();
  expect([...page.querySelectorAll(".tk-row .tk-row-who")].map((b) => b.getAttribute("aria-label"))).toEqual(["Oak: profile", "Birch: profile"]);
  expect(button("A new Trunk").disabled).toBe(false);
  expect(button("New group chat")).toBeTruthy();
  expect(page.textContent).toContain("Start from a job");
  expect(page.textContent).not.toContain("Defaults for every Trunk");
});

it("puts the approved ••• items on each Trunk: Share works, Pause, Show it how once and Package… are greyed naming their call", async () => {
  const { engine, request } = engineOf();
  await act(async () => root.render(<SettingsFrame engine={engine} page="trunks" pages={R1_PAGES} />));
  await settle();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="More for Birch"]')!.click());
  const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] button')];
  expect(items.map((b) => b.textContent)).toEqual(["Pause Birch", "Make default", "Share this Trunk…", "Show it how once", "Package…", "Remove Birch…"]);
  expect(items.filter((b) => b.disabled).map((b) => b.textContent)).toEqual(["Pause Birch", "Show it how once", "Package…"]);
  expect(Object.values(TRUNK_MENU_COMING)).toEqual([
    "Needs the engine’s pause for a Trunk (agents.pause, agents.resume).",
    "Needs the engine to record a task you show it (trunks.watch).",
    "Needs the engine’s Trunk packages (claws.packages).",
  ]);
  expect(visibleDevNotes(document.body)).toEqual([]);
  await act(async () => button("Share this Trunk…").click());
  await settle();
  expect(request).toHaveBeenCalledWith("trunks.template.export", { agentId: "birch" });
});

it("draws the defaults for every Trunk and both Coming rows at Technical, each naming its engine call", async () => {
  localStorage.setItem("branch.level", "technical");
  const { engine } = engineOf();
  await act(async () => root.render(<SettingsFrame engine={engine} page="trunks" pages={R1_PAGES} />));
  await settle();
  const page = host.querySelector<HTMLElement>('.r1s-custom[data-slot="trunks"]')!;
  expect(page.textContent).toContain("Defaults for every Trunk");
  expect(page.textContent).toContain("Working folder");
  expect(TRUNKS_COMING.map((c) => [c.card, c.need])).toEqual([["Groups and Grafted agents", "agents.setDefault"], ["Trunks’ own databases", "config.patch"]]);
  const coming = [...page.querySelectorAll<HTMLElement>('[aria-disabled="true"][data-coming]')].map((el) => el.querySelector("b")?.textContent);
  expect(coming).toEqual(TRUNKS_COMING.map((c) => c.label));
});

it("adds the page's rows to the R1 table, so R1 search finds them on Settings › Trunks", () => {
  const merged = mergeRows(ROWS, R1_PAGES);
  expect(merged.filter((r) => r.page === "trunks").map((r) => r.id)).toEqual(TRUNK_ROWS.map((r) => r.id));
  const hits = searchSettings("Working folder", { level: 2, hints: {}, rows: merged }).settings;
  expect(hits.filter((h) => h.kind === "row" && h.page === "trunks").map((h) => h.id)).toEqual(["trunks.defaults.cwd"]);
});
