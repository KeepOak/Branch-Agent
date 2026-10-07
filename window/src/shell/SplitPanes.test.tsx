// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaneDivider, SplitFrame, SplitPanes, type Pane } from "./SplitPanes";
import { readFileSync } from "node:fs";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function mount(panes: Pane[]) {
  const host = document.body.appendChild(document.createElement("div"));
  const style = document.body.appendChild(document.createElement("style"));
  style.textContent = readFileSync("src/shell/split.css", "utf8");
  const pick = vi.fn();
  const close = vi.fn();
  root = createRoot(host);
  await act(async () => root?.render(
    <SplitFrame panes={panes} width={50} onWidth={() => {}} renderPanes={(start, end) => (
      <SplitPanes panes={panes} start={start} end={end} rows={[]} openKey={null}
        request={async () => ({}) as never} onEvent={() => () => {}} trunkName={() => "Trunk"}
        rowName={(key) => key} onOpen={() => {}} onPick={pick} onClose={close} onMenu={() => {}} onSplit={() => {}} />
    )}>Main conversation</SplitFrame>,
  ));
  return { host, close };
}

describe("conversation split direction", () => {
  it("stacks the first Split down below the main conversation", async () => {
    const { host } = await mount([{ key: null, dir: "down" }]);
    const frame = host.querySelector<HTMLElement>(".split")!;
    expect(frame.classList.contains("stacked")).toBe(true);
    expect(getComputedStyle(frame).gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(getComputedStyle(frame).gridTemplateRows).toContain("6px minmax(0, 1fr)");
    expect(frame.querySelector(".split-main")?.textContent).toBe("Main conversation");
    expect(frame.querySelector(".split-side")?.textContent).toContain("Choose a conversation");
    expect(frame.querySelector("[role=separator]")?.getAttribute("aria-orientation")).toBe("horizontal");
  });

  it("keeps Split right side by side and down panes in that column", async () => {
    const { host } = await mount([{ key: null, dir: "right" }, { key: null, dir: "down" }]);
    expect(host.querySelector(".split.stacked")).toBeNull();
    expect(host.querySelector("[role=separator]")?.getAttribute("aria-orientation")).toBe("vertical");
    expect(host.querySelectorAll(".split-col")).toHaveLength(1);
    expect(host.querySelectorAll(".split-col .pane")).toHaveLength(2);
  });

  it("keeps leading down panes with the main column when splitting right afterward", async () => {
    const { host, close } = await mount([{ key: null, dir: "down" }, { key: null, dir: "right" }]);
    expect(host.querySelector(".split > .split-main > .split.stacked")).not.toBeNull();
    expect(host.querySelectorAll("[data-pane]")).toHaveLength(2);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-pane="1"] button')?.click());
    expect(close).toHaveBeenCalledWith(1);
  });

  it("resizes a stacked split using Up and Down rather than Left and Right", async () => {
    const changed = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<PaneDivider width={50} onWidth={changed} down />));
    const separator = host.querySelector<HTMLElement>("[role=separator]")!;
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft"]) {
      await act(async () => separator.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
    }
    expect(changed.mock.calls).toEqual([[45], [55]]);
  });

  it("uses vertical pointer position to resize a stacked split", async () => {
    const changed = vi.fn();
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<PaneDivider width={50} onWidth={changed} down />));
    host.getBoundingClientRect = () => ({ left: 100, top: 200, width: 800, height: 400 }) as DOMRect;
    const separator = host.querySelector<HTMLElement>("[role=separator]")!;
    separator.setPointerCapture = () => {};
    await act(async () => separator.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, bubbles: true })));
    await act(async () => separator.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: 100, clientY: 440 })));
    expect(changed).toHaveBeenLastCalledWith(60);
    await act(async () => separator.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1 })));
  });

  it("resizes the stacked part of a mixed split independently of column width", async () => {
    const { host } = await mount([{ key: null, dir: "down" }, { key: null, dir: "right" }]);
    const separator = host.querySelector<HTMLElement>('[aria-orientation="horizontal"]')!;
    await act(async () => separator.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(separator.getAttribute("aria-valuenow")).toBe("55");
    expect(host.querySelector('[aria-orientation="vertical"]')?.getAttribute("aria-valuenow")).toBe("50");
  });
});
