// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Conversation } from "../connect/conversations";
import type { SaplingSession } from "../connect/session";
import { Sidebar, type SidebarProps } from "./Sidebar";
import { SideResizer } from "./Resizer";
import { dragResult, readLayout } from "./use-layout";
import { dropZoneAt, reorderedPins } from "./sidebar-drag";
import { usePinOrder } from "./use-pin-order";

vi.mock("../face/Face", () => ({ Face: ({ size }: { size: number }) => <span className="test-face" style={{ width: size, height: size }} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); localStorage.clear(); });

const row = (key: string, pinned: boolean, unread = false): Conversation => ({
  key, title: key, agentId: key, isMain: false, pinned, archived: false, unread, snoozedUntil: null,
  createdAt: 1, updatedAt: 2, preview: "Owner: latest update", working: false, kind: "trunk",
  system: false, automation: false, totalTokens: 0, contextTokens: 0,
});
const a = row("Oak", true, true), b = row("Elm", true), c = row("Birch", false);
function props(rail = false): SidebarProps {
  return { sections: [{ id: "pinned", label: "Pinned", rows: [a, b] }, { id: "recent", label: "Recent", rows: [c] }],
    openKey: null, currentPlace: null, now: 3, showPreview: false, rowState: () => ({ waiting: false, working: false }),
    trunkName: (id) => id ?? "", personName: "Owner", hasUnread: true,
    filterSlot: null, summary: null, emptyLine: null, search: null, searchResults: null,
    rail, onRailSearch: () => {}, onOpen: () => {}, onNew: () => {}, onMenu: () => {},
    onPin: () => {}, onArchive: () => {}, onMarkAllRead: () => {}, onPerson: () => {}, onSettings: () => {} };
}
async function show(rail = false) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Sidebar {...props(rail)} />));
  return host;
}

describe("contacts layout", () => {
  it("snaps below 200 px to the rail, keeps 200 px full, and drags back out to at least 220 px", () => {
    expect(dragResult(199)).toEqual({ rail: true });
    expect(dragResult(200)).toEqual({ sideW: 220, rail: false });
    expect(dragResult(240)).toEqual({ sideW: 240, rail: false });
    expect(dragResult(68 + 180)).toEqual({ sideW: 248, rail: false });
  });
  it("drags the real resize handle through 320, 240, 200, 199 and out from the rail", async () => {
    const commits: unknown[] = [];
    const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
    const render = async (rail: boolean) => act(async () => root!.render(<SideResizer layout={{ sideW: 320, rail, focus: false }} onLayout={(patch) => commits.push(patch)} onLive={() => {}} />));
    const drag = async (from: number, to: number) => {
      const handle = host.querySelector<HTMLElement>("[role=separator]")!;
      Object.defineProperty(handle, "setPointerCapture", { value: () => {}, configurable: true });
      for (const [type, x] of [["pointerdown", from], ["pointermove", to], ["pointerup", to]] as const) {
        await act(async () => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: x, button: 0 })));
      }
    };
    await render(false);
    for (const width of [320, 240, 200, 199]) await drag(320, width);
    expect(commits).toEqual([
      { sideW: 320, rail: false }, { sideW: 240, rail: false },
      { sideW: 220, rail: false }, { rail: true },
    ]);
    await render(true);
    await drag(68, 320);
    expect(commits.at(-1)).toEqual({ sideW: 320, rail: false });
  });
  it("reload keeps both the saved full width and rail state", () => {
    const originalMatchMedia = globalThis.matchMedia;
    globalThis.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof matchMedia;
    expect(readLayout()).toMatchObject({ rail: true });
    localStorage.setItem("branch.layout", JSON.stringify({ sideW: 320, rail: false }));
    expect(readLayout()).toMatchObject({ sideW: 320, rail: false });
    localStorage.setItem("branch.layout", JSON.stringify({ sideW: 320, rail: true }));
    expect(readLayout()).toMatchObject({ sideW: 320, rail: true });
    globalThis.matchMedia = originalMatchMedia;
  });
  it("shows pinned tiles and two-line contact rows without losing the scroll or selection on redraw", async () => {
    const host = await show();
    const scroll = host.querySelector<HTMLElement>(".side-scroll")!;
    scroll.scrollTop = 80;
    expect(host.querySelectorAll(".pin-tile")).toHaveLength(2);
    expect(host.querySelector('[aria-label="Places"]')).toBeNull();
    expect(host.querySelector(".pin-tile .test-face")?.getAttribute("style")).toContain("width: 60px");
    expect(host.querySelector('[data-key="Birch"] .row-preview')?.textContent).toBe("Owner: latest update");
    const p = props(); p.openKey = "Birch";
    await act(async () => root!.render(<Sidebar {...p} />));
    expect(host.querySelector<HTMLElement>(".side-scroll")?.scrollTop).toBe(80);
    expect(host.querySelector('[data-key="Birch"] .row-open')?.getAttribute("aria-current")).toBe("true");
  });
  it("keeps face sizing and unread marks in full tiles, full rows, and the rail", async () => {
    const host = await show();
    expect(host.querySelector(".pin-unread")).not.toBeNull();
    expect(host.querySelector('[data-key="Birch"] .test-face')?.getAttribute("style")).toContain("width: 40px");
    await act(async () => root!.render(<Sidebar {...props(true)} />));
    expect(host.querySelectorAll(".pin-tile")).toHaveLength(0);
    expect(host.querySelector('[data-key="Oak"] .rail-unread')).not.toBeNull();
    expect(host.querySelector('[data-key="Oak"] .row-open')?.getAttribute("title")).toBe("Oak");
    expect(host.querySelector('[data-key="Oak"] .test-face')?.getAttribute("style")).toContain("width: 40px");
  });
  it("reorders Pinned at either edge and reloads the per-person engine preference", async () => {
    expect(reorderedPins(["Oak", "Elm", "Ash"], "Ash", "Oak", "before")).toEqual(["Ash", "Oak", "Elm"]);
    expect(reorderedPins(["Oak", "Elm", "Ash"], "Oak", "Elm", "after")).toEqual(["Elm", "Oak", "Ash"]);
    const prefs: Record<string, unknown> = {};
    const request = vi.fn(async (method: string, params?: { keys?: string[]; entries?: Record<string, unknown> }) => {
      if (method === "users.prefs.get") return { status: "ok", entries: { ...prefs } };
      if (method === "users.prefs.set") { Object.assign(prefs, params?.entries); return { status: "ok" }; }
      return {};
    });
    const engine = { request, onGatewayEvent: () => () => {} } as unknown as SaplingSession;
    let pin: ReturnType<typeof usePinOrder>;
    function Probe() { pin = usePinOrder(engine, true); return <span>{pin.order.join(",")}</span>; }
    const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
    await act(async () => root!.render(<Probe />));
    await act(async () => pin!.move({ source: "Elm", target: "Oak", zone: "before" }, ["Oak", "Elm"]));
    expect(host.textContent).toBe("Elm,Oak");
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { "ui.window.contactPinOrder": ["Elm", "Oak"] } });
    await act(async () => root!.unmount()); root = createRoot(host);
    await act(async () => root!.render(<Probe />));
    expect(host.textContent).toBe("Elm,Oak");
  });
  it("divides vertical or horizontal contact targets into before, onto and after zones", () => {
    const zones = ["before", "onto", "after"] as const;
    expect(dropZoneAt(105, 100, 90, zones)).toBe("before");
    expect(dropZoneAt(145, 100, 90, zones)).toBe("onto");
    expect(dropZoneAt(185, 100, 90, zones)).toBe("after");
    expect(dropZoneAt(145, 100, 90, ["before", "after"])).toBe("after");
  });
  it("captures a started pin drag and clears it when a new pointerdown is not on a pin", async () => {
    const open = vi.fn();
    const p = props(); p.onOpen = open;
    const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
    await act(async () => root!.render(<Sidebar {...p} />));
    const side = host.querySelector<HTMLElement>(".side")!;
    const pin = host.querySelector<HTMLElement>(".pin-open")!;
    const recent = host.querySelector<HTMLElement>('[data-key="Birch"] .row-open')!;
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => pin });
    const capture = vi.fn();
    Object.defineProperty(side, "setPointerCapture", { value: capture });
    Object.defineProperty(side, "hasPointerCapture", { value: () => false });
    const pointer = async (el: Element, type: string, x: number) => act(async () => {
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, clientX: x }));
    });
    await pointer(pin, "pointerdown", 10);
    await pointer(pin, "pointermove", 20);
    expect(capture).toHaveBeenCalledWith(1);
    await pointer(recent, "pointerdown", 20);
    await pointer(recent, "pointerup", 20);
    await act(async () => recent.click());
    expect(open).toHaveBeenCalledWith("Birch");
  });
});
