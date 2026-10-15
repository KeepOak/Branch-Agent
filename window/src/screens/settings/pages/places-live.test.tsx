// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { PLACES } from "../../../places-nav/routes";
import { featureRoute, placePages } from "./places-live";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("draws Go to's places with no title of its own (the frame draws it, #1049), and each opens that place", async () => {
  const go = vi.fn();
  const GoTo = placePages(go).goto!.component!;
  await act(async () => root.render(<GoTo engine={{} as WindowEngine} />));
  expect(host.querySelector("h1")).toBeNull();
  const buttons = [...host.querySelectorAll<HTMLButtonElement>("button[data-place]")];
  expect(buttons.map((b) => b.dataset.place)).toEqual(PLACES.map((p) => p.id));
  for (const button of buttons) await act(async () => button.click());
  expect(go.mock.calls.map(([route]) => route)).toEqual(PLACES.map((p) => ({ kind: "place", place: p.id })));
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
