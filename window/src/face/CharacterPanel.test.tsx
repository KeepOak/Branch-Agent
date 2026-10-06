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

beforeEach(async () => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div"));
  const column = document.createElement("div");
  column.className = "conversation-column";
  column.getBoundingClientRect = () => ({ left: 200, top: 50, right: 1000, bottom: 800, width: 800, height: 750, x: 200, y: 50, toJSON: () => ({}) });
  const composer = document.createElement("div");
  composer.className = "c-wrap";
  composer.getBoundingClientRect = () => ({ left: 200, top: 700, right: 1000, bottom: 800, width: 800, height: 100, x: 200, y: 700, toJSON: () => ({}) });
  column.append(composer);
  document.body.append(column);
  close = vi.fn<() => void>();
  root = createRoot(host);
  await act(async () => root.render(<CharacterPanel name="Juniper" state="work" onClose={close} column={column} />));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("moves to a chosen corner and remembers it for this computer", async () => {
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  await act(async () => panel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 400, clientY: 300 })));
  expect(document.querySelector('[role="menu"][aria-label="Move the agent window"]')).not.toBeNull();
  expect(document.querySelector('[role="menu"] .ph')?.textContent).toBe("Move the agent");
  expect(document.querySelector('[role="menuitemcheckbox"][aria-checked="true"]')?.textContent).toBe("Bottom right");
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

it("reattaches clearance when switching between conversations of the same Trunk", async () => {
  const oldColumn = document.querySelector<HTMLElement>(".conversation-column")!;
  const newColumn = oldColumn.cloneNode(true) as HTMLElement;
  newColumn.getBoundingClientRect = oldColumn.getBoundingClientRect;
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 166 });
  oldColumn.replaceWith(newColumn);
  await act(async () => root.render(<CharacterPanel name="Juniper" state="work" onClose={close} column={newColumn} />));
  expect(host.querySelector(".character-panel")).toBe(panel);
  expect(oldColumn.style.getPropertyValue("--agent-window-clearance")).toBe("");
  expect(newColumn.style.getPropertyValue("--agent-window-clearance")).toBe("190px");
});

it("attaches clearance after starting a new conversation and sending", async () => {
  const column = document.querySelector<HTMLElement>(".conversation-column")!;
  await act(async () => root.render(<CharacterPanel name="Juniper" state="idle" onClose={close} column={null} />));
  expect(column.style.getPropertyValue("--agent-window-clearance")).toBe("");
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 166 });
  await act(async () => root.render(<CharacterPanel name="Juniper" state="work" onClose={close} column={column} />));
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

it("confirms Hide and explains how to bring the agent back", async () => {
  const hide = host.querySelector<HTMLButtonElement>('[aria-label="Hide the agent"]')!;
  await act(async () => hide.click());
  expect(close).toHaveBeenCalledOnce();
  expect(getToasts().at(-1)?.text).toBe("Hidden. Bring it back in Appearance › Agents.");
});
