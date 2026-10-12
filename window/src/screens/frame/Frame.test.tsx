// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Frame } from "./Frame";
import { Popover } from "../../glass/Popover";
import { updateEdges } from "../../glass/useEdgeFade";
import { place } from "../../glass/place";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
let narrow = false;
beforeEach(() => {
  localStorage.clear(); narrow = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: narrow, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const click = async (label: string) => { await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()); };
const render = async (key = "one") => { await act(async () => root.render(<Frame navigationKey={key} sidebar={<button>Conversation</button>} main={<p>Empty conversation</p>} header={{ title: "Conversation" }} />)); };

it("persists wide/rail choice and uses one Ctrl+B handler", async () => {
  await render();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: true, bubbles: true, cancelable: true })));
  expect(host.querySelector('.r1-frame')?.getAttribute("data-wide")).toBe("false");
  expect(localStorage.getItem("branch.r1.sidebar")).toBe("rail");
  await click("Expand sidebar");
  expect(localStorage.getItem("branch.r1.sidebar")).toBe("wide");
});
it("opens a mobile drawer, restores focus on Escape and closes on navigation", async () => {
  narrow = true; await render();
  const opener = host.querySelector<HTMLButtonElement>('[aria-label="Toggle sidebar"]')!; opener.focus();
  await click("Toggle sidebar");
  expect(host.querySelector('aside')?.getAttribute("aria-modal")).toBe("true");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Close sidebar");
  expect(document.activeElement?.innerHTML).toBe(opener.innerHTML);
  expect(opener.querySelector("svg")).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(opener);
  expect(host.querySelector('.r1-frame')?.getAttribute("data-drawer")).toBe("false");
  await click("Toggle sidebar"); await render("two");
  expect(host.querySelector('.r1-frame')?.getAttribute("data-drawer")).toBe("false");
  expect(localStorage.getItem("branch.r1.sidebar")).toBeNull();
});
it("renders as a wide frame when the host has no matchMedia or ResizeObserver", async () => {
  vi.stubGlobal("matchMedia", undefined); vi.stubGlobal("ResizeObserver", undefined);
  await render();
  expect(host.querySelector('.r1-frame')?.getAttribute("data-wide")).toBe("true");
  expect(host.querySelector('aside')?.getAttribute("role")).toBeNull();
  expect(host.querySelector('[aria-label="Use sidebar rail"]')).not.toBeNull();
  expect(host.textContent).toContain("Empty conversation");
});
it("one Escape closes only the top popover, not the drawer", async () => {
  narrow = true;
  const anchor = createRef<HTMLButtonElement>(); const closed = vi.fn();
  await act(async () => root.render(<Frame sidebar={<button ref={anchor}>Anchor</button>} main={<p>Empty</p>} header={{ title: "Conversation" }} />));
  await click("Toggle sidebar");
  await act(async () => root.render(<Frame sidebar={<><button ref={anchor}>Anchor</button><Popover anchor={anchor} label="Details" onClose={closed}><button>Detail</button></Popover></>} main={<p>Empty</p>} header={{ title: "Conversation" }} />));
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(closed).toHaveBeenCalledOnce();
  expect(host.querySelector('.r1-frame')?.getAttribute("data-drawer")).toBe("true");
});
it("unwired controls expose Coming reasons and cannot invoke actions", async () => {
  await render();
  const controls = [...host.querySelectorAll<HTMLButtonElement>('.r1-header-right button')];
  expect(controls).toHaveLength(3);
  for (const control of controls) { expect(control.disabled).toBe(true); expect(control.title).toMatch(/^Coming · /); expect(control.getAttribute('aria-label')).toContain('Coming'); }
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(true);
});
it("isolates a failed region and offers a real retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  let broken = true;
  function Content() { if (broken) throw new Error("Test failure"); return <p>Recovered</p>; }
  await act(async () => root.render(<Frame sidebar={<button>Sidebar survives</button>} main={<Content />} header={{ title: "Conversation" }} />));
  expect(host.textContent).toContain("This part didn’t load"); expect(host.textContent).toContain("Sidebar survives");
  broken = false;
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === "Try again")!.click());
  expect(host.textContent).toContain("Recovered");
});
it("fades only hidden content and clears both edges at rest", () => {
  const node = document.createElement("div");
  Object.defineProperties(node, { clientHeight: { value: 100 }, scrollHeight: { value: 300 }, scrollTop: { value: 0, writable: true } });
  updateEdges(node); expect(node.hasAttribute("data-top")).toBe(false); expect(node.hasAttribute("data-bot")).toBe(true);
  node.scrollTop = 50; updateEdges(node); expect(node.hasAttribute("data-top")).toBe(true); expect(node.hasAttribute("data-bot")).toBe(true);
  node.scrollTop = 200; updateEdges(node); expect(node.hasAttribute("data-bot")).toBe(false);
});
it.each([390, 768, 1440])("clamps tall popovers within a %i viewport", width => {
  const positioned = place({ left: width - 30, right: width - 8, top: 700, bottom: 736 }, { w: 340, h: 2000 }, width, 844, { align: "end", prefer: "above" });
  expect(positioned.left).toBeGreaterThanOrEqual(8); expect(positioned.left + positioned.width).toBeLessThanOrEqual(width - 8);
  expect(positioned.top).toBeGreaterThanOrEqual(8); expect(positioned.top + positioned.maxHeight).toBeLessThanOrEqual(836);
  if (width === 390) expect(positioned.width).toBe(374);
});
