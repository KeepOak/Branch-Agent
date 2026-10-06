// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { SideResizer } from "./Resizer";
import type { Layout } from "./use-layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function mountResizer() {
  const committed: Array<Partial<Layout>> = [];
  const live: Array<number | null> = [];
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(
    <SideResizer layout={{ sideW: 292, rail: false, focus: false }}
      onLayout={(patch) => committed.push(patch)} onLive={(width) => live.push(width)} />,
  ));
  const separator = host.querySelector<HTMLElement>("[role=separator]")!;
  // jsdom has PointerEvent but no pointer-capture routing. Only that platform
  // primitive is supplied; React handlers and all state changes remain real.
  Object.defineProperty(separator, "setPointerCapture", { value: () => {} });
  return { separator, committed, live };
}

async function pointer(separator: HTMLElement, type: string, clientX: number) {
  await act(async () => separator.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 1, clientX, buttons: type === "pointerup" ? 0 : 1,
  })));
}

describe("sidebar resize cancellation", () => {
  it.each(["pointercancel", "lostpointercapture"])("clears an interrupted %s without saving the live width", async (type) => {
    const { separator, committed, live } = await mountResizer();
    await pointer(separator, "pointerdown", 292);
    await pointer(separator, "pointermove", 322);
    expect(live.at(-1)).toBe(322);
    expect(separator.classList.contains("on")).toBe(true);
    await pointer(separator, type, 322);
    expect(separator.classList.contains("on")).toBe(false);
    expect(live.at(-1)).toBeNull();
    await pointer(separator, "pointermove", 350);
    await pointer(separator, "pointerup", 350);
    expect(live.at(-1)).toBeNull();
    expect(committed).toEqual([]);
  });

  it.each(["pointercancel", "lostpointercapture"])("ignores movement and pointer-up in the same event turn after %s", async (type) => {
    const { separator, committed, live } = await mountResizer();
    await pointer(separator, "pointerdown", 292);
    await pointer(separator, "pointermove", 320);
    await act(async () => {
      separator.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 320 }));
      separator.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 350 }));
      separator.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 350 }));
    });
    expect(committed).toEqual([]);
    expect(live.at(-1)).toBeNull();
    expect(separator.classList.contains("on")).toBe(false);
  });

  it("keeps a completed user width when capture is released afterward", async () => {
    const { separator, committed, live } = await mountResizer();
    await pointer(separator, "pointerdown", 292);
    await pointer(separator, "pointermove", 330);
    await pointer(separator, "pointerup", 330);
    await pointer(separator, "lostpointercapture", 330);
    expect(committed).toEqual([{ sideW: 330, rail: false }]);
    expect(live.at(-1)).toBeNull();
    expect(separator.classList.contains("on")).toBe(false);
  });

  it.each([
    { width: 30, patch: { rail: true } },
    { width: 80, patch: { rail: true } },
    { width: 2000, patch: { sideW: 640, rail: false } },
  ])("retains the rail and width bounds at $width", async ({ width, patch }) => {
    const { separator, committed } = await mountResizer();
    await pointer(separator, "pointerdown", 292);
    await pointer(separator, "pointerup", width);
    expect(committed).toEqual([patch]);
  });
});
