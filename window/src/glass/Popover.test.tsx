// @vitest-environment jsdom
// A popover that asks to close on scroll closes when the page under it scrolls, and stays open for scrolling inside itself.
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Popover } from "./Popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, anchorHost: HTMLDivElement;
class QuietObserver { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= QuietObserver;
  anchorHost = document.body.appendChild(document.createElement("div"));
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); anchorHost.remove(); });

function mount(onClose: () => void, closeOnScroll: boolean) {
  const anchor = createRef<HTMLElement>();
  const button = anchorHost.appendChild(document.createElement("button"));
  anchor.current = button;
  return act(async () => root.render(<Popover anchor={anchor} label="Agent details" onClose={onClose} closeOnScroll={closeOnScroll}><div className="inner"><span>Row</span></div></Popover>));
}

it("closes when the page scrolls under it", async () => {
  const onClose = vi.fn();
  await mount(onClose, true);
  const page = document.body.appendChild(document.createElement("main"));
  await act(async () => { page.dispatchEvent(new Event("scroll")); });
  expect(onClose).toHaveBeenCalled();
  page.remove();
});

it("stays open for a scroll inside itself", async () => {
  const onClose = vi.fn();
  await mount(onClose, true);
  const inner = document.querySelector<HTMLElement>(".g-popover .inner")!;
  await act(async () => { inner.dispatchEvent(new Event("scroll")); });
  expect(onClose).not.toHaveBeenCalled();
});

it("keeps a popover that did not ask to close on scroll open", async () => {
  const onClose = vi.fn();
  await mount(onClose, false);
  const page = document.body.appendChild(document.createElement("main"));
  await act(async () => { page.dispatchEvent(new Event("scroll")); });
  expect(onClose).not.toHaveBeenCalled();
  page.remove();
});
