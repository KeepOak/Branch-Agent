// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SaplingSession } from "../../connect/session";
import { r1Window, R1Window } from "./R1Window";
vi.mock("../chat/ChatView", () => ({ ChatView: ({ name }: { name: string }) => <p>{name}</p> }));
vi.mock("../../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../places-nav/SettingsFrame", () => ({ SettingsFrame: () => <p>Settings content</p> }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/engine-data", () => ({ useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it("keeps Classic by default and opens R1 only behind the exact opt-in", () => {
  expect(r1Window("")).toBe(false);
  expect(r1Window("?r1")).toBe(true);
  expect(r1Window("?r1&classic")).toBe(false);
  localStorage.setItem("branch.r1", "true"); expect(r1Window("")).toBe(false);
  localStorage.setItem("branch.r1", "1"); expect(r1Window("")).toBe(true);
  expect(r1Window("?classic")).toBe(false);
  localStorage.setItem("branch.classic", "1"); expect(r1Window("")).toBe(false); expect(r1Window("?r1")).toBe(false);
});
it("renders an empty disconnected engine without demo conversations", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.textContent).toContain("No conversations yet"); expect(host.textContent).toContain("Reconnecting…");
  expect(host.querySelectorAll('.r1-sidebar-list button')).toHaveLength(0);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(true);
});
it("mounts in a host without matchMedia or ResizeObserver, as App-level tests do", async () => {
  vi.stubGlobal("matchMedia", undefined); vi.stubGlobal("ResizeObserver", undefined);
  const snapshot = { status: { phase: "connected" }, name: "Main", sessionKey: "agent:main:main", mainKey: "agent:main:main", history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn(async () => ({})), onEvent: () => () => undefined } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  expect(host.querySelector('.r1-frame')?.getAttribute("data-wide")).toBe("true");
  expect(host.querySelector('[aria-label="Message"]')).not.toBeNull();
});
it("opens settings using an in-window history entry", async () => {
  const snapshot = { status: { phase: "disconnected" }, name: "", sessionKey: null, mainKey: null, history: [], live: [], queued: [] };
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request: vi.fn() } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Settings"]')!.click());
  expect(window.history.state.r1Index).toBe(1); expect(window.history.state.r1Route).toEqual({ kind: "settings", page: "appearance" });
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Back"]')?.disabled).toBe(false);
  expect(host.textContent).toContain("Settings content");
});

it("the conversation menu's \"Show agents' work as\" rows turn Coming when the engine can't save preferences", async () => {
  const snapshot = { status: { phase: "connected" }, name: "Scout", sessionKey: "agent:scout:main", mainKey: "agent:scout:main", history: [], live: [], queued: [] };
  const setOverride = vi.fn();
  const request = vi.fn(async (method: string) => { if (method === "users.prefs.set") setOverride(); return {}; });
  const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, engine: { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", features: { methods: ["users.prefs.get"], events: [] } } } as unknown as SaplingSession;
  await act(async () => root.render(<R1Window session={session} />));
  await act(async () => document.querySelector<HTMLButtonElement>('.r1-header-right [aria-label="More"]')!.click());
  const rows = [...document.querySelectorAll<HTMLElement>('[aria-label="Show agents’ work as"] [role="menuitemradio"]')];
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows) {
    expect(row.getAttribute("aria-disabled"), row.textContent ?? "").toBe("true");
    expect(row.dataset.coming, row.textContent ?? "").toBeTruthy();
  }
  await act(async () => rows[1].click());
  expect(setOverride).not.toHaveBeenCalled();
});
