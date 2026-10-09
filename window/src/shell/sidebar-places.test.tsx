// @vitest-environment jsdom
// UI audit DA-01 / DA-62: the places get a "Places" section in the sidebar (Inbox first, with its "Needs you" badge),
// Grove is one of them, and Find anything lists the same places.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaceId } from "../places-nav/routes";
import { paletteRows } from "./palette-rows";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../face/Face", () => ({ Face: ({ size }: { size: number }) => <span className="test-face" style={{ width: size, height: size }} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); });

function props(over: Partial<SidebarProps> = {}): SidebarProps {
  return { sections: [], openKey: null, currentPlace: null, now: 3, showPreview: false, rowState: () => ({ waiting: false, working: false }),
    trunkName: (id) => id ?? "", personName: "Owner", hasUnread: false, filterSlot: null, summary: null, emptyLine: null, search: null, searchResults: null,
    rail: false, onRailSearch: () => {}, onOpen: () => {}, onNew: () => {}, onMenu: () => {}, onPin: () => {}, onArchive: () => {},
    onMarkAllRead: () => {}, onPerson: () => {}, onSettings: () => {}, ...over };
}
async function show(over: Partial<SidebarProps> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Sidebar {...props(over)} />));
  return host;
}
const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("nav[aria-label=Places] .nav")];

describe("sidebar Places section (DA-01)", () => {
  it("lists every place, Inbox first and Grove last, with Inbox's Needs you badge", async () => {
    const host = await show({ onPlace: vi.fn(), inboxCount: 3, currentPlace: "library" });
    expect(rows(host).map((b) => b.querySelector(".nav-name")?.textContent)).toEqual(["Inbox", "Automations", "Library", "People", "Customize", "Overview", "Canopy", "Grove"]);
    const inbox = host.querySelector<HTMLButtonElement>("[data-testid=place-inbox]")!;
    expect(inbox.querySelector(".cnt.attn")?.textContent).toBe("3");
    expect(inbox.getAttribute("aria-label")).toBe("Inbox, 3 need you");
    expect(host.querySelectorAll(".places .cnt").length).toBe(1);
    expect(host.querySelector("[data-testid=place-library]")?.getAttribute("aria-current")).toBe("page");
    expect(rows(host).filter((b) => b.getAttribute("aria-current")).length).toBe(1);
  });

  it("shows no badge when nothing needs you", async () => {
    const host = await show({ onPlace: vi.fn(), inboxCount: 0 });
    expect(host.querySelector(".places .cnt")).toBeNull();
    expect(host.querySelector("[data-testid=place-inbox]")?.getAttribute("aria-label")).toBe("Inbox");
  });

  it("opens the place a row names, Grove included (DA-62)", async () => {
    const onPlace = vi.fn<(place: PlaceId) => void>();
    const host = await show({ onPlace });
    for (const b of rows(host)) await act(async () => b.click());
    expect(onPlace.mock.calls.map(([id]) => id)).toEqual(["inbox", "automations", "library", "people", "customize", "overview", "canopy", "office"]);
  });

  it("folds under its header and remembers the fold", async () => {
    let host = await show({ onPlace: vi.fn() });
    const header = host.querySelector<HTMLButtonElement>(".places-h")!;
    expect(header.getAttribute("aria-expanded")).toBe("true");
    await act(async () => header.click());
    expect(rows(host)).toHaveLength(0);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root!.unmount()); root = undefined; document.body.replaceChildren();
    host = await show({ onPlace: vi.fn() });
    expect(rows(host)).toHaveLength(0);
  });

  it("keeps icon rows with tooltips in the rail, with no header", async () => {
    localStorage.setItem("branch.placesFolded", "1");
    const host = await show({ onPlace: vi.fn(), inboxCount: 2, rail: true });
    expect(host.querySelector(".places-h")).toBeNull();
    expect(rows(host)).toHaveLength(8);
    expect(host.querySelector("[data-testid=place-office]")?.getAttribute("title")).toBe("Grove");
    expect(host.querySelector("[data-testid=place-inbox]")?.getAttribute("title")).toBe("Inbox, 2 need you");
  });
});

describe("Find anything Places (DA-62)", () => {
  it("lists the same places as the sidebar, and Grove opens the office route", () => {
    const openPlace = vi.fn<(place: PlaceId) => void>();
    const noop = () => undefined;
    const list = paletteRows({ conversations: [], trunks: [], trunkName: () => "", newConversation: noop, toggleTheme: noop, focusMode: noop,
      shortcuts: noop, setup: noop, tour: noop, quickAsk: noop, openConversation: noop, openPlace, openSettings: noop, newTrunk: noop });
    const places = list.filter((row) => row.group === "Places");
    expect(places.map((row) => row.label)).toEqual(["Inbox", "Automations", "Library", "People", "Customize", "Overview", "Canopy", "Grove"]);
    places.find((row) => row.label === "Grove")?.run();
    expect(openPlace).toHaveBeenCalledWith("office");
  });
});
