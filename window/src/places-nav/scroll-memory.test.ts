// @vitest-environment jsdom
import { act, createElement, useEffect, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { PlaceFrame } from "./PlaceFrame";
import { resetScrollMemoryForTests, useScrollMemory } from "./scroll-memory";
import { Thread } from "../thread/Thread";
import type { Block } from "../thread/model";
import { LibraryPlace } from "../places/library";
import { CanopyPlace } from "../places/canopy";

vi.mock("../face/Face", () => ({ Face: ({ label }: { label?: string }) => createElement("span", { "data-face": label }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });

const placeA = { kind: "place" as const, place: "library" as const };
const placeB = { kind: "place" as const, place: "inbox" as const };
const chatA = { kind: "chat" as const, key: "agent:main:main" };
const chatB = { kind: "chat" as const, key: "agent:main:other" };

type Metrics = { top: number; height: number; view: number };
const sizes = new WeakMap<HTMLElement, Metrics>();
const proto = {
  clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight"),
  scrollHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"),
  scrollTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop"),
};

function metricsOf(el: HTMLElement): Metrics {
  let row = sizes.get(el);
  if (!row) {
    row = { top: 0, height: 2000, view: 400 };
    sizes.set(el, row);
  }
  return row;
}

function contentHeight(el: HTMLElement): number {
  let fromKids = 0;
  for (const child of el.children) {
    const row = sizes.get(child as HTMLElement);
    if (row) fromKids += row.height;
  }
  return fromKids > 0 ? fromKids : metricsOf(el).height;
}

function installScrollMetrics(): void {
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return metricsOf(this as HTMLElement).view; } });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get() { return contentHeight(this as HTMLElement); } });
  Object.defineProperty(HTMLElement.prototype, "scrollTop", {
    configurable: true,
    get() { return metricsOf(this as HTMLElement).top; },
    set(value: number) {
      const row = metricsOf(this as HTMLElement);
      const height = contentHeight(this as HTMLElement);
      row.top = Math.max(0, Math.min(Number(value), Math.max(0, height - row.view)));
    },
  });
}

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  resetScrollMemoryForTests();
  installScrollMetrics();
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  host = undefined;
  document.body.innerHTML = "";
  resetScrollMemoryForTests();
  if (proto.clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", proto.clientHeight);
  if (proto.scrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", proto.scrollHeight);
  if (proto.scrollTop) Object.defineProperty(HTMLElement.prototype, "scrollTop", proto.scrollTop);
});

function push(index: number, route: unknown): void {
  history.pushState({ branchIndex: index, branchRoute: route }, "");
}

function popTo(index: number, route: unknown): void {
  const state = { branchIndex: index, branchRoute: route };
  history.replaceState(state, "");
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

async function flushFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function waitMs(ms: number): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    });
  });
}

async function saveScroll(el: HTMLElement, y: number): Promise<void> {
  el.scrollTop = y;
  el.dispatchEvent(new Event("scroll"));
  await flushFrame();
}

async function mount(node: ReactNode): Promise<HTMLElement> {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  return host;
}

async function remount(node: ReactNode): Promise<HTMLElement> {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  host?.remove();
  return mount(node);
}

function placeNode(inner?: number): ReactNode {
  return createElement(PlaceFrame, { title: "Library", lede: "Your files and memories." }, createElement("div", {
    "data-tall": true,
    ref: (el: HTMLDivElement | null) => {
      if (!el || inner == null) return;
      const place = el.closest(".place-scroll")?.firstElementChild;
      if (place instanceof HTMLElement) metricsOf(place).height = inner;
    },
  }));
}

function FollowChat({ signature, sent, inner }: { signature: string; sent: readonly (string | null | undefined)[]; inner?: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const lastSent = useRef(sent);
  const sentKey = sent.join("\u0000");
  useScrollMemory(scroller, { atEnd });
  useEffect(() => {
    const before = lastSent.current;
    lastSent.current = sent;
    if (sent.some((value, i) => value && value !== before[i])) atEnd.current = true;
  }, [sent, sentKey]);
  useEffect(() => {
    if (!atEnd.current) return;
    const id = requestAnimationFrame(() => {
      const el = scroller.current;
      if (atEnd.current && el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [signature, sentKey]);
  return createElement("div", {
    ref: scroller,
    className: "scroll",
    "data-testid": "thread-scroll",
    onScroll: () => {
      const el = scroller.current;
      if (!el) return;
      atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    },
  }, createElement("div", {
    className: "thread-end",
    ref: (el: HTMLDivElement | null) => {
      if (el && inner != null) metricsOf(el).height = inner;
    },
  }));
}

const engine: WindowEngine = {
  sessionKey: "agent:main:main",
  scopes: [],
  onEvent: () => () => {},
  request: (async (method: string) => {
    if (method === "sessions.list") return { sessions: [] };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "session.reactions.list") return { reactions: {} };
    if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return { items: [] };
    if (method === "agents.list") return { agents: [], defaultId: "" };
    if (method === "cron.list") return { jobs: [], hasMore: false };
    if (method === "cron.runs") return { entries: [], hasMore: false };
    if (method === "canopy.cards.list") return { cards: [], boards: [] };
    if (method === "node.list") return { nodes: [] };
    if (method === "computer.status") return { configured: false };
    if (method === "canopy.notifications.list") return { subscriptions: [] };
    return {};
  }) as WindowEngine["request"],
};

const placeProps = {
  engine,
  facts: { running: 0, waiting: 0 },
  openConversation: () => {},
  openPlace: () => {},
  openSettings: () => {},
  level: "regular" as const,
};

const historyBlocks: Block[] = [
  { kind: "user", key: "u1", text: "First" },
  { kind: "text", key: "a1", text: "Reply one", streaming: false },
  { kind: "user", key: "u2", text: "Second" },
  { kind: "text", key: "a2", text: "Reply two", streaming: false },
];

function threadNode(live: Block[] = []): ReactNode {
  return createElement(Thread, { name: "Juniper", history: historyBlocks, live, pendingUser: null, running: live.length > 0, engine, onAnswer: () => {} });
}

describe("place scroll memory", () => {
  it("restores a place to 600 after Back, including late 160 and 420 ms content", async () => {
    push(1, placeA);
    const first = await mount(placeNode());
    const scroller = first.querySelector<HTMLElement>(".place-scroll")!;
    await saveScroll(scroller, 600);
    expect(scroller.scrollTop).toBe(600);
    push(2, placeB);
    await remount(placeNode());
    popTo(1, placeA);
    const again = await remount(placeNode(400));
    const late = again.querySelector<HTMLElement>(".place-scroll")!;
    await flushFrame();
    expect(late.scrollTop).toBe(0);
    await waitMs(170);
    expect(late.scrollTop).toBe(0);
    metricsOf(late.firstElementChild as HTMLElement).height = 2000;
    await waitMs(270);
    expect(late.scrollTop).toBe(600);
  });

  it("a fresh push to A, not a popstate, starts at 0", async () => {
    push(1, placeA);
    const first = await mount(placeNode());
    await saveScroll(first.querySelector<HTMLElement>(".place-scroll")!, 600);
    push(2, placeB);
    await remount(placeNode());
    push(3, placeA);
    const fresh = await remount(placeNode());
    const scroller = fresh.querySelector<HTMLElement>(".place-scroll")!;
    await flushFrame();
    await waitMs(430);
    expect(scroller.scrollTop).toBe(0);
  });

  it("Library and Canopy restore their own .place-scroll after Back", async () => {
    for (const [name, node] of [
      ["Library", createElement(LibraryPlace, placeProps)],
      ["Canopy", createElement(CanopyPlace, placeProps)],
    ] as const) {
      resetScrollMemoryForTests();
      push(1, { kind: "place" as const, place: name === "Library" ? "library" : "canopy" });
      const first = await remount(node);
      const scroller = first.querySelector<HTMLElement>(".place-scroll")!;
      expect(scroller, name).toBeTruthy();
      await saveScroll(scroller, 600);
      push(2, placeB);
      await remount(placeNode());
      popTo(1, { kind: "place", place: name === "Library" ? "library" : "canopy" });
      const again = await remount(node);
      const restored = again.querySelector<HTMLElement>(".place-scroll")!;
      await flushFrame();
      await waitMs(170);
      expect(restored.scrollTop, name).toBe(600);
    }
  });
});

describe("chat scroll memory", () => {
  it("a chat saved at the end still follows the end after Back", async () => {
    push(1, chatA);
    const first = await mount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const scroller = first.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await flushFrame();
    await saveScroll(scroller, scroller.scrollHeight);
    expect(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight).toBeLessThan(80);
    push(2, chatB);
    await remount(createElement(FollowChat, { signature: "1", sent: [null] }));
    popTo(1, chatA);
    const again = await remount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const restored = again.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await flushFrame();
    metricsOf(restored).height = 2600;
    await act(async () => again && root?.render(createElement(FollowChat, { signature: "2:token", sent: [null] })));
    await flushFrame();
    await waitMs(430);
    expect(restored.scrollTop).toBe(restored.scrollHeight - restored.clientHeight);
  });

  it("a chat saved mid-thread restores after Back even when the scroller is short then grows", async () => {
    push(1, chatA);
    const first = await mount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const scroller = first.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await saveScroll(scroller, 600);
    push(2, chatB);
    await remount(createElement(FollowChat, { signature: "1", sent: [null] }));
    popTo(1, chatA);
    const again = await remount(createElement(FollowChat, { signature: "1", sent: [null], inner: 400 }));
    const late = again.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    late.dispatchEvent(new Event("scroll"));
    await flushFrame();
    metricsOf(late.firstElementChild as HTMLElement).height = 2000;
    await waitMs(430);
    expect(late.scrollTop).toBe(600);
  });

  it("a chat saved mid-thread restores when history mounts after the 420 ms retry", async () => {
    push(1, chatA);
    const first = await mount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const scroller = first.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await saveScroll(scroller, 600);
    push(2, chatB);
    await remount(createElement(FollowChat, { signature: "1", sent: [null] }));
    popTo(1, chatA);
    const again = await remount(createElement(FollowChat, { signature: "1", sent: [null], inner: 400 }));
    const late = again.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    late.dispatchEvent(new Event("scroll"));
    await waitMs(450);
    expect(late.scrollTop).toBe(0);
    const history = document.createElement("div");
    history.setAttribute("data-testid", "late-history");
    metricsOf(history).height = 2000;
    await act(async () => {
      late.append(history);
    });
    expect(late.scrollHeight).toBeGreaterThanOrEqual(2000);
    await waitMs(80);
    expect(late.scrollTop).toBe(600);
  });

  it("a restored mid-thread chat stays at 120 after a hand scroll past a poll tick", async () => {
    push(1, chatA);
    const first = await mount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const scroller = first.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await saveScroll(scroller, 600);
    push(2, chatB);
    await remount(createElement(FollowChat, { signature: "1", sent: [null] }));
    popTo(1, chatA);
    const again = await remount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const restored = again.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await flushFrame();
    await waitMs(170);
    expect(restored.scrollTop).toBe(600);
    restored.scrollTop = 120;
    restored.dispatchEvent(new Event("scroll"));
    await waitMs(80);
    expect(restored.scrollTop).toBe(120);
    await waitMs(250);
    expect(restored.scrollTop).toBe(120);
  });

  it("does not overwrite a saved place when the scroller has already moved on", async () => {
    push(1, chatA);
    const first = await mount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const scroller = first.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await saveScroll(scroller, 600);
    scroller.scrollTop = 12;
    push(2, chatB);
    await act(async () => first && root?.render(createElement(FollowChat, { signature: "1", sent: [null] })));
    popTo(1, chatA);
    await act(async () => first && root?.render(createElement(FollowChat, { signature: "1", sent: [null] })));
    await flushFrame();
    await waitMs(170);
    expect(scroller.scrollTop).toBe(600);
  });

  it("a mounted chat restores mid-thread on popstate without remounting", async () => {
    push(1, chatA);
    const first = await mount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const scroller = first.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await saveScroll(scroller, 600);
    push(2, chatB);
    await act(async () => first && root?.render(createElement(FollowChat, { signature: "1", sent: [null] })));
    await flushFrame();
    popTo(1, chatA);
    await act(async () => first && root?.render(createElement(FollowChat, { signature: "1", sent: [null] })));
    await flushFrame();
    await waitMs(170);
    expect(scroller.scrollTop).toBe(600);
    await act(async () => first && root?.render(createElement(FollowChat, { signature: "2:token", sent: [null] })));
    await flushFrame();
    await waitMs(270);
    expect(scroller.scrollTop).toBe(600);
  });

  it("a chat saved mid-thread restores its position after Back and does not jump when a token arrives", async () => {
    push(1, chatA);
    const first = await mount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const scroller = first.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await saveScroll(scroller, 600);
    push(2, chatB);
    await remount(createElement(FollowChat, { signature: "1", sent: [null] }));
    popTo(1, chatA);
    const again = await remount(createElement(FollowChat, { signature: "1", sent: [null] }));
    const restored = again.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await flushFrame();
    await waitMs(170);
    expect(restored.scrollTop).toBe(600);
    await act(async () => again && root?.render(createElement(FollowChat, { signature: "2:token", sent: [null] })));
    await flushFrame();
    await waitMs(270);
    expect(restored.scrollTop).toBe(600);
  });

  it("Thread useFollow restores a mid-thread chat after Back and keeps following one left at the end", async () => {
    push(1, chatA);
    const first = await mount(threadNode());
    const scroller = first.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await saveScroll(scroller, 520);
    push(2, chatB);
    await remount(threadNode());
    popTo(1, chatA);
    const again = await remount(threadNode());
    const restored = again.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await flushFrame();
    await waitMs(170);
    expect(restored.scrollTop).toBe(520);
    await act(async () => again && root?.render(threadNode([{ kind: "text", key: "live", text: "token", streaming: true }])));
    await flushFrame();
    expect(restored.scrollTop).toBe(520);

    resetScrollMemoryForTests();
    push(4, chatA);
    const endFirst = await remount(threadNode());
    const endScroller = endFirst.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await flushFrame();
    await saveScroll(endScroller, endScroller.scrollHeight);
    push(5, chatB);
    await remount(threadNode());
    popTo(4, chatA);
    const endAgain = await remount(threadNode());
    const endRestored = endAgain.querySelector<HTMLElement>("[data-testid=thread-scroll]")!;
    await flushFrame();
    metricsOf(endRestored).height = 2800;
    await act(async () => endAgain && root?.render(threadNode([{ kind: "text", key: "live", text: "more tokens", streaming: true }])));
    await flushFrame();
    await waitMs(430);
    expect(endRestored.scrollTop).toBe(endRestored.scrollHeight - endRestored.clientHeight);
  });
});
