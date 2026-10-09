// @vitest-environment jsdom
// A conversation opens from a real transcript. A failed read, a late read of the conversation just left, and an
// empty cached transcript must not leave the thread stuck, record a lost send against the wrong conversation, or
// paint the empty start screen for a conversation that has since gained its first message.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./gateway";
import type { WindowEngine } from "./engine";
import { loadLine } from "../composer/queue";
import { Thread } from "../thread/Thread";

type Row = { sessionId: string | null; messages: Record<string, unknown>[] };

const fake = vi.hoisted(() => ({
  options: null as { onStatus: (status: unknown) => void } | null,
  rows: new Map<string, Row>(),
  historyError: null as Error | null,
  sendError: null as Error | null,
  historyCalls: [] as string[],
  holds: new Map<string, Promise<void>>(),
  releasers: new Map<string, () => void>(),
  arm(key: string) {
    this.releasers.get(key)?.();
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = () => {
        if (this.holds.get(key) !== promise) return;
        this.holds.delete(key);
        this.releasers.delete(key);
        resolve();
      };
    });
    this.holds.set(key, promise);
    this.releasers.set(key, release);
  },
  release(key: string) {
    this.releasers.get(key)?.();
  },
  releaseAll() {
    for (const release of [...this.releasers.values()]) release();
  },
}));

vi.mock("./gateway", () => ({
  BranchGateway: class {
    constructor(options: { onStatus: (status: unknown) => void }) {
      fake.options = options;
    }
    start(): void {}
    stop(): void {}
    reconnectNow(): void {}
    async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
      if (method === "chat.history") {
        const key = String(params?.sessionKey ?? "");
        const full = typeof params?.limit !== "number";
        if (full) fake.historyCalls.push(key);
        const held = full ? fake.holds.get(key) : undefined;
        if (held) await held;
        if (fake.historyError && full) throw fake.historyError;
        const row = fake.rows.get(key) ?? { sessionId: "s1", messages: [] };
        return {
          ...(row.sessionId ? { sessionId: row.sessionId } : {}),
          messages: row.messages.map((message) => ({ ...message })),
          pendingInputs: { items: [], total: 0 },
        };
      }
      if (method === "chat.send") {
        if (fake.sendError) throw fake.sendError;
        return { runId: params?.idempotencyKey, status: "started" };
      }
      if (method === "agents.list") return { agents: [{ id: "main", name: "Juniper" }], defaultId: "main" };
      if (method === "approval.history" || method === "exec.approval.list") return { items: [] };
      return {};
    }
  },
}));

import { SaplingSession } from "./session";

const KEY = "agent:main:main";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: KEY } }, auth: { scopes: [] }, policy: {} };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const user = (text: string, id: string, timestamp: number) => ({ role: "user", content: text, timestamp, __branch: { id } });
const assistant = (text: string, id: string, timestamp: number) => ({ role: "assistant", content: [{ type: "text", text }], timestamp, __branch: { id } });
const texts = (session: SaplingSession) => session.getSnapshot().history.flatMap((block) => ("text" in block && block.text ? [block.text] : []));
const readsOf = (key: string) => fake.historyCalls.filter((call) => call === key).length;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });

const engine: WindowEngine = {
  sessionKey: KEY,
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

let root: Root | undefined;
async function renderThread(props: Partial<Parameters<typeof Thread>[0]>): Promise<HTMLElement> {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  if (root) await act(async () => root?.unmount());
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Thread name="Juniper" history={[]} live={[]} pendingUser={null} running={false} engine={engine} onAnswer={() => {}} {...props} />));
  return container;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await settle();
}

async function connect(): Promise<SaplingSession> {
  const session = new SaplingSession("ws://127.0.0.1:19671", undefined);
  session.start();
  fake.options?.onStatus({ phase: "connected", hello } as unknown as GatewayStatus);
  await settle();
  return session;
}

afterEach(async () => {
  fake.releaseAll();
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  fake.options = null;
  fake.rows.clear();
  fake.historyError = null;
  fake.sendError = null;
  fake.historyCalls = [];
  fake.holds.clear();
  fake.releasers.clear();
});

it("stops a failed history read and reads that conversation again on the next open", async () => {
  fake.historyError = new Error("history unavailable");
  const session = await connect();
  await vi.waitFor(() => expect(session.getSnapshot().error).toBe("history unavailable"));
  expect(session.getSnapshot().historyReady).toBe(false);
  expect(session.getSnapshot().history).toEqual([]);
  const failed = await renderThread({ history: session.getSnapshot().history, historyReady: session.getSnapshot().historyReady, preparationError: session.getSnapshot().error });
  expect(failed.querySelector('[data-testid="thread-opening"]')).toBeNull();
  expect(failed.querySelector('[data-testid="empty-state"]')).toBeNull();
  expect(failed.textContent).not.toContain("What should");
  const loading = await renderThread({ history: [], historyReady: false });
  expect(loading.querySelector('[data-testid="thread-opening"]')).not.toBeNull();
  expect(loading.querySelector('[data-testid="empty-state"]')).toBeNull();

  const failedReads = readsOf(KEY);
  expect(failedReads).toBeGreaterThan(0);
  await session.open(KEY);
  expect(readsOf(KEY)).toBe(failedReads + 1);
  expect(session.getSnapshot()).toMatchObject({ historyReady: false, error: "history unavailable", history: [] });
  await expect(session.reload()).rejects.toThrow("history unavailable");
  expect(readsOf(KEY)).toBe(failedReads + 2);
  expect(session.getSnapshot().historyReady).toBe(false);

  fake.historyError = null;
  fake.rows.set(KEY, { sessionId: "s1", messages: [user("Kept", "kept", 1)] });
  await session.reload();
  expect(session.getSnapshot().historyReady).toBe(true);
  expect(session.getSnapshot().error).toBeNull();
  expect(texts(session)).toContain("Kept");
  session.stop();
});

it("does not let a late read of A mark a lost send in B as a conversation that never existed", async () => {
  const other = "agent:main:topic-b";
  fake.rows.set(KEY, { sessionId: "a-id", messages: [user("In A", "a1", 1)] });
  fake.rows.set(other, { sessionId: "b-id", messages: [user("In B", "b1", 1)] });
  fake.arm(KEY);
  const session = await connect();
  await vi.waitFor(() => expect(fake.historyCalls).toContain(KEY));
  await session.open(other);
  expect(session.getSnapshot()).toMatchObject({ sessionKey: other, historyReady: true });
  expect(texts(session)).toContain("In B");
  fake.release(KEY);
  await flush();
  fake.sendError = new Error("gateway closed (1006)");
  await session.send("Lost in B");
  expect(loadLine(localStorage, other)).toMatchObject([{ text: "Lost in B", state: "checking", sentTo: { existed: true } }]);
  session.stop();
});

it("does not treat a cached empty transcript as final once the first message exists", async () => {
  const known = "agent:main:known-empty";
  const warmed = "agent:main:warm-empty";
  fake.rows.set(KEY, { sessionId: "main-id", messages: [user("Home", "home", 1)] });
  fake.rows.set(known, { sessionId: "known-id", messages: [] });
  fake.rows.set(warmed, { sessionId: "warm-id", messages: [] });
  const session = await connect();
  await flush();
  await session.open(known);
  expect(session.getSnapshot()).toMatchObject({ sessionKey: known, historyReady: true, history: [] });
  session.warmHistories([warmed]);
  await vi.waitFor(() => expect(fake.historyCalls).toContain(warmed));
  await flush();
  await session.open(KEY);
  await flush();

  fake.rows.set(known, { sessionId: "known-id", messages: [user("First known", "k1", 2)] });
  fake.rows.set(warmed, { sessionId: "warm-id", messages: [user("First warmed", "w1", 2)] });
  fake.arm(known);
  const openingKnown = session.open(known);
  expect(session.getSnapshot().historyReady).toBe(false);
  expect(texts(session)).not.toContain("First known");
  fake.release(known);
  await openingKnown;
  expect(session.getSnapshot().historyReady).toBe(true);
  expect(texts(session)).toContain("First known");

  fake.arm(warmed);
  const openingWarmed = session.open(warmed);
  expect(session.getSnapshot().historyReady).toBe(false);
  expect(texts(session)).not.toContain("First warmed");
  fake.release(warmed);
  await openingWarmed;
  expect(session.getSnapshot().historyReady).toBe(true);
  expect(texts(session)).toContain("First warmed");
  session.stop();
});

it("reopens a rewound conversation from the shortened transcript", async () => {
  const topic = "agent:main:essay";
  const other = "agent:main:other";
  fake.rows.set(topic, {
    sessionId: "essay-id",
    messages: [user("Hi", "e0", 1), assistant("Hello", "e1", 2), user("Write an essay", "e2", 3), assistant("Old essay", "e3", 4)],
  });
  fake.rows.set(other, { sessionId: "other-id", messages: [user("Elsewhere", "o1", 1)] });
  const session = await connect();
  await flush();
  await session.open(topic);
  expect(texts(session)).toContain("Write an essay");

  fake.arm(topic);
  const stale = session.reload();
  session.rewound("e2");
  expect(texts(session)).toContain("Hi");
  expect(texts(session)).not.toContain("Write an essay");
  fake.release(topic);
  await stale;
  await flush();
  expect(texts(session)).not.toContain("Write an essay");

  await session.open(other);
  fake.arm(topic);
  const reopening = session.open(topic);
  expect(session.getSnapshot().historyReady).toBe(true);
  expect(texts(session)).toContain("Hi");
  expect(texts(session)).toContain("Hello");
  expect(texts(session)).not.toContain("Write an essay");
  expect(texts(session)).not.toContain("Old essay");
  fake.release(topic);
  await reopening;
  session.stop();
});
