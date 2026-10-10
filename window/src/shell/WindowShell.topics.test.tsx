// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@branch/gateway-protocol";
import type { SaplingSession } from "../connect/session";
import { WindowShell } from "./WindowShell";

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("../face/Pebble", () => ({ Pebble: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const oak: Contact = {
  id: "trunk:oak", kind: "trunk", name: "Oak", threadKey: "agent:oak:main", isDefault: true,
  lastActivityAt: 10, preview: { kind: "message", text: "General last line", at: 10 },
  unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 1,
};
const trip = { key: "agent:oak:trip", contactId: "trunk:oak", title: "Lisbon trip", status: "active" as const, unread: false };
const sessions = [
  { key: "agent:oak:main", agentId: "oak", isMain: true, sessionId: "s-main", updatedAt: 10, lastMessagePreview: "General last line" },
  { key: "agent:oak:trip", agentId: "oak", parentSessionKey: "agent:oak:main", sessionId: "s-trip", updatedAt: 20, lastMessagePreview: "Child last line" },
];

function stubChrome() {
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
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

type HistoryLine = { kind: "user"; key: string; text: string } | { kind: "text"; key: string; text: string; streaming: false };

function session(openKey: string, topics: typeof trip[], history: HistoryLine[], controls?: {
  listeners: Set<(event: string, payload: unknown) => void>;
  rows: () => typeof sessions;
  historyGate?: () => Promise<void>;
}) {
  const snapshot = {
    status: { phase: "connected" }, sessionKey: openKey, mainKey: "agent:oak:main", name: "Oak",
    history, live: [], pendingUser: null, queued: [], liveRunId: null, liveStartedAt: null,
    doneAt: null, lastActivityAt: 10, error: null, steered: [], ended: null,
  };
  const request = vi.fn(async (method: string, params?: unknown) => {
    const key = (params as { sessionKey?: string; contactId?: string } | undefined)?.sessionKey;
    if (method === "config.get") return { hash: "h", config: { wizard: { lastRunAt: "2026-10-06T00:00:00Z" } } };
    if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "oak", kind: "agent", name: "Oak" }] };
    if (method === "contacts.list") return { contacts: [oak] };
    if (method === "contacts.topics") return { topics };
    if (method === "sessions.subscribe") return { list: { sessions } };
    if (method === "sessions.list") return { sessions: controls?.rows() ?? sessions };
    if (method === "chat.history") {
      await controls?.historyGate?.();
      if (key === "agent:oak:main") return { messages: [{ role: "assistant", content: [{ type: "text", text: "General last line" }] }] };
      if (key === "agent:oak:trip") return { messages: [{ role: "user", content: "Child question" }] };
      return { messages: [] };
    }
    if (method === "rooms.list") return { rooms: [] };
    if (method === "peers.list" || method === "a2a.peers.list") return { peers: [] };
    if (method === "channels.status") return { channelOrder: [] };
    if (method === "exec.approval.list" || method === "plugin.approval.list" || method === "branch.approval.list") return { items: [] };
    return {};
  });
  return {
    request,
    engine: { request, onEvent: () => () => {}, scopes: ["operator.admin"], agentId: "oak" },
    gatewayUrl: "ws://127.0.0.1:19661",
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
    onGatewayEvent: (listener: (event: string, payload: unknown) => void) => {
      controls?.listeners.add(listener);
      return () => controls?.listeners.delete(listener);
    },
    open: vi.fn(async () => {}),
    reload: vi.fn(),
  } as unknown as SaplingSession;
}

async function show(openKey: string, topics: typeof trip[], history: HistoryLine[]) {
  stubChrome();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<WindowShell session={session(openKey, topics, history)} url="ws://127.0.0.1:19661" />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

const threadNavs = (host: HTMLElement) => [...host.querySelectorAll("nav")].filter((nav) => /Threads/.test(nav.getAttribute("aria-label") ?? ""));

describe("preview topic row in the shell", () => {
  it("renders one Threads nav for a contact with topics, not TopicRail and ThreadColumn together", async () => {
    const host = await show("agent:oak:main", [trip], [{ kind: "text", key: "g1", text: "General last line", streaming: false }]);
    await vi.waitFor(() => expect(host.querySelector(".topicsT5")).toBeTruthy());
    expect(threadNavs(host)).toHaveLength(1);
    expect(host.querySelector(".v23-threads")).toBeNull();
    expect(host.querySelector(".topicsT5")).toBeTruthy();
    const css = readFileSync(join(process.cwd(), "src/shell/topic-rail.css"), "utf8");
    expect(css).toMatch(/\.conversation-column:has\(>\s*\.topicsT5\.lay-column\)\{padding-left:var\(--topic-width,300px\)\}/);
    expect(css).toMatch(/\.conversation-column:has\(>\s*\.head-row\)\s*>\s*\.topicsT5:not\(\.lay-tabs\)\{top:58px\}/);
    const column = host.querySelector(".conversation-column");
    expect(column?.contains(host.querySelector(".head-row"))).toBe(true);
    expect(column?.querySelector("[data-testid=conversation-menu-button]")).toBeTruthy();
    expect(host.querySelector(".head-row [aria-label=Back]")).toBeTruthy();
    expect(host.querySelector(".head-row [aria-label=Forward]")).toBeTruthy();
    expect(host.querySelector(".head-row [data-testid=list-toggle]")).toBeTruthy();
  });

  it("still mounts ThreadColumn for a contact without topics", async () => {
    const host = await show("agent:oak:main", [], [{ kind: "text", key: "g1", text: "General last line", streaming: false }]);
    await vi.waitFor(() => expect(host.querySelector(".v23-threads")).toBeTruthy());
    expect(threadNavs(host)).toHaveLength(1);
    expect(host.querySelector(".topicsT5")).toBeNull();
  });

  it("keeps General's who on General's last speaker while a child thread is open", async () => {
    const host = await show("agent:oak:trip", [trip], [{ kind: "user", key: "c1", text: "Child question" }]);
    await vi.waitFor(() => expect(host.querySelector(".topicsT5")).toBeTruthy());
    await vi.waitFor(() => expect(host.querySelector('[aria-label="General"] .tpWhoT5')?.textContent).toBe("Oak:"));
    expect(host.querySelector('[aria-label="General"] .tpWhoT5')?.textContent).not.toBe("You:");
  });
});


describe("All topics across sessions.list refreshes", () => {
  async function setup() {
    stubChrome();
    localStorage.setItem("branch-topics-t5", JSON.stringify({ layout: "tabs", width: 300, per: {} }));
    const listeners = new Set<(event: string, payload: unknown) => void>();
    let rows = sessions.map((row) => ({ ...row }));
    let gate: Promise<void> | undefined;
    const client = session("agent:oak:main", [trip], [], { listeners, rows: () => rows, historyGate: () => gate ?? Promise.resolve() });
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<WindowShell session={client} url="ws://127.0.0.1:19661" />));
    const reads = () => vi.mocked(client.request).mock.calls.filter(([method]) => method === "chat.history");
    const refresh = async (changed = false) => {
      rows = rows.map((row) => ({ ...row, ...(changed && row.key === trip.key ? { updatedAt: row.updatedAt + 1 } : {}) }));
      const before = vi.mocked(client.request).mock.calls.filter(([method]) => method === "sessions.list").length;
      await act(async () => {
        listeners.forEach((listener) => listener("sessions.changed", {}));
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
      expect(vi.mocked(client.request).mock.calls.filter(([method]) => method === "sessions.list").length).toBeGreaterThan(before);
    };
    const click = async (label: string) => {
      const button = host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
      expect(button).toBeTruthy();
      await act(async () => button!.click());
    };
    return { host, reads, refresh, click, hold: () => { let release!: () => void; gate = new Promise<void>((resolve) => { release = resolve; }); return release; } };
  }

  it("reuses unchanged threads after a new rows array and reads only a changed thread", async () => {
    const view = await setup();
    const before = view.reads().length;
    await view.click("All");
    expect(view.reads()).toHaveLength(before + 2);
    await view.refresh();
    expect(view.reads()).toHaveLength(before + 2);
    await view.refresh(true);
    expect(view.reads()).toHaveLength(before + 3);
    expect(view.reads().at(-1)?.[1]).toEqual({ sessionKey: trip.key });
    await view.click("General");
    await view.click("All");
    expect(view.reads()).toHaveLength(before + 5);
  });

  it("finishes the in-flight load before collapsing refreshed rows into one follow-up", async () => {
    const view = await setup();
    const release = view.hold();
    const before = view.reads().length;
    await view.click("All");
    expect(view.reads()).toHaveLength(before + 2);
    await view.refresh(true);
    await view.refresh(true);
    expect(view.reads()).toHaveLength(before + 2);
    await act(async () => release());
    expect(view.reads()).toHaveLength(before + 3);
    expect(view.reads().at(-1)?.[1]).toEqual({ sessionKey: trip.key });
    expect(view.host.textContent).not.toContain("Reading all threads…");
  });
});
