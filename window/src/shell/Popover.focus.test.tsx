// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Popover } from "./Popover";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const at = { x: 20, y: 20 };
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Popover focus", () => {
  it("focuses its first control once, without scrolling, and not again when the parent re-renders", async () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const body = (onClose: () => void) => (
      <Popover at={at} label="Every account" onClose={onClose}>
        <button type="button">Check every account now</button>
        <button type="button">Accounts and usage</button>
      </Popover>
    );
    await act(async () => root?.render(body(() => {})));
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.calls[0]?.[0]).toEqual({ preventScroll: true });
    // A parent that rebuilds its onClose each render (WindowShell does) must not move focus or scroll again.
    await act(async () => root?.render(body(() => {})));
    await act(async () => root?.render(body(() => {})));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("closes through the latest onClose when a pointer goes outside", async () => {
    const first = vi.fn();
    const latest = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Popover at={at} label="Every account" onClose={first}><button type="button">Check</button></Popover>));
    await act(async () => root?.render(<Popover at={at} label="Every account" onClose={latest}><button type="button">Check</button></Popover>));
    await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
});
