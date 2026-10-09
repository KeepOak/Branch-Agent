// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import type { SaplingSession } from "../connect/session";
import { shouldShowThreadColumn } from "../shell/ThreadColumn";
import { WindowShell } from "../shell/WindowShell";
import { SettingsFrame } from "./SettingsFrame";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const engine: WindowEngine = { request: vi.fn(async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "test", scopes: [] };
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("narrow window", () => {
  it("uses the sidebar list toggle at 880px and closes its drawer on return to 900px", async () => {
    let width = 880;
    const listeners = new Set<() => void>();
    vi.stubGlobal("innerWidth", width);
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() { return query === "(width < 900px)" ? width < 900 : query === "(max-width: 760px)" ? width <= 760 : false; },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} unobserve() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const row = { key: "agent:oak:main", agentId: "oak", isMain: true, updatedAt: 1 };
    const request = vi.fn(async (method: string) => {
      if (method === "config.get") return { hash: "test", config: { wizard: { lastRunAt: "2026-10-06" } } };
      if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "oak", name: "Oak" }] };
      if (method === "sessions.subscribe") return { list: { sessions: [row] } };
      if (method === "sessions.list") return { sessions: [row] };
      if (method === "contacts.list") return { contacts: [{ id: "trunk:oak", kind: "trunk", name: "Oak", threadKey: row.key, isDefault: true, lastActivityAt: 1, preview: { kind: "message", text: "", at: 1 }, topicCount: 0 }] };
      if (method === "rooms.list") return { rooms: [] };
      if (method === "peers.list" || method === "a2a.peers.list") return { peers: [] };
      if (method === "contacts.topics") return { topics: [] };
      if (method === "channels.status") return { channelOrder: [] };
      if (method.endsWith("approval.list")) return { items: [] };
      return {};
    });
    const snapshot = { status: { phase: "connected" }, sessionKey: row.key, mainKey: row.key, name: "Oak", history: [], live: [], pendingUser: null, queued: [], liveRunId: null, liveStartedAt: null, doneAt: null, lastActivityAt: 1, error: null, steered: [], ended: null };
    const session = { request, engine: { request, onEvent: () => () => {}, scopes: ["operator.admin"], agentId: "oak" }, gatewayUrl: "ws://localhost:0", getSnapshot: () => snapshot, subscribe: () => () => {}, onGatewayEvent: () => () => {}, open: vi.fn(async () => {}), reload: vi.fn() } as unknown as SaplingSession;
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<WindowShell session={session} url="ws://localhost:0" />));
    const toggle = host.querySelector<HTMLButtonElement>('.head-row [data-testid="list-toggle"]');
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
    expect(host.querySelector(".frame.slide-open")).not.toBeNull();
    await act(async () => { width = 900; vi.stubGlobal("innerWidth", width); listeners.forEach((listener) => listener()); });
    expect(host.querySelector(".frame.slide-open")).toBeNull();
    expect(host.querySelector('.head-row [data-testid="list-toggle"]')).toBeNull();
  });

  it("collapses the thread column below 900px but keeps it at 900px and above", () => {
    const props = { chat: true, focus: false, stage: false, draft: false, generalKey: "agent:oak:main", topicRow: false };
    for (const viewportWidth of [760, 880, 899.5]) expect(shouldShowThreadColumn({ ...props, viewportWidth })).toBe(false);
    for (const viewportWidth of [900, 1280]) expect(shouldShowThreadColumn({ ...props, viewportWidth })).toBe(true);
  });

  it("uses a working Settings page select under 900px and restores links after resizing", async () => {
    let width = 880;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() { return query === "(max-width: 1000px)" ? width <= 1000 : width < 900; },
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
    }));
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    const onPage = vi.fn();
    await act(async () => root?.render(<SettingsFrame page="general" backName="Oak" engine={engine} onPage={onPage} onBack={() => {}} />));
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Settings page"]');
    expect(select).not.toBeNull();
    expect(select?.value).toBe("general");
    expect(host.querySelector(".set-nav .set-item")).toBeNull();
    const destination = select!.options[1].value;
    await act(async () => { select!.value = destination; select!.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(onPage).toHaveBeenCalledWith(destination);
    await act(async () => { width = 1280; listeners.forEach((listener) => listener()); });
    expect(host.querySelector('select[aria-label="Settings page"]')).toBeNull();
    expect(host.querySelector('.set-item[data-page="general"]')).not.toBeNull();
    await act(async () => { width = 880; listeners.forEach((listener) => listener()); });
    expect(host.querySelector('select[aria-label="Settings page"]')).not.toBeNull();
  });
});
