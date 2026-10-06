// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CharacterPanel } from "./CharacterPanel";
import { panelLimits, panelPlaceAt, panelPoint, readPanelPlace, savePanelPlace } from "./panel-position";
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
  await act(async () => root.render(<CharacterPanel name="Juniper" state="work" onClose={close} />));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("moves to a chosen corner and remembers it for this computer", async () => {
  const panel = host.querySelector<HTMLElement>(".character-panel")!;
  await act(async () => panel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 400, clientY: 300 })));
  expect(document.querySelector('[role="menu"][aria-label="Move the agent window"]')).not.toBeNull();
  const choice = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((button) => button.textContent === "Top left")!;
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

it("confirms Hide and explains how to bring the agent back", async () => {
  const hide = host.querySelector<HTMLButtonElement>('[aria-label="Hide the agent"]')!;
  await act(async () => hide.click());
  expect(close).toHaveBeenCalledOnce();
  expect(getToasts().at(-1)?.text).toBe("Hidden. Bring it back in Appearance › Agents.");
});
