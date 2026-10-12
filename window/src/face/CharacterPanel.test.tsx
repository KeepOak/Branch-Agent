// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CharacterPanel } from "./CharacterPanel";
import { panelLimits, panelPlaceAt, panelPlaceOnResize, panelPoint, readPanelPlace, savePanelPlace } from "./panel-position";
import { getToasts } from "../shell/notify";

vi.mock("./Face", () => ({ Face: ({ label }: { label: string }) => <span>{label}</span> }));
vi.mock("./look-prefs", () => ({ AGENT_SIZE_PX: { s: 72, m: 110, l: 150 }, useLookPrefs: () => ({ agentSize: "m" }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let close: () => void;
let show: () => void;
let openTrunk: () => void;
let changePet: () => void;
class FakeResizeObserver implements ResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  disconnected = false;
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) { this.observed.add(target); }
  unobserve(target: Element) { this.observed.delete(target); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
  trigger(target: Element) {
    expect(this.observed.has(target)).toBe(true);
    this.callback([], this);
  }
}

beforeEach(async () => {
  localStorage.clear();
  // jsdom has no pointer capture; the card captures the pointer while dragging.
  Object.assign(HTMLElement.prototype, { setPointerCapture: () => undefined, releasePointerCapture: () => undefined, hasPointerCapture: () => false });
  FakeResizeObserver.instances = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  host = document.body.appendChild(document.createElement("div"));
  const column = document.createElement("div");
  column.className = "conversation-column";
  column.getBoundingClientRect = () => ({ left: 200, top: 50, right: 1000, bottom: 800, width: 800, height: 750, x: 200, y: 50, toJSON: () => ({}) });
  const header = document.createElement("div");
  header.className = "head-row";
  const composer = document.createElement("div");
  composer.className = "c-wrap";
  composer.getBoundingClientRect = () => ({ left: 200, top: 700, right: 1000, bottom: 800, width: 800, height: 100, x: 200, y: 700, toJSON: () => ({}) });
  column.append(header, composer);
  document.body.append(column);
  close = vi.fn<() => void>();
  show = vi.fn<() => void>();
  openTrunk = vi.fn<() => void>();
  changePet = vi.fn<() => void>();
  root = createRoot(host);
  await act(async () => root.render(<CharacterPanel name="Juniper" state="work" onClose={close} onShow={show} onOpenTrunk={openTrunk} onChangePet={changePet} column={column} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("opens one popover on click with the Trunk's name, Open Trunk, Change pet and Hide", async () => {
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  await act(async () => panel.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 400, clientY: 300, pointerId: 1 })));
  await act(async () => panel.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 400, clientY: 300, pointerId: 1 })));
  const menu = document.querySelector('[role="menu"][aria-label="Juniper options"]');
  expect(menu).not.toBeNull();
  expect(menu?.textContent).toContain("Juniper · Working on it");
  const open = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === "Open Trunk")!;
  await act(async () => open.click());
  expect(openTrunk).toHaveBeenCalledOnce();
});

it("moves to a chosen corner and remembers it for this computer", async () => {
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  await act(async () => panel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 400, clientY: 300 })));
  expect(document.querySelector('[role="menu"][aria-label="Juniper options"]')).not.toBeNull();
  const position = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes("Position"))!;
  await act(async () => position.click());
  expect(document.querySelector('[role="menuitemcheckbox"][aria-checked="true"]')?.textContent).toContain("Bottom right");
  const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')].find((button) => button.textContent === "Top left")!;
  await act(async () => choice.click());
  expect(readPanelPlace()).toEqual({ corner: "top-left" });
  expect(panel.style.left).toBe("218px");
  expect(panel.style.top).toBe("68px");
  await act(async () => panel.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(readPanelPlace()).toEqual({ corner: "bottom-right" });
  expect(getToasts().at(-1)?.text).toBe("Back to the usual place.");
});

it("keeps a dropped position relative to the conversation column and clamps on resize", () => {
  const limits = panelLimits({ left: 200, top: 50, right: 1000, bottom: 800 }, 158, 166, 700);
  expect(limits).toEqual({ left: 218, top: 68, right: 824, bottom: 522 });
  const dropped = panelPlaceAt(400, 300, limits);
  savePanelPlace(dropped);
  expect(panelPoint(readPanelPlace(), limits)).toEqual({ x: 400, y: 300 });
  expect(panelPoint(dropped, panelLimits({ left: 200, top: 50, right: 360, bottom: 250 }, 158, 166, 175))).toEqual({ x: 218, y: 68 });
});

it("anchors a dropped position to its nearest corner on resize", () => {
  const before = { left: 100, top: 100, right: 800, bottom: 700 };
  const after = { left: 100, top: 100, right: 1100, bottom: 900 };
  expect(panelPoint(panelPlaceOnResize(panelPlaceAt(760, 660, before), before, after), after)).toEqual({ x: 1060, y: 860 });
  expect(panelPoint(panelPlaceOnResize(panelPlaceAt(140, 150, before), before, after), after)).toEqual({ x: 140, y: 150 });
});

it("keeps top corners below the conversation header", () => {
  const limits = panelLimits({ left: 0, top: 34, right: 1000, bottom: 800 }, 158, 166, 700, 88);
  expect(panelPoint({ corner: "top-left" }, limits)).toEqual({ x: 18, y: 106 });
  expect(panelPoint({ corner: "top-right" }, limits)).toEqual({ x: 824, y: 106 });
});

it("reserves the agent window's height after the latest message", async () => {
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  const column = document.querySelector<HTMLElement>(".conversation-column")!;
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 166 });
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("190px");
});

it("remeasures sidebar, focus, and composer changes through observed resizes", async () => {
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  const column = document.querySelector<HTMLElement>(".conversation-column")!;
  const header = column.querySelector<HTMLElement>(".head-row")!;
  const composer = column.querySelector<HTMLElement>(".c-wrap")!;
  const observer = FakeResizeObserver.instances[0]!;
  expect(observer.observed).toEqual(new Set([column, panel, composer, header]));
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 166 });
  await act(async () => observer.trigger(panel));
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("190px");
  expect(panel.style.left).toBe("982px");
  expect(panel.style.top).toBe("522px");

  // Hiding the sidebar expands the conversation column.
  column.getBoundingClientRect = () => ({ left: 0, top: 50, right: 1200, bottom: 800, width: 1200, height: 750, x: 0, y: 50, toJSON: () => ({}) });
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 180 });
  await act(async () => observer.trigger(column));
  expect(panel.style.left).toBe("1182px");
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("204px");

  // Focus mode removes the conversation, then restores it.
  column.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
  await act(async () => observer.trigger(column));
  expect(panel.style.visibility).toBe("hidden");
  column.getBoundingClientRect = () => ({ left: 0, top: 50, right: 1200, bottom: 800, width: 1200, height: 750, x: 0, y: 50, toJSON: () => ({}) });
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 192 });
  await act(async () => observer.trigger(column));
  expect(panel.style.visibility).not.toBe("hidden");
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("216px");

  // A taller composer moves the window up, while the panel's new size updates clearance.
  composer.getBoundingClientRect = () => ({ left: 0, top: 600, right: 1200, bottom: 800, width: 1200, height: 200, x: 0, y: 600, toJSON: () => ({}) });
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 200 });
  await act(async () => observer.trigger(composer));
  expect(panel.style.top).toBe("388px");
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("224px");

  const nextColumn = column.cloneNode(true) as HTMLElement;
  nextColumn.getBoundingClientRect = column.getBoundingClientRect;
  nextColumn.querySelector<HTMLElement>(".c-wrap")!.getBoundingClientRect = composer.getBoundingClientRect;
  column.replaceWith(nextColumn);
  await act(async () => root.render(<CharacterPanel name="Juniper" state="work" onClose={close} onShow={show} onOpenTrunk={openTrunk} onChangePet={changePet} column={nextColumn} />));
  expect(observer.disconnected).toBe(true);
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("");
  expect(FakeResizeObserver.instances[1]?.observed).toEqual(new Set([
    nextColumn, panel, nextColumn.querySelector(".c-wrap"), nextColumn.querySelector(".head-row"),
  ]));
  expect(nextColumn.style.getPropertyValue("--agent-window-clearance")).toBe("224px");
});

it("reattaches clearance when switching between conversations of the same Trunk", async () => {
  const oldColumn = document.querySelector<HTMLElement>(".conversation-column")!;
  const newColumn = oldColumn.cloneNode(true) as HTMLElement;
  newColumn.getBoundingClientRect = oldColumn.getBoundingClientRect;
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 166 });
  oldColumn.replaceWith(newColumn);
  await act(async () => root.render(<CharacterPanel name="Juniper" state="work" onClose={close} onShow={show} onOpenTrunk={openTrunk} onChangePet={changePet} column={newColumn} />));
  expect(host.querySelector(".character-panel")).toBe(panel);
  expect(oldColumn.style.getPropertyValue("--agent-window-clearance")).toBe("");
  expect(newColumn.style.getPropertyValue("--agent-window-clearance")).toBe("190px");
});

it("attaches clearance after starting a new conversation and sending", async () => {
  const column = document.querySelector<HTMLElement>(".conversation-column")!;
  await act(async () => root.render(<CharacterPanel name="Juniper" state="idle" onClose={close} onShow={show} onOpenTrunk={openTrunk} onChangePet={changePet} column={null} />));
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("");
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 166 });
  await act(async () => root.render(<CharacterPanel name="Juniper" state="work" onClose={close} onShow={show} onOpenTrunk={openTrunk} onChangePet={changePet} column={column} />));
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("190px");
});

it("hides while the focused pane removes the conversation and restores its column position", async () => {
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  const column = document.querySelector<HTMLElement>(".conversation-column")!;
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("24px");
  column.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) });
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(panel.style.visibility).toBe("hidden");
  column.getBoundingClientRect = () => ({ left: 200, top: 50, right: 1000, bottom: 800, width: 800, height: 750, x: 200, y: 50, toJSON: () => ({}) });
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(panel.style.left).toBe("982px");
  expect(panel.style.visibility).not.toBe("hidden");
});

it("hides with an Undo that brings the character back", async () => {
  const hide = host.querySelector<HTMLButtonElement>('[aria-label="Hide the character"]')!;
  await act(async () => hide.click());
  expect(close).toHaveBeenCalledOnce();
  expect(getToasts().at(-1)?.text).toBe("Hidden. Undo, or bring it back from the header.");
  getToasts().at(-1)?.action?.run();
  expect(show).toHaveBeenCalledOnce();
});
