// @vitest-environment jsdom
// Freedom Mode in the frame (owner item 6): the handles, the widths on screen, the keys, and a drag that commits on release.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Frame } from "./Frame";
import { forgetFreeForTests, FREE_DEFAULT } from "./free-widths";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); forgetFreeForTests();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.assign(HTMLElement.prototype, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true) });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); forgetFreeForTests(); });

const frameWith = async (freeLayout: boolean) => {
  await act(async () => root.render(<Frame navigationKey="one" freeLayout={freeLayout} sidebar={<button>Conversation</button>} topics={<p>Threads</p>}
    main={<p>Empty conversation</p>} header={{ title: "Conversation" }} />));
  return host.querySelector<HTMLElement>(".r1-frame")!;
};
const handle = (edge: "side" | "topics") => host.querySelector<HTMLElement>(`.r1-free-handle[data-edge="${edge}"]`)!;
const saved = () => JSON.parse(localStorage.getItem("branch.r1.free") ?? JSON.stringify(FREE_DEFAULT));
const key = async (node: HTMLElement, init: KeyboardEventInit) => { await act(async () => node.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }))); };

it("draws no handles and keeps the usual grid unless Freedom Mode is on", async () => {
  const frame = await frameWith(false);
  expect(frame.dataset.free).toBe("false");
  expect(host.querySelectorAll(".r1-free-handle")).toHaveLength(0);
  expect(frame.style.gridTemplateColumns).toBe("");
});

it("sizes the sidebar and threads columns from the saved widths, with a handle on each edge", async () => {
  localStorage.setItem("branch.r1.free", JSON.stringify({ ...FREE_DEFAULT, side: 340, topics: 220 }));
  const frame = await frameWith(true);
  expect(frame.dataset.free).toBe("true");
  expect(frame.style.gridTemplateColumns).toContain("340px 220px");
  expect(handle("side").getAttribute("aria-label")).toBe("Resize the sidebar. Drag to any size, double-click for the rail, Alt-drag resizes both.");
  expect(handle("topics").getAttribute("aria-valuenow")).toBe("220");
  expect(frame.dataset.topicTier).toBe("3");
});

it("steps the threads width with the arrow keys on its handle, and saves it", async () => {
  await frameWith(true);
  // The 1024 px test window caps the threads column at 312 px beside a 292 px sidebar.
  await key(handle("topics"), { key: "ArrowRight" });
  expect(saved()).toMatchObject({ topics: 312, last: "topics" });
  await key(handle("topics"), { key: "ArrowLeft" });
  await key(handle("topics"), { key: "ArrowLeft" });
  expect(saved().topics).toBe(152);
});

it("⌘[ and ⌘] shrink and grow the edge touched last, and ⌘\\ collapses both", async () => {
  const frame = await frameWith(true);
  // The sidebar caps at 304 px beside a 300 px threads column in this window.
  await key(handle("side"), { key: "ArrowRight" });
  expect(saved()).toMatchObject({ side: 304, last: "side" });
  await key(frame, { key: "[", metaKey: true });
  expect(saved().side).toBe(224);
  await key(document.body, { key: "\\", metaKey: true });
  expect(saved()).toMatchObject({ sideRail: true, topics: 64 });
  await key(document.body, { key: "\\", metaKey: true });
  expect(saved()).toMatchObject({ sideRail: false, side: 224, topics: 300 });
});

it("Enter on the sidebar handle takes it to the rail and back, and double-click does the same", async () => {
  const frame = await frameWith(true);
  await key(handle("side"), { key: "Enter" });
  expect(frame.dataset.wide).toBe("false");
  expect(saved().sideRail).toBe(true);
  await act(async () => handle("side").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(saved()).toMatchObject({ sideRail: false, side: 292 });
  await act(async () => handle("topics").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(saved().topics).toBe(64);
  expect(host.querySelector(".r1-free-handle.r1-free-open")).toBeNull();
});

it("a drag moves the widths live and commits them only on release", async () => {
  await frameWith(true);
  const node = handle("topics");
  await act(async () => node.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 300, button: 0 })));
  await act(async () => node.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 310, buttons: 1 })));
  expect(host.querySelector<HTMLElement>(".r1-frame")!.style.gridTemplateColumns).toContain("310px");
  expect(saved().topics).toBe(300);
  await act(async () => node.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 310 })));
  expect(saved().topics).toBe(310);
});
