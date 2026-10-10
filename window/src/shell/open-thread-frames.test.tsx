// @vitest-environment jsdom
// Opening a sidebar conversation must paint like a message app: the empty start
// screen never appears for a conversation that already exists, and a transcript
// already read is on screen at once.
//
// This is the window vitest harness (the same jsdom + WindowShell render as
// WindowShell.topics.test.tsx). It samples every animation frame and every 16ms.
// The Playwright visual tour drives a live engine, so it cannot hold chat.history
// between paints; that tour cannot prove this race. Feature-batch checks run this
// file because it is listed in scripts/feature-batch-ci-named.
//
// Budgets, measured from the click:
// - Cached: 300ms, and one render step. The transcript was already read. The
//   header, messages and composer change together on the click. No later frame
//   before the refresh may show a different thread. Releasing that refresh
//   must keep the same header and messages. Header back and forward use that
//   same path.
// - Uncached: 1000ms. The mock holds the unread chat.history for 150ms, one
//   engine round trip. The first message must be visible within 1000ms of the
//   click. A multi-second wait on the empty start screen fails. Any sampled
//   frame that shows "What should … do?" or its suggestion chips fails at once.
import { Profiler, act, type ProfilerOnRenderCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const CACHED_OPEN_MS = 300;
const UNCACHED_OPEN_MS = 1000;
const MOCK_HISTORY_MS = 150;

const fake = vi.hoisted(() => {
  const MAIN = "agent:researcher:main";
  const PONG = "agent:researcher:pong-check-1842";
  const EMPTY = "agent:researcher:empty-note";
  const holds = new Map<string, Promise<void>>();
  const releasers = new Map<string, () => void>();
  const transcript = (key: string): Record<string, unknown>[] => {
    const at = Date.now() - 60_000;
    if (key === MAIN) return [{ role: "assistant", content: [{ type: "text", text: "General hello" }], timestamp: at }];
    if (key === PONG) return [
      { role: "user", content: "Serve the pong", timestamp: at },
      { role: "assistant", content: [{ type: "text", text: "pong reply is here" }], timestamp: at + 1000 },
    ];
    return [];
  };
  return {
    MAIN,
    PONG,
    EMPTY,
    REMOTE: "a2a:branch-remote--builder",
    options: null as { onStatus: (status: unknown) => void } | null,
    holds,
    transcript,
    arm(key: string) {
      releasers.get(key)?.();
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = () => {
          if (holds.get(key) !== promise) return;
          holds.delete(key);
          releasers.delete(key);
          resolve();
        };
      });
      holds.set(key, promise);
      releasers.set(key, release);
    },
    release(key: string) {
      releasers.get(key)?.();
    },
    releaseAll() {
      for (const release of [...releasers.values()]) release();
    },
  };
});

vi.mock("../connect/gateway", () => ({
  BranchGateway: class {
    constructor(options: { onStatus: (status: unknown) => void }) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    reconnectNow(): void {}
    async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      const key = typeof params?.sessionKey === "string" ? params.sessionKey : "";
      if (method === "chat.history") {
        if (typeof params?.limit !== "number") {
          const pending = fake.holds.get(key);
          if (pending) await pending;
        }
        return { sessionId: "s", messages: fake.transcript(key) };
      }
      if (method === "agents.list") {
        return { defaultId: "researcher", agents: [{ id: "researcher", name: "Researcher", identity: { name: "Researcher", theme: "research" } }] };
      }
      if (method === "config.get") return { hash: "h", config: { wizard: { lastRunAt: "2026-10-06T00:00:00Z" } } };
      if (method === "contacts.list") {
        return {
          contacts: [{
            id: "trunk:researcher", kind: "trunk", name: "Researcher", threadKey: fake.MAIN, isDefault: true,
            lastActivityAt: 30, preview: { kind: "message", text: "General hello", at: 30 },
            unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 2,
          }, {
            id: "a2a:branch-remote--builder", kind: "outside", name: "Remote Builders", threadKey: fake.REMOTE, isDefault: false,
            lastActivityAt: 0, preview: { kind: "message", text: "", at: 0 },
            unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0,
          }],
        };
      }
      if (method === "contacts.topics") {
        return {
          topics: [
            { key: fake.PONG, contactId: "trunk:researcher", title: "pong-check-1842", status: "active", unread: false },
            { key: fake.EMPTY, contactId: "trunk:researcher", title: "empty-note", status: "active", unread: false },
          ],
        };
      }
      if (method === "sessions.subscribe") return { list: { sessions: sessionRows() } };
      if (method === "sessions.list") return { sessions: sessionRows() };
      if (method === "rooms.list") return { rooms: [] };
      if (method === "peers.list" || method === "a2a.peers.list") return { peers: [] };
      if (method === "channels.status") return { channelOrder: [] };
      if (method === "exec.approval.list" || method === "approval.history" || method === "plugin.approval.list") return { items: [] };
      return {};
    }
  },
}));

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("../face/Pebble", () => ({ Pebble: () => null }));

import { SaplingSession } from "../connect/session";
import { WindowShell } from "./WindowShell";

function sessionRows() {
  return [
    { key: fake.MAIN, agentId: "researcher", isMain: true, sessionId: "s-main", updatedAt: 30, lastMessagePreview: "General hello", derivedTitle: "General" },
    { key: fake.PONG, agentId: "researcher", parentSessionKey: fake.MAIN, sessionId: "s-pong", updatedAt: 20, lastMessagePreview: "Earlier pong line", derivedTitle: "Pong-check-1842" },
    { key: fake.EMPTY, agentId: "researcher", parentSessionKey: fake.MAIN, sessionId: "s-empty", updatedAt: 10, lastMessagePreview: "", derivedTitle: "empty-note" },
  ];
}

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const hello = { snapshot: { sessionDefaults: { mainSessionKey: fake.MAIN } }, auth: { scopes: ["operator.admin"] }, policy: {} };

let root: Root | undefined;
let session: SaplingSession | undefined;
let recording = false;
const paints: View[] = [];

type View = {
  head: string;
  messages: string;
  composer: boolean;
  empty: boolean;
  recent: boolean;
  chips: boolean;
  where: boolean;
  opening: boolean;
};

function readView(): View {
  const thread = document.querySelector(".thread");
  const threadText = thread?.textContent ?? "";
  return {
    head: document.querySelector(".head-row .head-name")?.textContent ?? "",
    messages: [...(thread?.querySelectorAll('[data-testid="message"]') ?? [])].map((node) => node.textContent ?? "").join("\n"),
    composer: Boolean(document.querySelector('[data-testid="composer"]')),
    empty: Boolean(thread?.querySelector('[data-testid="empty-state"]')) || /What should .+ do\?/.test(threadText),
    recent: [...(thread?.querySelectorAll(".section-label") ?? [])].some((node) => node.textContent === "Recent"),
    chips: Boolean(thread?.querySelector(".starters, .chipb")),
    where: Boolean(document.querySelector('[data-testid="where-chips"]')),
    opening: Boolean(document.querySelector('[data-testid="thread-opening"]')),
  };
}

const onRender: ProfilerOnRenderCallback = () => {
  if (recording) paints.push(readView());
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width: 760px"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
  HTMLElement.prototype.scrollIntoView = () => {};
});

afterEach(async () => {
  session?.stop();
  fake.releaseAll();
  if (root) await act(async () => root?.unmount());
  root = undefined;
  session = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function topicButton(label: string): HTMLButtonElement {
  const wanted = label.toLowerCase();
  const button = [...document.querySelectorAll("button.tpGoT5")].find((node) => {
    const aria = node.getAttribute("aria-label")?.toLowerCase();
    const title = node.querySelector("b")?.textContent?.trim().toLowerCase();
    return aria === wanted || title === wanted;
  });
  if (!(button instanceof HTMLButtonElement)) {
    const seen = [...document.querySelectorAll("button.tpGoT5")].map((node) => node.textContent?.replace(/\s+/g, " ").trim());
    throw new Error(`No thread button for ${label}. Saw: ${seen.join(" | ") || "(none)"}`);
  }
  return button;
}

type Sample = { at: number; empty: boolean; chips: boolean; where: boolean; opening: boolean; message: boolean };

function readFrame(started: number, needle: string): Sample {
  const text = document.body.textContent ?? "";
  return {
    at: performance.now() - started,
    empty: Boolean(document.querySelector('[data-testid="empty-state"]')) || /What should .+ do\?/.test(text),
    chips: Boolean(document.querySelector(".starters, .chipb")),
    where: Boolean(document.querySelector('[data-testid="where-chips"]')),
    opening: Boolean(document.querySelector('[data-testid="thread-opening"]')),
    message: text.includes(needle),
  };
}

/** Samples from the click until `budgetMs`, releasing a held transcript at `releaseAfter` when set. */
async function openTopic(label: string, needle: string, budgetMs: number, releaseAfter?: number): Promise<Sample[]> {
  const button = topicButton(label);
  const frames: Sample[] = [];
  const started = performance.now();
  let stopped = false;
  const sample = () => { if (!stopped) frames.push(readFrame(started, needle)); };
  const timer = setInterval(sample, 16);
  const loop = () => {
    if (stopped) return;
    sample();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await act(() => { button.click(); });
  sample();
  const releaseAt = releaseAfter ?? Number.POSITIVE_INFINITY;
  while (performance.now() - started < budgetMs) {
    if (performance.now() - started >= releaseAt) fake.release(label === "empty-note" ? fake.EMPTY : fake.PONG);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 16)); });
    sample();
    const latest = frames.at(-1);
    if (latest?.message && performance.now() - started >= releaseAt) break;
    if (latest?.empty || latest?.chips) break;
  }
  stopped = true;
  clearInterval(timer);
  return frames;
}

function assertNoStartScreen(frames: Sample[], allowWhere: boolean) {
  const bad = frames.find((frame) => frame.empty || frame.chips || (!allowWhere && frame.where));
  expect(bad ?? null).toBeNull();
}

async function showResearcher(): Promise<void> {
  session = new SaplingSession("ws://127.0.0.1:19671", undefined);
  session.start();
  fake.options?.onStatus({ phase: "connected", hello });
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => { root!.render(<Profiler id="shell" onRender={onRender}><WindowShell session={session!} url="ws://127.0.0.1:19671" /></Profiler>); });
  await vi.waitFor(() => {
    expect(topicButton("pong-check-1842")).toBeTruthy();
    expect(topicButton("General")).toBeTruthy();
  }, { timeout: 4000 });
}

it("does not flash the empty start screen when an unread conversation is opened", async () => {
  fake.arm(fake.PONG);
  await showResearcher();
  const frames = await openTopic("pong-check-1842", "Serve the pong", UNCACHED_OPEN_MS, MOCK_HISTORY_MS);
  assertNoStartScreen(frames, false);
  expect(frames.some((frame) => frame.opening)).toBe(true);
  const hit = frames.find((frame) => frame.message);
  expect(hit).toBeTruthy();
  expect(hit!.at).toBeLessThan(UNCACHED_OPEN_MS);
});

it("paints a cached conversation within 300ms while its refresh is still held", async () => {
  await showResearcher();
  await act(() => { topicButton("pong-check-1842").click(); });
  await vi.waitFor(() => expect(document.body.textContent).toContain("Serve the pong"));
  await act(() => { topicButton("General").click(); });
  await vi.waitFor(() => expect(document.querySelector('[data-testid="thread-opening"]')).toBeNull());
  expect(document.body.textContent).toContain("General hello");
  fake.arm(fake.PONG);
  const started = performance.now();
  const frames: Sample[] = [];
  let stopped = false;
  const sample = () => { if (!stopped) frames.push(readFrame(started, "Serve the pong")); };
  const timer = setInterval(sample, 16);
  const loop = () => { if (stopped) return; sample(); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await act(() => { topicButton("pong-check-1842").click(); });
  sample();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 32)); });
  sample();
  stopped = true;
  clearInterval(timer);
  assertNoStartScreen(frames, false);
  expect(fake.holds.has(fake.PONG)).toBe(true);
  const hit = frames.find((frame) => frame.message);
  expect(hit).toBeTruthy();
  expect(hit!.at).toBeLessThan(CACHED_OPEN_MS);
  expect(frames.some((frame) => frame.opening)).toBe(false);
  fake.release(fake.PONG);
});

it("shows the start screen for a conversation that is actually empty, and not while it is still loading", async () => {
  fake.arm(fake.EMPTY);
  await showResearcher();
  const frames: Sample[] = [];
  const started = performance.now();
  let stopped = false;
  const sample = () => { if (!stopped) frames.push(readFrame(started, "Serve the pong")); };
  const timer = setInterval(sample, 16);
  requestAnimationFrame(function loop() { if (stopped) return; sample(); requestAnimationFrame(loop); });
  await act(() => { topicButton("empty-note").click(); });
  sample();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 48)); });
  sample();
  assertNoStartScreen(frames, false);
  expect(frames.some((frame) => frame.opening)).toBe(true);
  fake.release(fake.EMPTY);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 32)); });
  sample();
  stopped = true;
  clearInterval(timer);
  expect(document.querySelector('[data-testid="empty-state"]')).toBeTruthy();
  expect(document.body.textContent).toMatch(/What should Researcher do\?/);
});

function distinctSteps(frames: View[]): View[] {
  return frames.filter((frame, index) => index === 0 || JSON.stringify(frame) !== JSON.stringify(frames[index - 1]));
}

/** Header, messages and composer from a warm cache, with the refresh still held. One visual step, no start screen. */
async function assertCachedStep(go: () => void, settled: { head: string; message: string }): Promise<void> {
  paints.length = 0;
  recording = true;
  await act(async () => {
    go();
    // history.back/forward queue two traversal tasks before popstate.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  recording = false;
  const steps = distinctSteps(paints);
  expect(steps, JSON.stringify(steps, null, 2)).toHaveLength(1);
  const view = steps[0]!;
  expect(view.empty).toBe(false);
  expect(view.recent).toBe(false);
  expect(view.chips).toBe(false);
  expect(view.where).toBe(false);
  expect(view.opening).toBe(false);
  expect(view.composer).toBe(true);
  expect(view.head).toBe(settled.head);
  expect(view.messages).toContain(settled.message);
}

function headerButton(label: "Back" | "Forward"): HTMLButtonElement {
  const button = document.querySelector(`.head-row [aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`No header ${label} button`);
  return button;
}

it("paints a warm conversation in one step, and header back and forward do the same", async () => {
  await showResearcher();
  await act(() => { topicButton("pong-check-1842").click(); });
  await vi.waitFor(() => expect(document.body.textContent).toContain("Serve the pong"));
  await act(() => { topicButton("General").click(); });
  await vi.waitFor(() => expect(document.body.textContent).toContain("General hello"));
  expect(document.querySelector(".head-row .head-name")?.textContent).toBe("Researcher");

  fake.arm(fake.PONG);
  fake.arm(fake.MAIN);
  await assertCachedStep(() => topicButton("pong-check-1842").click(), { head: "Pong-check-1842", message: "Serve the pong" });
  expect(fake.holds.has(fake.PONG)).toBe(true);
  expect(document.body.textContent).toContain("pong reply is here");

  paints.length = 0;
  recording = true;
  fake.release(fake.PONG);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 32)); });
  recording = false;
  for (const paint of paints) {
    expect(paint.head).toBe("Pong-check-1842");
    expect(paint.messages).toContain("Serve the pong");
    expect(paint.empty || paint.recent || paint.chips || paint.where || paint.opening).toBe(false);
  }

  await assertCachedStep(() => headerButton("Back").click(), { head: "Researcher", message: "General hello" });
  expect(fake.holds.has(fake.MAIN)).toBe(true);

  await assertCachedStep(() => headerButton("Forward").click(), { head: "Pong-check-1842", message: "Serve the pong" });
  fake.releaseAll();
});


it("keeps the grafted contact identity in the empty state, composer and character card", async () => {
  await showResearcher();
  await act(async () => { await session!.open(fake.REMOTE); });
  await vi.waitFor(() => {
    expect(document.querySelector(".empty-title")?.textContent).toBe("What should Remote Builders do?");
    const composer = document.querySelector('textarea[aria-label="Message Remote Builders"]');
    expect(composer?.getAttribute("placeholder")).toBe("Message Remote Builders");
  });
  expect(document.querySelector('[data-testid="where-chips"]')).toBeNull();
  const character = document.querySelector(".character-panel")!;
  expect(character.getAttribute("aria-label")).toMatch(/^Remote Builders, /);
  await act(async () => { character.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
  expect(document.querySelector('[data-testid="character-open"]')).toBeNull();
});
