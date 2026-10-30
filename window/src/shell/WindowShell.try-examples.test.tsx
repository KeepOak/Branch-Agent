// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Contact } from "@branch/gateway-protocol";
import type { SaplingSession } from "../connect/session";
import { resetTryExamples } from "../screens/onboarding/try-examples";
import { WindowShell } from "./WindowShell";

vi.mock("../face/Face", () => ({ Face: () => null }));
vi.mock("../face/Pebble", () => ({ Pebble: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  resetTryExamples();
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
const sessions = [{ key: "agent:oak:main", agentId: "oak", isMain: true, sessionId: "s-main", updatedAt: 10 }];

function stubChrome(narrow = true) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: narrow && query.includes("max-width: 760px"),
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

function session() {
  const snapshot = {
    status: { phase: "connected" }, sessionKey: "agent:oak:main", mainKey: "agent:oak:main", name: "Oak",
    history: [], live: [], pendingUser: null, queued: [], liveRunId: null, liveStartedAt: null,
    doneAt: null, lastActivityAt: 10, error: null, steered: [], ended: null,
  };
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h", config: { wizard: { lastRunAt: "2026-10-06T00:00:00Z" } } };
    if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "oak", kind: "agent", name: "Oak" }] };
    if (method === "contacts.list") return { contacts: [oak] };
    if (method === "contacts.topics") return { topics: [] };
    if (method === "sessions.subscribe") return { list: { sessions } };
    if (method === "sessions.list") return { sessions };
    if (method === "chat.history") return { messages: [] };
    if (method === "trunks.template.starters") return { offer: [] };
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

async function show() {
  stubChrome(false);
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<WindowShell session={session()} url="ws://127.0.0.1:19661" />));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  return host;
}

it("opens Settings Trunks from the Classic palette Try it with examples row, not Customize", async () => {
  const host = await show();
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })); });
  const input = document.querySelector<HTMLInputElement>('[data-testid="palette"] input')!;
  expect(input).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "examples");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const row = [...document.querySelectorAll<HTMLElement>('[data-testid="palette-row"]')].find(node => node.querySelector(".pal-label")?.textContent === "Try it with examples");
  expect(row).toBeTruthy();
  await act(async () => row!.click());
  await vi.waitFor(() => expect(host.querySelector('.set-item[data-page=trunks][aria-current=true]')).toBeTruthy());
  expect(JSON.parse(localStorage.getItem("branch.route")!)).toEqual({ kind: "settings", page: "trunks" });
  expect(host.querySelector('[data-place="customize"][aria-current="true"]')).toBeNull();
});
