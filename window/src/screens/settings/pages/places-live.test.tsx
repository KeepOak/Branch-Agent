// @vitest-environment jsdom
// Go to and All features follow the approved preview (#1049, section D Go to / All features): Go to draws the preview's
// line and its twelve tiles, each with its subtitle (Harvest, Workshop and This computer are Coming), with the Inbox and
// People badges; All features draws its "Everything Branch does…" line above the atlas.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { FEATURES_LEDE } from "../../features/FeaturesPage";
import { featureRoute, GOTO_LEDE, placePages } from "./places-live";

vi.mock("../../../places/inbox/data", () => ({ loadNeedsCount: async () => 17 }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const engine = { request: async (method: string) => (method === "users.list" ? { profiles: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] } : {}), onEvent: () => () => undefined, scopes: [] } as unknown as WindowEngine;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

it("draws Go to as the preview does: its line, then twelve tiles with their subtitles, badges for Inbox and People", async () => {
  const go = vi.fn();
  const GoTo = placePages(go).goto!.component!;
  await act(async () => root.render(<GoTo engine={engine} />));
  await settle();
  expect(host.querySelector("h1")).toBeNull();
  expect(host.querySelector(".r1s-lede")?.textContent).toBe(GOTO_LEDE);
  expect(GOTO_LEDE).toBe("Every page in Branch, in one place. Each also opens from Ctrl K.");
  const tiles = [...host.querySelectorAll<HTMLElement>(".r1s-tile")];
  expect(tiles.map((t) => [t.querySelector("b")?.firstChild?.textContent, t.querySelector("small")?.textContent])).toEqual([
    ["Overview", "Today at a glance"], ["Canopy", "Every Trunk’s work, side by side"], ["Inbox", "What needs you, what finished"], ["Automations", "What runs by itself"],
    ["Library", "Files, memory and knowledge"], ["People", "Who your Trunks know"], ["Customize", "What your Trunks can do"], ["Harvest", "Everything your Trunks made"],
    ["Grove", "Your Trunks at their desks"], ["Seedbank", "Agents, skills, tools, plugins, connections"], ["Workshop", "Skill drafts your Trunks proposed"], ["This computer", "Computers, gateway and battery"],
  ]);
  expect(host.querySelector('[data-place="inbox"] .r1s-badge')?.textContent).toBe("17");
  expect(host.querySelector('[data-place="people"] .r1s-badge')?.textContent).toBe("4");
  for (const id of ["harvest", "workshop", "computer"]) expect(host.querySelector(`[data-tile="${id}"]`)?.getAttribute("aria-disabled"), id).toBe("true");
  const live = [...host.querySelectorAll<HTMLButtonElement>("button[data-place]")];
  expect(live.map((b) => b.dataset.place)).toEqual(["overview", "canopy", "inbox", "automations", "library", "people", "customize", "office", "seedbank"]);
  for (const button of live) await act(async () => button.click());
  expect(go.mock.calls.map(([route]) => route.place)).toEqual(["overview", "canopy", "inbox", "automations", "library", "people", "customize", "office", "seedbank"]);
});

it("draws All features' line above the atlas, as the preview does", async () => {
  const Features = placePages(() => undefined).features!.component!;
  await act(async () => root.render(<Features engine={engine} />));
  expect(host.querySelector(".r1s-features-lede")?.textContent).toBe(FEATURES_LEDE);
  expect(FEATURES_LEDE).toMatch(/^Everything Branch does, will do, or learned from the apps it grew from, in one place: \d+ kinds, \d+ areas\.$/);
});

it("gives Seedbank and All features their own R1 screens", () => {
  const pages = placePages(() => undefined);
  expect(Object.keys(pages)).toEqual(["goto", "seedbank", "features"]);
  expect(typeof pages.seedbank?.component).toBe("function");
  expect(typeof pages.features?.component).toBe("function");
});

it("opens a feature where it lives: a Settings page, a place or the conversation", () => {
  expect(featureRoute({ kind: "settings", page: "browser" })).toEqual({ kind: "settings", page: "browser" });
  expect(featureRoute({ kind: "place", place: "customize", tab: "tools" })).toEqual({ kind: "place", place: "customize" });
  expect(featureRoute({ kind: "chat" })).toEqual({ kind: "chat", key: null });
});
