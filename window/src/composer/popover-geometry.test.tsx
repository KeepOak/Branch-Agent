// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Popover } from "./Popover";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(width: number, anchorTop: number, menuHeight: number) {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", 860);
  const host = document.createElement("div");
  host.getBoundingClientRect = () => ({ left: 40, top: 300, right: width - 40 } as DOMRect);
  const anchor = document.createElement("button");
  anchor.getBoundingClientRect = () => ({ left: 60, right: 100, top: anchorTop, bottom: anchorTop + 30 } as DOMRect);
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(host);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(menuHeight);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(width <= 480 ? width - 16 : 340);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Popover anchor={{ current: anchor }} label="Menu" align="right" onClose={() => {}}><button>Choice</button></Popover>));
  return container.querySelector<HTMLElement>('[role="dialog"][aria-label="Menu"]')!;
}

it("expands narrow menus to the 8px viewport edge and opens above a low anchor", async () => {
  const menu = await mount(400, 760, 460);
  expect(menu.style.left).toBe("-32px");
  expect(menu.style.top).toBe("-6px"); // viewport294, translated by composer host300
  expect(menu.style.right).toBe("");
});

it("clamps a narrow menu inside the viewport when neither anchor side fits", async () => {
  const menu = await mount(400, 430, 460);
  expect(menu.style.top).toBe("92px"); // viewport392 leaves the8px bottom margin
});

it("preserves desktop right alignment and composer bottom positioning", async () => {
  const menu = await mount(1440, 760, 460);
  expect(menu.style.right).toBe("1300px");
  expect(menu.style.top).toBe("");
  expect(menu.style.left).toBe("");
});
