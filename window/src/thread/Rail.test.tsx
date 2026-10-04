// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Rail, railTicks } from "./Rail";
import type { Block } from "./model";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const blocks: Block[] = [
  { kind: "user", key: "u1", text: "Find the  Hartwell\ninvoice" },
  { kind: "step", key: "s1", tool: "exec", title: "ls", detail: "", status: "ok" },
  { kind: "text", key: "t1", text: "On it.", streaming: false },
];

it("makes one tick per message: yours short, the Trunk's long, labelled with the words", () => {
  expect(railTicks(blocks)).toEqual([
    { key: "u1", mine: true, label: "Find the Hartwell invoice" },
    { key: "t1", mine: false, label: "On it." },
  ]);
});

function Host({ size }: { size: [number, number] }) {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div className="conversation-column">
      <div ref={scroller} data-size={size.join("x")}>
        <div data-block-key="u1"><p>you</p></div>
        <div data-block-key="t1"><p>reply</p></div>
      </div>
      <Rail scroller={scroller} blocks={blocks} />
    </div>
  );
}

async function mount(size: [number, number]) {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  for (const [prop, i] of [["clientWidth", 0], ["clientHeight", 1]] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get() { return Number((this as HTMLElement).dataset.size?.split("x")[i] ?? 0); } });
  }
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Host size={size} />));
  return container;
}

it("shows on a roomy thread and jumps to the message a tick names", async () => {
  const container = await mount([1100, 600]);
  const ticks = container.querySelectorAll<HTMLButtonElement>(".rail .tick");
  expect([...ticks].map((t) => t.getAttribute("aria-label"))).toEqual(["Find the Hartwell invoice", "On it."]);
  expect(ticks[0]!.className).toContain("me");
  const into = vi.fn();
  (container.querySelector('[data-block-key="t1"] > p') as HTMLElement).scrollIntoView = into;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  await act(async () => ticks[1]!.click());
  expect(into).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
});

it("stays hidden on a narrow thread", async () => {
  const container = await mount([900, 600]);
  expect(container.querySelector(".rail")).toBeNull();
});
