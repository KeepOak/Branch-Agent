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
  { kind: "user", key: "u2", text: "Show the invoice" },
  { kind: "text", key: "t2", text: "Here it is.", streaming: false },
  { kind: "text", key: "t2b", text: "The total is $42.", streaming: false },
  { kind: "user", key: "u3", text: "Check the due date" },
  { kind: "approval", key: "a3", approval: { id: "a3", state: "pending" } } as Block,
  { kind: "text", key: "t3", text: "Due Friday.", streaming: false },
  { kind: "user", key: "u4", text: "Thanks" },
  { kind: "text", key: "t4", text: "You're welcome.", streaming: false },
];

it("makes one tick per user turn, even with multiple text blocks", () => {
  expect(railTicks(blocks).map(({ key, mine, label, body, needs }) => ({ key, mine, label, body, needs }))).toEqual([
    { key: "u1", mine: true, label: "Find the Hartwell invoice", body: "On it.", needs: false },
    { key: "u2", mine: true, label: "Show the invoice", body: "Here it is.", needs: false },
    { key: "u3", mine: true, label: "Check the due date", body: "Due Friday.", needs: true },
    { key: "u4", mine: true, label: "Thanks", body: "You're welcome.", needs: false },
  ]);
});

function Host({ size }: { size: [number, number] }) {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <div className="conversation-column">
      <div ref={scroller} data-size={size.join("x")}>
        <div data-block-key="u1"><p>you</p></div>
        <div data-block-key="u2"><p>you</p></div>
        <div data-block-key="u3"><p>you</p></div>
        <div data-block-key="u4"><p>you</p></div>
      </div>
      <Rail scroller={scroller} blocks={blocks} sessionKey="test" />
    </div>
  );
}

async function mount(size: [number, number], width = 1600) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
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
  expect([...ticks].map((t) => t.getAttribute("aria-label"))).toEqual(["Find the Hartwell invoice", "Show the invoice", "Check the due date", "Thanks"]);
  expect(ticks[0]!.className).toContain("me");
  const into = vi.fn();
  (container.querySelector('[data-block-key="u2"] > p') as HTMLElement).scrollIntoView = into;
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  await act(async () => ticks[1]!.click());
  expect(into).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
});

it("stays hidden on a phone viewport", async () => {
  const container = await mount([500, 600], 500);
  expect(container.querySelector(".rail")).toBeNull();
});

it("stays hidden when a wide viewport leaves a narrow chat pane", async () => {
  const container = await mount([380, 600], 1280);
  expect(container.querySelector(".rail")).toBeNull();
});

it("renders the rail without ResizeObserver", async () => {
  const container = await mount([1000, 600]);
  vi.stubGlobal("ResizeObserver", undefined);
  await act(async () => root!.render(<Host size={[1000, 600]} />));
  expect(container.querySelectorAll(".rail .tick")).toHaveLength(4);
});

it.each([1600, 1280, 900, 700, 500])("responsive turn rail at %i px", async (width) => {
  const container = await mount([width - 300, 600], width);
  expect(container.querySelectorAll(".rail .tick")).toHaveLength(width - 300 > 760 ? 4 : 0);
});

it("previews and bookmarks a real turn, then restores it from storage", async () => {
  const container = await mount([1000, 600]);
  const first = container.querySelector<HTMLButtonElement>(".rail .tick")!;
  await act(async () => first.focus());
  expect(container.querySelector(".turn-preview")?.textContent).toContain("Find the  Hartwell");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Bookmark this turn"]')!.click());
  expect(first.className).toContain("bookmarked");
  expect(JSON.parse(localStorage.getItem("branch:turn-bookmarks:test") ?? "[]")).toContain("u1");
});

it("jumps by listbox Enter and Alt+Down from elsewhere in the chat", async () => {
  const container = await mount([1000, 600]);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const first = container.querySelector<HTMLElement>('[data-block-key="u1"] > p')!;
  const next = container.querySelector<HTMLElement>('[data-block-key="u2"] > p')!;
  first.scrollIntoView = vi.fn();
  next.scrollIntoView = vi.fn();
  first.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
  next.getBoundingClientRect = () => ({ top: 200 } as DOMRect);
  const rail = container.querySelector<HTMLElement>(".rail")!;
  await act(async () => rail.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(first.scrollIntoView).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true })));
  expect(next.scrollIntoView).toHaveBeenCalledOnce();
});
