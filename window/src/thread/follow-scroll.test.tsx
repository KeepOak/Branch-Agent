// @vitest-environment jsdom
// Thread follow-scroll: no per-pixel re-layout, no scrollIntoView per streamed token.
import { act, Profiler, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { Block } from "./model";
import { Thread } from "./Thread";
import * as layoutMod from "./layout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", {
  configurable: true,
  value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
});
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
function stubScrollIntoView() {
  const intoView = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: intoView });
  return intoView;
}

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const engine: WindowEngine = {
  sessionKey: "agent:main:main",
  scopes: [],
  onEvent: () => () => {},
  request: (async (method: string) => {
    if (method === "sessions.list") return { sessions: [] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "session.reactions.list") return { reactions: {} };
    if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
    return {};
  }) as WindowEngine["request"],
};

const history: Block[] = Array.from({ length: 12 }, (_, i) =>
  i % 2 === 0
    ? { kind: "user" as const, key: `u${i}`, text: `Ask about invoice ${i / 2 + 1}`, meta: { timestamp: 1_700_000_000_000 + i * 60_000 } }
    : { kind: "text" as const, key: `t${i}`, text: `The invoice total is ${40 + i}.`, streaming: false, meta: { timestamp: 1_700_000_000_000 + i * 60_000 + 1 } },
);

type ScrollBox = { height: number; client: number; top: number };

function mockScroller(el: HTMLElement, box: ScrollBox): ScrollBox {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => box.height });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => box.client });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => box.top,
    set: (value: number) => {
      box.top = Number(value);
    },
  });
  return box;
}

async function flushFollow() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function fireScroll(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new Event("scroll"));
  });
}

describe("thread follow scroll", () => {
  it("does not re-render the block list until the 450 px threshold flips", async () => {
    const layoutSpy = vi.spyOn(layoutMod, "layout");
    let commits = 0;
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <Profiler id="follow-scroll" onRender={() => { commits += 1; }}>
          <Thread name="Juniper" history={history} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} />
        </Profiler>,
      ),
    );
    await act(async () => {});
    const scroller = container.querySelector<HTMLElement>('[data-testid="thread-scroll"]')!;
    const box = mockScroller(scroller, { height: 2000, client: 400, top: 1550 });
    await fireScroll(scroller);
    const layoutsAfterSettle = layoutSpy.mock.calls.length;
    const commitsAfterSettle = commits;
    expect(container.querySelector(".to-latest")).toBeNull();

    box.top = 1400;
    await fireScroll(scroller);
    box.top = 1200;
    await fireScroll(scroller);
    expect(container.querySelector(".to-latest")).toBeNull();
    expect(layoutSpy.mock.calls.length).toBe(layoutsAfterSettle);
    expect(commits).toBe(commitsAfterSettle);

    box.top = 0;
    await fireScroll(scroller);
    expect(container.querySelector(".to-latest")).not.toBeNull();
    expect(layoutSpy.mock.calls.length).toBe(layoutsAfterSettle);
    expect(commits).toBeGreaterThan(commitsAfterSettle);
  });

  it("shows Scroll to latest past 450 px and that button still scrolls to the end", async () => {
    const intoView = stubScrollIntoView();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(<Thread name="Juniper" history={history} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} />),
    );
    await act(async () => {});
    const scroller = container.querySelector<HTMLElement>('[data-testid="thread-scroll"]')!;
    const box = mockScroller(scroller, { height: 2000, client: 400, top: 0 });
    await fireScroll(scroller);
    const button = container.querySelector<HTMLButtonElement>(".to-latest");
    expect(button).not.toBeNull();
    expect(button?.getAttribute("aria-label")).toBe("Scroll to latest");
    intoView.mockClear();
    await act(async () => button!.click());
    expect(intoView).toHaveBeenCalledWith({ block: "end", behavior: "smooth" });
    expect(box.top).toBe(0);
  });

  it("sets scrollTop to scrollHeight for live tokens at the end and never calls scrollIntoView", async () => {
    const intoView = stubScrollIntoView();
    function Harness({ text }: { text: string }) {
      return (
        <Thread
          name="Juniper"
          history={history}
          live={[{ kind: "text", key: "live", text, streaming: true }]}
          pendingUser={null}
          running
          engine={engine}
          onAnswer={() => {}}
        />
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Harness text="The" />));
    await act(async () => {});
    const scroller = container.querySelector<HTMLElement>('[data-testid="thread-scroll"]')!;
    const box = mockScroller(scroller, { height: 1800, client: 400, top: 1700 });
    await fireScroll(scroller);
    intoView.mockClear();
    box.height = 1900;
    await act(async () => root!.render(<Harness text="The invoice" />));
    await flushFollow();
    expect(box.top).toBe(1900);
    expect(intoView).not.toHaveBeenCalled();
    box.height = 2050;
    await act(async () => root!.render(<Harness text="The invoice is ready." />));
    await flushFollow();
    expect(box.top).toBe(2050);
    expect(intoView).not.toHaveBeenCalled();
  });

  it("does not move the scroll position for a new live token when scrolled up", async () => {
    const intoView = stubScrollIntoView();
    function Harness({ text }: { text: string }) {
      return (
        <Thread
          name="Juniper"
          history={history}
          live={[{ kind: "text", key: "live", text, streaming: true }]}
          pendingUser={null}
          running
          engine={engine}
          onAnswer={() => {}}
        />
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Harness text="The" />));
    await act(async () => {});
    const scroller = container.querySelector<HTMLElement>('[data-testid="thread-scroll"]')!;
    const box = mockScroller(scroller, { height: 2000, client: 400, top: 200 });
    await fireScroll(scroller);
    intoView.mockClear();
    await act(async () => root!.render(<Harness text="The invoice is ready." />));
    await flushFollow();
    expect(box.top).toBe(200);
    expect(intoView).not.toHaveBeenCalled();
  });

  it("jumps to the end when you send your own message", async () => {
    function Harness({ pendingUser }: { pendingUser: string | null }) {
      const [pending, setPending] = useState(pendingUser);
      return (
        <>
          <button type="button" data-testid="send-own" onClick={() => setPending("Please check the invoice")}>
            Send
          </button>
          <Thread name="Juniper" history={history} live={[]} pendingUser={pending} running={false} engine={engine} onAnswer={() => {}} />
        </>
      );
    }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Harness pendingUser={null} />));
    await act(async () => {});
    const scroller = container.querySelector<HTMLElement>('[data-testid="thread-scroll"]')!;
    const box = mockScroller(scroller, { height: 2000, client: 400, top: 100 });
    await fireScroll(scroller);
    expect(box.top).toBe(100);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="send-own"]')!.click());
    await flushFollow();
    expect(box.top).toBe(2000);
  });
});
