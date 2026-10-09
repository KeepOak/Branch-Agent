// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@branch/gateway-protocol";
import type { SaplingSession } from "../connect/session";
import { WindowShell } from "./WindowShell";
import { conversationLink } from "./own-window";

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
  vi.restoreAllMocks();
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

function session(openKey: string, topics: typeof trip[], history: HistoryLine[]) {
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
    if (method === "sessions.list") return { sessions };
    if (method === "chat.history") {
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
    onGatewayEvent: () => () => {},
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
  it("opens the current conversation in its own window from the conversation menu", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    localStorage.setItem("branch.route", JSON.stringify({ kind: "chat", key: "agent:oak:trip" }));
    const host = await show("agent:oak:trip", [trip], []);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="conversation-menu-button"]')!.click());
    const ownWindow = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent?.trim() === "Open in its own window")!;
    expect(ownWindow.disabled).toBe(false);
    await act(async () => ownWindow.click());
    expect(open).toHaveBeenCalledExactlyOnceWith(conversationLink("agent:oak:trip"), "_blank", "noopener");
  });
  it("enables Back and Forward only within the window's known history", async () => {
    window.history.replaceState(null, "");
    localStorage.setItem("branch.route", JSON.stringify({ kind: "chat", key: "agent:oak:main" }));
    const host = await show("agent:oak:main", [trip], []);
    const back = () => host.querySelector<HTMLButtonElement>('.head-row [aria-label="Back"]')!;
    const forward = () => host.querySelector<HTMLButtonElement>('.head-row [aria-label="Forward"]')!;
    expect(back().disabled).toBe(true);
    expect(back().title).toBe("No earlier page in this window.");
    expect(forward().disabled).toBe(true);
    expect(forward().title).toBe("No later page in this window.");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await act(async () => host.querySelector<HTMLButtonElement>('.tpRowT5 .tpGoT5[aria-current="false"]')!.click());
    expect(back().disabled).toBe(false);
    expect(forward().disabled).toBe(true);
    await act(async () => {
      back().click();
      await vi.waitFor(() => expect(window.history.state.branchIndex).toBe(0));
    });
    expect(window.history.state.branchRoute).toEqual({ kind: "chat", key: "agent:oak:main" });
    expect(back().disabled).toBe(true);
    expect(forward().disabled).toBe(false);
    await act(async () => {
      forward().click();
      await vi.waitFor(() => expect(window.history.state.branchIndex).toBe(1));
    });
    expect(window.history.state.branchRoute).toEqual({ kind: "chat", key: "agent:oak:trip" });
    expect(back().disabled).toBe(false);
    expect(forward().disabled).toBe(true);
  });
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
